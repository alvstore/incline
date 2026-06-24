import { resolveMemberDisplay } from '@/lib/members/resolveMemberDisplay';
import type { InvoicePdfInput } from '@/utils/pdfBlob';

/**
 * Build the shared PDF input from an invoice row joined with:
 *   members(member_code, profiles, lead), branch:branch_id(...), invoice_items(*), pos_sales(items)
 *
 * Centralised so the Invoice drawer, Invoices list "Download", and any future
 * email/share path produce the exact same brand-correct PDF.
 */
export function toInvoicePdfInput(invoice: any): InvoicePdfInput {
  const memberDisplay = resolveMemberDisplay(invoice?.members, invoice?.customer_name);

  // Build product_id → batches[] from pos_sales.items (set by create_pos_sale RPC).
  const posItems: any[] = Array.isArray(invoice?.pos_sales?.items)
    ? invoice.pos_sales.items
    : Array.isArray(invoice?.pos_sales?.[0]?.items)
      ? invoice.pos_sales[0].items
      : [];
  const batchByProduct = new Map<string, any[]>();
  posItems.forEach((it: any) => {
    if (it?.product_id && Array.isArray(it.batches) && it.batches.length) {
      batchByProduct.set(String(it.product_id), it.batches);
    }
  });

  return {
    invoice_number: invoice.invoice_number,
    created_at: invoice.created_at,
    due_date: invoice.due_date,
    status: invoice.status,
    subtotal: invoice.subtotal || invoice.total_amount,
    discount_amount: invoice.discount_amount || 0,
    tax_amount: invoice.tax_amount || 0,
    total_amount: invoice.total_amount,
    amount_paid: invoice.amount_paid || 0,
    notes: invoice.notes,
    items: (invoice.invoice_items || []).map((i: any) => ({
      description: i.description,
      quantity: i.quantity || 1,
      unit_price: i.unit_price,
      total_amount: i.total_amount,
      hsn_code: i.hsn_code,
      batches: i.reference_id ? batchByProduct.get(String(i.reference_id)) : undefined,
    })),
    member_name: memberDisplay.name,
    member_code: memberDisplay.code,
    member_email: memberDisplay.email || invoice.customer_email,
    member_phone: memberDisplay.phone || invoice.customer_phone,
    branch_name: invoice.branch?.name || '',
    branch_address: invoice.branch?.address,
    branch_phone: invoice.branch?.phone,
    branch_email: invoice.branch?.email,
    gst_number: invoice.branch?.gstin,
    is_gst_invoice: invoice.is_gst_invoice || false,
    gst_rate: invoice.gst_rate || 0,
    customer_gstin: invoice.customer_gstin,
  } as InvoicePdfInput;
}
