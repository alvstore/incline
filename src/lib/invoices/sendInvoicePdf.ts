/**
 * sendInvoicePdfToMember
 *
 * Single-shot helper that: (1) fetches the full invoice, (2) generates the
 * branded PDF via the existing `generateInvoicePdfBlob` SSOT, (3) uploads it
 * to the shared attachments bucket, and (4) dispatches the download link over
 * WhatsApp AND Email through the canonical `dispatch-communication` edge fn.
 *
 * Fire-and-forget by design — callers should NOT block their UI on this. The
 * dispatcher already handles retries, quiet hours, do-not-contact and
 * template resolution, so we only surface hard failures via console.warn.
 *
 * IMPORTANT: browsers own the PDF codepath today (pdf-lib + brand assets in
 * the frontend), so this helper must run client-side. Wire calls from the
 * client after successful payment/checkout — never from an edge function.
 */
import { supabase } from '@/integrations/supabase/client';
import { generateInvoicePdfBlob } from '@/utils/invoicePdf';
import { uploadAttachment } from '@/utils/uploadAttachment';
import { dispatchCommunication, buildDedupeKey } from '@/lib/comms/dispatch';

export interface SendInvoicePdfOptions {
  /** Skip sending if invoice is not fully paid yet. Default true — receipts only. */
  paidOnly?: boolean;
  /** Additional dedupe salt so the same invoice can be re-sent for a new event. */
  dedupeSalt?: string;
}

export interface SendInvoicePdfResult {
  ok: boolean;
  whatsapp?: { status: string; reason?: string };
  email?: { status: string; reason?: string };
  skipped?: string;
  error?: string;
}

export async function sendInvoicePdfToMember(
  invoiceId: string,
  opts: SendInvoicePdfOptions = {},
): Promise<SendInvoicePdfResult> {
  const { paidOnly = true, dedupeSalt = '' } = opts;

  try {
    const { data: inv, error } = await supabase
      .from('invoices')
      .select(`
        id, invoice_number, branch_id, member_id, total_amount, amount_paid, status,
        customer_email, customer_phone,
        members(profiles:user_id(full_name, email, phone)),
        branch:branch_id(name)
      `)
      .eq('id', invoiceId)
      .maybeSingle();

    if (error || !inv) return { ok: false, error: error?.message || 'invoice_not_found' };
    if (paidOnly && inv.status !== 'paid') {
      return { ok: false, skipped: `invoice_status=${inv.status}` };
    }

    const profile = (inv.members as any)?.profiles;
    const email = profile?.email || inv.customer_email;
    const phone = profile?.phone || inv.customer_phone;
    const name = profile?.full_name || 'Member';
    const branchName = (inv.branch as any)?.name || 'The Incline';

    if (!email && !phone) return { ok: false, skipped: 'no_contact_channel' };

    const pdf = await generateInvoicePdfBlob(inv.id);
    if (pdf.size < 1024) return { ok: false, error: 'pdf_generation_empty' };

    const filename = `Invoice-${inv.invoice_number}.pdf`;
    const { url } = await uploadAttachment(pdf, {
      folder: 'invoices',
      filename,
      contentType: 'application/pdf',
    });

    const variables = {
      name,
      member_name: name,
      invoice_number: inv.invoice_number,
      amount: `₹${Number(inv.total_amount).toLocaleString('en-IN')}`,
      branch_name: branchName,
      document_link: url,
    };
    const fallback = `Hi ${name}, your invoice ${inv.invoice_number} for ₹${Number(inv.total_amount).toLocaleString('en-IN')} is ready. Download: ${url}`;

    const results: SendInvoicePdfResult = { ok: true };

    if (phone) {
      try {
        const wa = await dispatchCommunication({
          branch_id: inv.branch_id,
          channel: 'whatsapp',
          category: 'payment_receipt',
          member_id: inv.member_id ?? null,
          recipient: phone,
          payload: { body: fallback, variables },
          attachment: { url, filename, content_type: 'application/pdf', kind: 'document' },
          dedupe_key: buildDedupeKey(['invoice', inv.id, 'wa', dedupeSalt]),
          force: true,
        });
        results.whatsapp = { status: wa.status, reason: wa.reason };
      } catch (e: any) {
        results.whatsapp = { status: 'failed', reason: e?.message };
      }
    }

    if (email) {
      try {
        const em = await dispatchCommunication({
          branch_id: inv.branch_id,
          channel: 'email',
          category: 'payment_receipt',
          member_id: inv.member_id ?? null,
          recipient: email,
          payload: {
            subject: `Your invoice ${inv.invoice_number} — ${branchName}`,
            body: `<p>Hi ${name},</p><p>Thank you for your payment. Your invoice <strong>${inv.invoice_number}</strong> for <strong>₹${Number(inv.total_amount).toLocaleString('en-IN')}</strong> is attached and available at the link below.</p><p><a href="${url}">Download invoice PDF</a></p><p>— Team ${branchName}</p>`,
            use_branded_template: true,
            variables,
          },
          attachment: { url, filename, content_type: 'application/pdf', kind: 'document' },
          dedupe_key: buildDedupeKey(['invoice', inv.id, 'email', dedupeSalt]),
          force: true,
        });
        results.email = { status: em.status, reason: em.reason };
      } catch (e: any) {
        results.email = { status: 'failed', reason: e?.message };
      }
    }

    return results;
  } catch (e: any) {
    console.warn('[sendInvoicePdfToMember] failed', e);
    return { ok: false, error: e?.message || 'unknown' };
  }
}
