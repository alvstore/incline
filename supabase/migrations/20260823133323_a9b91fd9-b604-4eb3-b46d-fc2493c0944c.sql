CREATE OR REPLACE FUNCTION public.generate_renewal_invoices()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  ms RECORD;
  inv_exists boolean;
  new_invoice_id uuid;
BEGIN
  FOR ms IN
    SELECT m.id as membership_id, m.member_id, m.branch_id, m.plan_id,
           mp.name as plan_name, mp.price as plan_price,
           mem.user_id
    FROM memberships m
    JOIN membership_plans mp ON m.plan_id = mp.id
    JOIN members mem ON mem.id = m.member_id
    WHERE m.status = 'active'
    AND m.end_date = CURRENT_DATE + INTERVAL '7 days'
  LOOP
    SELECT EXISTS(
      SELECT 1 FROM invoices i
      JOIN invoice_items ii ON ii.invoice_id = i.id
      WHERE i.member_id = ms.member_id
      AND ii.reference_type = 'membership_renewal'
      AND i.status = 'pending'
      AND i.created_at > CURRENT_DATE - INTERVAL '10 days'
    ) INTO inv_exists;

    IF NOT inv_exists THEN
      INSERT INTO invoices (
        branch_id, member_id, invoice_number, subtotal, discount_amount,
        tax_amount, total_amount, status, due_date
      )
      VALUES (
        ms.branch_id, ms.member_id, NULL, ms.plan_price, 0,
        0, ms.plan_price, 'pending', CURRENT_DATE + INTERVAL '7 days'
      )
      RETURNING id INTO new_invoice_id;

      INSERT INTO invoice_items (invoice_id, description, unit_price, quantity, total_amount, reference_type, reference_id)
      VALUES (new_invoice_id, 'Membership Renewal - ' || ms.plan_name, ms.plan_price, 1, ms.plan_price, 'membership_renewal', ms.membership_id);

      INSERT INTO notifications (user_id, branch_id, title, message, type, category)
      VALUES (ms.user_id, ms.branch_id, 'Renewal Invoice Generated',
        'Your membership renewal invoice for ' || ms.plan_name || ' (₹' || ms.plan_price || ') has been generated. Due in 7 days.',
        'info', 'billing');
    END IF;
  END LOOP;
END;
$function$;