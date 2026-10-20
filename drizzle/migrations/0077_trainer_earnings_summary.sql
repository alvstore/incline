CREATE OR REPLACE FUNCTION public.trainer_earnings_summary(p_trainer_id uuid, p_month date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch uuid;
  v_user uuid;
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_rows jsonb;
  v_trend jsonb;
BEGIN
  SELECT branch_id, user_id INTO v_branch, v_user FROM trainers WHERE id = p_trainer_id;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'trainer not found'; END IF;

  IF public.rpc_guard_applies('trainer_earnings_summary') THEN
    IF NOT (
      v_user = auth.uid()
      OR public.has_any_role(auth.uid(), ARRAY['owner','admin']::app_role[])
      OR v_branch IN (SELECT public.managed_branch_ids(auth.uid()))
    ) THEN
      RAISE EXCEPTION 'not allowed';
    END IF;
  END IF;

  SELECT coalesce(jsonb_agg(r ORDER BY r->>'payout_month' DESC, r->>'member_name'), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'installment_id', i.id,
      'payout_month', i.payout_month,
      'installment_index', i.installment_index,
      'installment_count', coalesce(c.plan_duration_months, 1),
      'amount', i.installment_amount,
      'status', i.status,
      'blocked_reason', i.blocked_reason,
      'paid_at', i.paid_at,
      'member_name', coalesce(pr.full_name, m.member_code, 'Member'),
      'package_name', pp.name,
      'sale_amount', c.total_sale_amount,
      'commission_base', c.base_commission,
      'share_pct', c.percentage,
      'gst_deduction', c.gst_deduction,
      'net_commission', coalesce(c.net_total_commission, c.amount),
      'invoice_balance', CASE WHEN inv.id IS NULL THEN NULL ELSE greatest(coalesce(inv.total_amount,0) - coalesce(inv.amount_paid,0), 0) END
    ) AS r
    FROM pt_commission_installments i
    JOIN trainer_commissions c ON c.id = i.commission_id
    LEFT JOIN members m ON m.id = c.member_id
    LEFT JOIN profiles pr ON pr.id = m.user_id
    LEFT JOIN member_pt_packages mpp ON mpp.id = c.pt_package_id
    LEFT JOIN pt_packages pp ON pp.id = mpp.package_id
    LEFT JOIN invoices inv ON inv.id = mpp.invoice_id
    WHERE i.trainer_id = p_trainer_id
      AND i.status <> 'cancelled'
      AND (i.payout_month BETWEEN v_start AND v_end OR (i.status = 'blocked' AND i.payout_month <= v_end) OR (i.status = 'pending' AND i.payout_month > v_end))
  ) s;

  SELECT coalesce(jsonb_agg(jsonb_build_object('month', mth, 'paid', paid, 'pending', pending) ORDER BY mth), '[]'::jsonb) INTO v_trend
  FROM (
    SELECT g.mth::date AS mth,
      coalesce(sum(i.installment_amount) FILTER (WHERE i.status = 'paid'), 0) AS paid,
      coalesce(sum(i.installment_amount) FILTER (WHERE i.status IN ('pending','blocked')), 0) AS pending
    FROM generate_series(v_start - interval '5 months', v_start, interval '1 month') g(mth)
    LEFT JOIN pt_commission_installments i
      ON i.trainer_id = p_trainer_id AND i.payout_month = g.mth::date AND i.status <> 'cancelled'
    GROUP BY g.mth
  ) t;

  RETURN jsonb_build_object('installments', v_rows, 'trend', v_trend);
END;
$$;

REVOKE ALL ON FUNCTION public.trainer_earnings_summary(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trainer_earnings_summary(uuid, date) TO authenticated, service_role;