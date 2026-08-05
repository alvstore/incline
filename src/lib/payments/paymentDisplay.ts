export interface PaymentDisplayRecord {
  status?: string | null;
  voided_at?: string | null;
  void_reason?: string | null;
  payment_method?: string | null;
  payment_source?: string | null;
  gateway_fee?: number | null;
  gateway_tax?: number | null;
  net_settlement_amount?: number | null;
}

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

export function reversalCaption(payment: PaymentDisplayRecord): string | null {
  if (!isReversedPayment(payment)) return null;
  const label = payment.status === 'refunded' ? 'Refunded' : 'Voided';
  return payment.void_reason ? `${label} — ${payment.void_reason}` : `${label} — reversed entry`;
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
