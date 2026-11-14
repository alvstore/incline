// Splits a captured gateway amount into the part credited to the invoice and
// the online convenience fee. The invoice is only ever credited with its own
// outstanding balance; anything above it is the fee.
export function splitCapturedAmount(charged: number, invoiceDue: number) {
  const paid = Math.round(Number(charged || 0) * 100) / 100;
  const due = Math.max(0, Math.round(Number(invoiceDue || 0) * 100) / 100);
  const base = due > 0 ? Math.min(paid, due) : paid;
  const fee = Math.round((paid - base) * 100) / 100;
  return { base, fee };
}
