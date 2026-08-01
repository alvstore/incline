export interface PaymentDisplayRecord {
  payment_method?: string | null;
  payment_source?: string | null;
  gateway_fee?: number | null;
  gateway_tax?: number | null;
  net_settlement_amount?: number | null;
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
