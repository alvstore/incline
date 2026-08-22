-- 1. Fix punch_duty branch resolution -------------------------------------
CREATE OR REPLACE FUNCTION public.punch_duty(p_shift_type text DEFAULT 'full_day'::text, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS staff_attendance
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_open  public.staff_attendance%ROWTYPE;
  v_row   public.staff_attendance%ROWTYPE;
  v_branch uuid := p_branch_id;
  v_shift public.attendance_shift_type;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  BEGIN
    v_shift := p_shift_type::public.attendance_shift_type;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid shift_type: %', p_shift_type;
  END;

  SELECT * INTO v_open
    FROM public.staff_attendance
   WHERE user_id = v_uid
     AND shift_type = v_shift
     AND check_out IS NULL
   ORDER BY check_in DESC
   LIMIT 1
   FOR UPDATE;

  IF FOUND THEN
    UPDATE public.staff_attendance
       SET check_out = now()
     WHERE id = v_open.id
     RETURNING * INTO v_row;
    RETURN v_row;
  END IF;

  IF v_branch IS NULL THEN
    SELECT branch_id INTO v_branch FROM public.trainers WHERE user_id = v_uid LIMIT 1;
  END IF;
  IF v_branch IS NULL THEN
    SELECT branch_id INTO v_branch FROM public.employees WHERE user_id = v_uid LIMIT 1;
  END IF;
  IF v_branch IS NULL THEN
    v_branch := public.get_user_branch(v_uid);
  END IF;

  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'No branch resolved for punch-in';
  END IF;

  INSERT INTO public.staff_attendance (user_id, branch_id, check_in, shift_type)
  VALUES (v_uid, v_branch, now(), v_shift)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- 2. Trainer PT billing summary -------------------------------------------
CREATE OR REPLACE FUNCTION public.get_trainer_pt_billing(_trainer_id uuid DEFAULT NULL)
RETURNS TABLE (
  package_row_id uuid,
  member_id uuid,
  member_code text,
  member_name text,
  package_name text,
  package_type text,
  sold_on timestamptz,
  price_paid numeric,
  amount_paid numeric,
  balance_due numeric,
  payment_due_date date,
  invoice_number text,
  payment_state text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_trainer uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF public.has_any_role(v_uid, ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role]) AND _trainer_id IS NOT NULL THEN
    v_trainer := _trainer_id;
  ELSE
    SELECT t.id INTO v_trainer FROM public.trainers t WHERE t.user_id = v_uid LIMIT 1;
    IF v_trainer IS NULL THEN
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    mpp.id,
    mpp.member_id,
    m.member_code,
    COALESCE(p.full_name, m.member_code)::text,
    pk.name::text,
    COALESCE(mpp.package_type::text, 'session_based'),
    mpp.created_at,
    COALESCE(mpp.price_paid, 0)::numeric,
    COALESCE(inv.amount_paid, 0)::numeric,
    GREATEST(COALESCE(inv.total_amount, mpp.price_paid, 0) - COALESCE(inv.amount_paid, 0), 0)::numeric,
    inv.payment_due_date,
    inv.invoice_number,
    CASE
      WHEN inv.id IS NULL THEN COALESCE(mpp.payment_status, 'unknown')
      WHEN inv.status::text IN ('cancelled','refunded') THEN inv.status::text
      WHEN COALESCE(inv.amount_paid,0) >= COALESCE(inv.total_amount,0) THEN 'paid'
      WHEN inv.payment_due_date IS NOT NULL AND inv.payment_due_date < CURRENT_DATE THEN 'overdue'
      WHEN COALESCE(inv.amount_paid,0) > 0 THEN 'partial'
      ELSE 'pending'
    END::text
  FROM public.member_pt_packages mpp
  JOIN public.members m ON m.id = mpp.member_id
  LEFT JOIN public.profiles p ON p.id = m.user_id
  LEFT JOIN public.pt_packages pk ON pk.id = mpp.package_id
  LEFT JOIN public.invoices inv ON inv.id = mpp.invoice_id
  WHERE mpp.trainer_id = v_trainer
  ORDER BY mpp.created_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_trainer_pt_billing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_trainer_pt_billing(uuid) TO authenticated;

-- 3. Move MIPS sync secret out of branch_settings --------------------------
CREATE TABLE IF NOT EXISTS public.branch_sync_secrets (
  settings_id uuid PRIMARY KEY REFERENCES public.branch_settings(id) ON DELETE CASCADE,
  branch_id uuid,
  mips_sync_secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.branch_sync_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.branch_sync_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.branch_sync_secrets TO service_role;

INSERT INTO public.branch_sync_secrets (settings_id, branch_id, mips_sync_secret)
SELECT bs.id, bs.branch_id, bs.mips_sync_secret
FROM public.branch_settings bs
WHERE bs.mips_sync_secret IS NOT NULL
ON CONFLICT (settings_id) DO NOTHING;

ALTER TABLE public.branch_settings DROP COLUMN IF EXISTS mips_sync_secret;

CREATE OR REPLACE FUNCTION public.tg_sync_hardware_access_to_mips()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_secret text;
  v_action text;
BEGIN
  IF NEW.member_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT s.mips_sync_secret INTO v_secret
  FROM public.branch_sync_secrets s
  WHERE (s.branch_id = NEW.branch_id OR s.branch_id IS NULL)
  ORDER BY s.branch_id NULLS LAST
  LIMIT 1;

  v_action := CASE WHEN NEW.new_status = 'active' THEN 'restore' ELSE 'revoke' END;

  PERFORM net.http_post(
    url := 'https://iyqqpbvnszyrrgerniog.supabase.co/functions/v1/mips-access',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hardware-sync-secret', COALESCE(v_secret, '')
    ),
    body := jsonb_build_object(
      'action', v_action,
      'member_id', NEW.member_id,
      'branch_id', NEW.branch_id,
      'reason', COALESCE(NEW.reason, 'access state change')
    ),
    timeout_milliseconds := 8000
  );

  RETURN NEW;
END;
$function$;