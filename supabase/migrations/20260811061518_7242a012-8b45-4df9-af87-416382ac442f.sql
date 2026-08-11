REVOKE EXECUTE ON FUNCTION public.record_expense(uuid,numeric,text,public.expense_kind,uuid,text,date,text,public.payment_method,text,date,text,boolean,uuid,boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.edit_expense(uuid,text,numeric,text,uuid,text,date,public.payment_method,text,date,text,boolean,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pending_advance_for_user(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.apply_advance_recovery(uuid, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tg_touch_updated_at() FROM PUBLIC, anon;
