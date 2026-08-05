ALTER TABLE public.meal_catalog ADD COLUMN IF NOT EXISTS micronutrients text;

-- ---------- document series ----------
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS document_series text;
ALTER TABLE public.invoice_number_counters ADD COLUMN IF NOT EXISTS series text NOT NULL DEFAULT 'INV';

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.invoice_number_counters'::regclass
      AND contype IN ('p','u')
  LOOP
    EXECUTE format('ALTER TABLE public.invoice_number_counters DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

DROP INDEX IF EXISTS public.invoice_number_counters_branch_year_key;
CREATE UNIQUE INDEX IF NOT EXISTS invoice_number_counters_branch_year_series_key
  ON public.invoice_number_counters (branch_id, year_yy, series);

-- backfill series on existing invoices from the current prefix / gst flag
UPDATE public.invoices
SET document_series = CASE
  WHEN invoice_number LIKE 'BOS-%' THEN 'BOS'
  WHEN COALESCE(is_gst_invoice, false) THEN 'INV'
  ELSE 'INV-LEGACY-EXEMPT'
END
WHERE document_series IS NULL;

CREATE OR REPLACE FUNCTION public.generate_invoice_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_branch_code TEXT;
  v_yy          TEXT;
  v_seq         INTEGER;
  v_series      TEXT;
BEGIN
  SELECT code INTO v_branch_code FROM public.branches WHERE id = NEW.branch_id;
  IF v_branch_code IS NULL THEN
    v_branch_code := 'X';
  END IF;
  v_yy := TO_CHAR(CURRENT_DATE, 'YY');

  -- Taxable supplies -> tax invoice series; exempt / non-GST -> bill of supply series
  v_series := CASE WHEN COALESCE(NEW.is_gst_invoice, false) THEN 'INV' ELSE 'BOS' END;

  INSERT INTO public.invoice_number_counters (branch_id, year_yy, series, last_seq)
  VALUES (NEW.branch_id, v_yy, v_series, 1)
  ON CONFLICT (branch_id, year_yy, series) DO UPDATE
    SET last_seq = public.invoice_number_counters.last_seq + 1,
        updated_at = now()
  RETURNING last_seq INTO v_seq;

  NEW.document_series := v_series;
  NEW.invoice_number := v_series || '-' || v_branch_code || '-' || v_yy || '-' || LPAD(v_seq::text, 4, '0');
  RETURN NEW;
END;
$function$;

-- seed BOS counters so new bills of supply start after any legacy exempt numbering
INSERT INTO public.invoice_number_counters (branch_id, year_yy, series, last_seq)
SELECT b.id, TO_CHAR(CURRENT_DATE, 'YY'), 'BOS', 0
FROM public.branches b
WHERE NOT EXISTS (
  SELECT 1 FROM public.invoice_number_counters c
  WHERE c.branch_id = b.id AND c.year_yy = TO_CHAR(CURRENT_DATE, 'YY') AND c.series = 'BOS'
)
ON CONFLICT DO NOTHING;

-- ---------- security: branch-scope managers on member_documents ----------
DROP POLICY IF EXISTS "Owners admins managers manage documents" ON public.member_documents;

CREATE POLICY "Owners and admins manage documents"
ON public.member_documents
FOR ALL
TO authenticated
USING (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]))
WITH CHECK (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]));

CREATE POLICY "Managers manage documents in their branches"
ON public.member_documents
FOR ALL
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['manager'::app_role])
  AND member_id IN (
    SELECT m.id FROM public.members m
    WHERE m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['manager'::app_role])
  AND member_id IN (
    SELECT m.id FROM public.members m
    WHERE m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
);