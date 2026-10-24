export interface InvoiceSettlementSource {
  status?: string | null;
  pos_sales?: { settlement?: string | null; buyer_type?: string | null } | null;
}

/** Payroll recovery is not evidence of a cash payment, even for a paid store invoice. */
export function isSalaryDeduction(invoice: InvoiceSettlementSource): boolean {
  return invoice.status !== 'cancelled' && invoice.pos_sales?.settlement === 'salary_deduction';
}

export function invoiceCommunicationEvent(invoice: InvoiceSettlementSource): 'invoice_generated' | 'payment_received' {
  return invoice.status === 'paid' && !isSalaryDeduction(invoice) ? 'payment_received' : 'invoice_generated';
}