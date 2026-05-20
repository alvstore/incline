
-- 1) Extend run status with 'awaiting_review' and add review columns
ALTER TABLE public.ig_comment_runs
  DROP CONSTRAINT IF EXISTS ig_comment_runs_status_check;
ALTER TABLE public.ig_comment_runs
  ADD CONSTRAINT ig_comment_runs_status_check
  CHECK (status = ANY (ARRAY[
    'pending'::text,'scheduled'::text,'sent'::text,
    'failed'::text,'skipped'::text,'awaiting_review'::text
  ]));

ALTER TABLE public.ig_comment_runs
  ADD COLUMN IF NOT EXISTS dm_draft text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_decision text
    CHECK (review_decision IS NULL OR review_decision = ANY (ARRAY['approved'::text,'rejected'::text])),
  ADD COLUMN IF NOT EXISTS review_notes text;

-- 2) Keep dedupe unique-index covering awaiting_review too (so duplicate matches collapse)
DROP INDEX IF EXISTS public.ig_runs_dedupe;
CREATE UNIQUE INDEX ig_runs_dedupe
  ON public.ig_comment_runs (campaign_id, ig_user_id, action)
  WHERE status = ANY (ARRAY['sent'::text,'scheduled'::text,'pending'::text,'awaiting_review'::text]);

-- 3) Lookup index for the approval queue
CREATE INDEX IF NOT EXISTS idx_ig_runs_awaiting_branch
  ON public.ig_comment_runs (branch_id, created_at DESC)
  WHERE status = 'awaiting_review';

-- 4) Atomic approve / reject RPC
CREATE OR REPLACE FUNCTION public.review_ig_run(
  p_run_id uuid,
  p_decision text,
  p_edited_body text DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS public.ig_comment_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_run public.ig_comment_runs;
  v_campaign public.ig_comment_campaigns;
  v_new_status text;
  v_scheduled timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT public.has_capability(v_uid, 'manage_automations') THEN
    RAISE EXCEPTION 'forbidden: manage_automations required';
  END IF;
  IF p_decision NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'invalid_decision';
  END IF;

  SELECT * INTO v_run FROM public.ig_comment_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'run_not_found'; END IF;
  IF v_run.status <> 'awaiting_review' THEN
    RAISE EXCEPTION 'run_not_pending_review (status=%)', v_run.status;
  END IF;

  -- Branch isolation: owner/admin can review any; manager only own branch
  IF NOT (
    public.has_any_role(v_uid, ARRAY['owner'::app_role,'admin'::app_role])
    OR v_run.branch_id = public.get_user_branch(v_uid)
  ) THEN
    RAISE EXCEPTION 'forbidden: branch_isolation';
  END IF;

  IF p_decision = 'rejected' THEN
    v_new_status := 'skipped';
    UPDATE public.ig_comment_runs SET
      status = v_new_status,
      skip_reason = 'rejected_by_reviewer',
      reviewed_by = v_uid,
      reviewed_at = now(),
      review_decision = 'rejected',
      review_notes = NULLIF(btrim(coalesce(p_notes,'')),'')
    WHERE id = p_run_id
    RETURNING * INTO v_run;
    RETURN v_run;
  END IF;

  -- Approved → release to executor
  SELECT * INTO v_campaign FROM public.ig_comment_campaigns WHERE id = v_run.campaign_id;
  IF v_campaign.delay_seconds IS NOT NULL AND v_campaign.delay_seconds > 0 THEN
    v_new_status := 'scheduled';
    v_scheduled := now() + make_interval(secs => v_campaign.delay_seconds);
  ELSE
    v_new_status := 'pending';
    v_scheduled := NULL;
  END IF;

  UPDATE public.ig_comment_runs SET
    status = v_new_status,
    scheduled_at = v_scheduled,
    dm_draft = COALESCE(NULLIF(btrim(coalesce(p_edited_body,'')),''), dm_draft),
    reviewed_by = v_uid,
    reviewed_at = now(),
    review_decision = 'approved',
    review_notes = NULLIF(btrim(coalesce(p_notes,'')),'')
  WHERE id = p_run_id
  RETURNING * INTO v_run;
  RETURN v_run;
END;
$$;

REVOKE ALL ON FUNCTION public.review_ig_run(uuid, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.review_ig_run(uuid, text, text, text) TO authenticated;
