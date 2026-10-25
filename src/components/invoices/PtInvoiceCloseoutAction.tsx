import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { can } from '@/lib/auth/permissions';
import { PtInvoiceCloseoutDrawer } from './PtInvoiceCloseoutDrawer';

export interface PtInvoiceCloseoutActionProps {
  invoiceId: string; branchId: string; isPt: boolean; hasBalance: boolean;
}
export function PtInvoiceCloseoutAction({ invoiceId, branchId, isPt, hasBalance }: PtInvoiceCloseoutActionProps) {
  const [open, setOpen] = useState(false);
  const { roles } = useAuth();
  const permitted = can.cancelInvoice(roles);
  const flag = useQuery({
    queryKey: ['settings', 'pt_invoice_closeout_enabled', branchId], enabled: permitted && isPt,
    queryFn: async () => {
      const { data, error } = await supabase.from('settings').select('value').eq('key', 'pt_invoice_closeout_enabled').eq('branch_id', branchId).maybeSingle();
      if (error) throw error;
      return data?.value === true;
    },
  });
  const history = useQuery({
    queryKey: ['pt-closeout-history', invoiceId], enabled: permitted && isPt,
    queryFn: async () => {
      const { data, error } = await supabase.from('pt_invoice_closeouts').select('waived_amount,confirmed_external_commission,created_at').eq('invoice_id', invoiceId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  if (!permitted || !isPt) return null;
  if (history.data) return <Badge variant="outline" className="mt-2 block min-w-36 whitespace-normal rounded-md text-warning">PT closed · ₹{history.data.waived_amount.toLocaleString('en-IN')} waived</Badge>;
  if (!flag.data || !hasBalance) return null;
  return <>
    <Button variant="outline" size="sm" className="mt-2 min-h-11 cursor-pointer gap-2 transition-colors duration-200" onClick={() => setOpen(true)}><CheckCircle2 className="h-4 w-4" />Close PT &amp; waive balance</Button>
    {open && <PtInvoiceCloseoutDrawer invoiceId={invoiceId} open={open} onOpenChange={setOpen} />}
  </>;
}