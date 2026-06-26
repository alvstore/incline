import { supabase } from '@/integrations/supabase/client';
import { buildInvoicePdf, resolveBrandAsync } from '@/utils/pdfBlob';
import { toInvoicePdfInputAsync } from '@/utils/invoicePdfInput';

/**
 * Single source of truth for invoice PDF generation.
 * Used by:
 *  - InvoiceViewDrawer "Download" button
 *  - Invoices list "Download" row action
 *  - InvoiceShareDrawer (WhatsApp / Email attachments)
 *
 * Accepts either a fully-joined invoice row OR just an invoice id.
 * Fetches the full join when needed so callers can't pass partial data.
 */
export async function generateInvoicePdfBlob(invoiceOrId: any | string): Promise<Blob> {
  const invoice = typeof invoiceOrId === 'string'
    ? await fetchFullInvoice(invoiceOrId)
    : (hasJoinedFields(invoiceOrId) ? invoiceOrId : await fetchFullInvoice(invoiceOrId.id));

  const [input, brand] = await Promise.all([
    toInvoicePdfInputAsync(invoice),
    resolveBrandAsync(invoice?.branch_id, invoice?.branch?.name),
  ]);
  return buildInvoicePdf(input, brand);
}

function hasJoinedFields(inv: any): boolean {
  return !!(inv && inv.invoice_items && inv.branch);
}

async function fetchFullInvoice(id: string) {
  const { data, error } = await supabase
    .from('invoices')
    .select(`
      *,
      members(member_code, profiles:user_id(full_name, email, phone), lead:lead_id(full_name, email, phone, avatar_url)),
      branch:branch_id(name, address, phone, email, gstin),
      invoice_items(*),
      pos_sales!invoices_pos_sale_id_fkey(items)
    `)
    .eq('id', id)
    .single();
  if (error || !data) throw error || new Error('Invoice not found');
  return data;
}
