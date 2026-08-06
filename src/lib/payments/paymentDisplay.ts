export interface PaymentDisplayRecord {
  status?: string | null;
  voided_at?: string | null;
  void_reason?: string | null;
  payment_method?: string | null;
  payment_source?: string | null;
  gateway_fee?: number | null;
  gateway_tax?: number | null;
  net_settlement_amount?: number | null;
  lifecycle_metadata?: Record<string, unknown> | null;
}

export type ReversalKind = 'void' | 'refund' | null;

/**
 * A reversed payment (voided or refunded) is an audit-trail row, not money in
 * the till. It must never be counted in collections and must read as cancelled
 * everywhere it is listed.
 */
export function isReversedPayment(payment: PaymentDisplayRecord): boolean {
  return (
    payment.status === 'voided' ||
    payment.status === 'refunded' ||
    Boolean(payment.voided_at)
  );
}

/**
 * A VOID is an internal correction — the money was never actually returned to
 * the member (wrong amount, wrong method, duplicate entry). A REFUND is real
 * cash going back out of the business. They must never share a label.
 */
export function reversalKind(payment: PaymentDisplayRecord): ReversalKind {
  if (!isReversedPayment(payment)) return null;
  const tagged = (payment.lifecycle_metadata as { reversal_kind?: string } | null)?.reversal_kind;
  if (tagged === 'void' || tagged === 'refund') return tagged;
  if (payment.status === 'voided') return 'void';
  if (payment.voided_at) return 'void';
  return 'refund';
}

export function reversalLabel(payment: PaymentDisplayRecord): string | null {
  const kind = reversalKind(payment);
  if (!kind) return null;
  return kind === 'refund' ? 'Refunded' : 'Voided';
}

export function reversalCaption(payment: PaymentDisplayRecord): string | null {
  const label = reversalLabel(payment);
  if (!label) return null;
  const suffix = label === 'Refunded' ? 'money returned to member' : 'correction, no money returned';
  return payment.void_reason ? `${label} — ${payment.void_reason}` : `${label} — ${suffix}`;
}



const titleCase = (value?: string | null) =>
  value ? value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Unknown';

export function paymentChannelLabel(payment: PaymentDisplayRecord): string {
  const instrument = titleCase(payment.payment_method);
  const source = payment.payment_source && payment.payment_source !== 'manual'
    ? titleCase(payment.payment_source)
    : 'Manual';
  return `${source} · ${instrument}`;
}

export function gatewayDeduction(payment: PaymentDisplayRecord): number {
  return Number(payment.gateway_fee || 0) + Number(payment.gateway_tax || 0);
}
