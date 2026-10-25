import { supabase } from '@/integrations/supabase/client';
import { ptCloseoutError, ptCloseoutPreviewSchema } from '@/lib/invoices/ptCloseout';

export async function previewPtCloseout(invoiceId: string, externalCommission: number) {
  const { data, error } = await supabase.rpc('closeout_pt_invoice', {
    p_invoice_id: invoiceId, p_external_commission: externalCommission, p_preview: true,
  });
  if (error) throw new Error(ptCloseoutError(error));
  return ptCloseoutPreviewSchema.parse(data);
}

export async function savePtCloseout(args: {
  invoiceId: string; externalCommission: number; reason: string; total: number; paid: number;
}) {
  const { data, error } = await supabase.rpc('closeout_pt_invoice', {
    p_invoice_id: args.invoiceId, p_external_commission: args.externalCommission,
    p_reason: args.reason, p_expected_total: args.total, p_expected_paid: args.paid, p_preview: false,
  });
  if (error) throw new Error(ptCloseoutError(error));
  return ptCloseoutPreviewSchema.parse(data);
}