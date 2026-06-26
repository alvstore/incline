import { resolveMemberDisplay } from '@/lib/members/resolveMemberDisplay';
import { supabase } from '@/integrations/supabase/client';
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

/**
 * Same as `toInvoicePdfInput` plus async enrichment for membership rows:
 * fetches the plan + benefits and attaches a "Includes:" bullet list and a
 * complimentary-period subtitle (when the membership window exceeds plan duration).
 */
export async function toInvoicePdfInputAsync(invoice: any): Promise<InvoicePdfInput> {
  const base = toInvoicePdfInput(invoice);
  const items = invoice.invoice_items || [];
  const membershipIds: string[] = items
    .filter((i: any) => i.reference_type === 'membership' && i.reference_id)
    .map((i: any) => String(i.reference_id));

  if (membershipIds.length === 0) return base;

  // Pull memberships, plan, and plan_benefits (+ benefit_type name) in two queries.
  const { data: memberships } = await supabase
    .from('memberships')
    .select('id, plan_id, start_date, end_date, plan:plan_id(name, duration_days)')
    .in('id', membershipIds);
  const planIds = Array.from(new Set((memberships || []).map((m: any) => m.plan_id).filter(Boolean)));
  const { data: benefits } = planIds.length
    ? await supabase
        .from('plan_benefits')
        .select('plan_id, benefit_type, frequency, limit_count, description, benefit_type_id, benefit:benefit_type_id(name)')
        .in('plan_id', planIds)
    : { data: [] as any[] };

  const byMembership = new Map<string, any>();
  (memberships || []).forEach((m: any) => byMembership.set(String(m.id), m));
  const benefitsByPlan = new Map<string, any[]>();
  (benefits || []).forEach((b: any) => {
    const list = benefitsByPlan.get(String(b.plan_id)) || [];
    list.push(b);
    benefitsByPlan.set(String(b.plan_id), list);
  });

  base.items = base.items.map((row, idx) => {
    const raw = items[idx];
    if (!raw || raw.reference_type !== 'membership' || !raw.reference_id) return row;
    const m = byMembership.get(String(raw.reference_id));
    if (!m) return row;

    const subtitleBits: string[] = [];
    if (m.start_date && m.end_date) {
      const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      subtitleBits.push(`Valid ${fmt(m.start_date)} → ${fmt(m.end_date)}`);
    }
    if (m.start_date && m.end_date && m.plan?.duration_days) {
      const actual = Math.round((new Date(m.end_date).getTime() - new Date(m.start_date).getTime()) / 86_400_000);
      const extra = actual - m.plan.duration_days;
      if (extra >= 25) {
        const months = Math.round(extra / 30);
        subtitleBits.push(`Includes ${extra} complimentary days${months > 0 ? ` (~${months} month${months > 1 ? 's' : ''} extra)` : ''}`);
      }
    }

    const planBenefits = benefitsByPlan.get(String(m.plan_id)) || [];
    const bullets = planBenefits.slice(0, 8).map((b: any) => {
      const name = b.benefit?.name || b.benefit_type || 'Benefit';
      const count = b.limit_count ? `${b.limit_count}${b.frequency ? ` / ${b.frequency}` : ''}` : null;
      return count ? `${name} — ${count}` : (b.description || name);
    });

    return {
      ...row,
      meta: {
        subtitle: subtitleBits.join(' · ') || undefined,
        bullets: bullets.length ? bullets : undefined,
      },
    };
  });

  return base;
}
