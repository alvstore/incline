CREATE INDEX IF NOT EXISTS idx_member_attendance_branch_check_in ON public.member_attendance (branch_id, check_in DESC);
CREATE INDEX IF NOT EXISTS idx_payments_branch_payment_date ON public.payments (branch_id, payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_memberships_branch_status ON public.memberships (branch_id, status);

ALTER ROLE authenticated SET statement_timeout = '20s';
ALTER ROLE authenticated SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE anon SET statement_timeout = '10s';
ALTER ROLE anon SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE service_role SET statement_timeout = '60s';
ALTER ROLE service_role SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE authenticator SET idle_in_transaction_session_timeout = '15s';