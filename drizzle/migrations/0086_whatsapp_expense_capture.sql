ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS source text;

CREATE TABLE public.chat_expense_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  expense_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes'
);
GRANT ALL ON public.chat_expense_drafts TO service_role;
ALTER TABLE public.chat_expense_drafts ENABLE ROW LEVEL SECURITY;
CREATE INDEX chat_expense_drafts_actor_idx ON public.chat_expense_drafts(actor_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.record_expense_for_actor(
  p_actor_user_id uuid, p_branch_id uuid, p_amount numeric, p_description text,
  p_expense_type expense_kind DEFAULT 'general', p_category_id uuid DEFAULT NULL,
  p_vendor text DEFAULT NULL, p_expense_date date DEFAULT CURRENT_DATE,
  p_payment_method payment_method DEFAULT NULL, p_employee_user_id uuid DEFAULT NULL,
  p_source text DEFAULT 'whatsapp')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_adv uuid;
BEGIN
  IF p_actor_user_id IS NULL THEN RETURN jsonb_build_object('success',false,'error','Unknown sender'); END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN jsonb_build_object('success',false,'error','Amount must be greater than zero'); END IF;
  IF p_description IS NULL OR btrim(p_description)='' THEN RETURN jsonb_build_object('success',false,'error','Description is required'); END IF;
  IF p_expense_type='salary_advance' AND p_employee_user_id IS NULL THEN RETURN jsonb_build_object('success',false,'error','Salary advance needs a team member'); END IF;
  IF NOT (has_role(p_actor_user_id,'owner') OR has_role(p_actor_user_id,'admin')
     OR (has_role(p_actor_user_id,'manager') AND p_branch_id IN (SELECT branch_id FROM branch_managers WHERE user_id=p_actor_user_id))) THEN
    RETURN jsonb_build_object('success',false,'error','Not authorised to record expenses for this branch');
  END IF;
  INSERT INTO expenses(branch_id,category_id,amount,description,vendor,expense_date,status,submitted_by,expense_type,payment_method,paid_at,paid_by,is_paid,employee_user_id,source)
  VALUES (p_branch_id,p_category_id,p_amount,p_description,p_vendor,COALESCE(p_expense_date,CURRENT_DATE),'pending',p_actor_user_id,p_expense_type,p_payment_method,COALESCE(p_expense_date,CURRENT_DATE),p_actor_user_id,true,p_employee_user_id,p_source)
  RETURNING id INTO v_id;
  IF p_expense_type='salary_advance' THEN
    INSERT INTO salary_advances(branch_id,user_id,expense_id,amount,outstanding,paid_on,payment_method,reason,auto_recover,created_by)
    VALUES (p_branch_id,p_employee_user_id,v_id,p_amount,p_amount,COALESCE(p_expense_date,CURRENT_DATE),p_payment_method,p_description,true,p_actor_user_id)
    RETURNING id INTO v_adv;
  END IF;
  RETURN jsonb_build_object('success',true,'expense_id',v_id,'advance_id',v_adv);
END $$;
REVOKE ALL ON FUNCTION public.record_expense_for_actor(uuid,uuid,numeric,text,expense_kind,uuid,text,date,payment_method,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_expense_for_actor(uuid,uuid,numeric,text,expense_kind,uuid,text,date,payment_method,uuid,text) TO service_role;