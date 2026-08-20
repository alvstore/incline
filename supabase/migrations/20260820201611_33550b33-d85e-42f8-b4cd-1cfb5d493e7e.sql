WITH target_profiles AS (
  SELECT id, full_name
  FROM public.profiles
  WHERE full_name ILIKE ANY (ARRAY['%Advit birla%', '%Punyakrit Singh Jhala%', '%Sachin jain%'])
),
members_to_fix AS (
  SELECT m.id as member_id, m.branch_id, p.full_name
  FROM public.members m
  JOIN target_profiles p ON m.user_id = p.id
),
invoices_to_fix AS (
  SELECT 
    i.id as invoice_id,
    m.member_id,
    m.branch_id,
    i.total_amount - i.amount_paid as balance,
    m.full_name
  FROM public.invoices i
  JOIN members_to_fix m ON i.member_id = m.member_id
  WHERE i.status IN ('pending', 'partial', 'overdue')
    AND i.total_amount > i.amount_paid
)
INSERT INTO public.payment_reminders (
  branch_id,
  member_id,
  invoice_id,
  scheduled_for,
  status,
  reminder_type,
  delivery_metadata
)
SELECT 
  branch_id,
  member_id,
  invoice_id,
  now() as scheduled_for,
  'pending' as status,
  'payment_due' as reminder_type,
  jsonb_build_object(
    'source', 'ai_fix_backfill',
    'reason', 'GST correction / payment follow-up request',
    'force_send', true
  )
FROM invoices_to_fix;