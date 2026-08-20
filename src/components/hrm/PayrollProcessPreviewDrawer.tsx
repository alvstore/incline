import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, ArrowRight, ShieldCheck } from 'lucide-react';

interface PayrollProcessPreviewDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: any;
}

export function PayrollProcessPreviewDrawer({ open, onOpenChange, item }: PayrollProcessPreviewDrawerProps) {
  const qc = useQueryClient();

  const processMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('payroll_process_items', { p_item_ids: [item.id] });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Payroll processed for ${item?.profile?.full_name}`);
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ['payroll-items'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (!item) return null;

  const totalDeductions = Number(item.final_deductions) + Number(item.final_advance) + Number(item.final_penalty);
  const isAdjusted = Number(item.final_net) !== Number(item.calc_net);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader className="mb-6">
          <SheetTitle>Review & Process Payroll</SheetTitle>
        </SheetHeader>

        <div className="space-y-6">
          <div className="p-4 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center gap-4">
            <div className="h-12 w-12 rounded-full bg-white flex items-center justify-center text-indigo-600 font-bold text-lg shadow-sm">
              {item.profile?.full_name?.[0] || 'S'}
            </div>
            <div>
              <h3 className="font-bold text-slate-900">{item.profile?.full_name}</h3>
              <p className="text-sm text-slate-500">{item.staff_kind} • {item.id.slice(0, 8)}</p>
            </div>
            {isAdjusted && (
              <Badge variant="outline" className="ml-auto bg-amber-50 text-amber-700 border-amber-200">
                Adjusted
              </Badge>
            )}
          </div>

          <div className="space-y-4">
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Earnings Breakdown</h4>
            <div className="space-y-3">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-600">Base Salary</span>
                <span className="font-mono font-medium">₹{Number(item.final_base).toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-600">PT Commission</span>
                <span className="font-mono font-medium">₹{Number(item.final_pt_commission).toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-600">Bonus & Overtime</span>
                <span className="font-mono font-medium">₹{(Number(item.final_bonus) + Number(item.final_ot)).toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div className="space-y-4 pt-2 border-t border-dashed border-slate-200">
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Deductions</h4>
            <div className="space-y-3">
              <div className="flex justify-between items-center text-sm text-red-600">
                <span>Statutory Deductions</span>
                <span className="font-mono font-medium">-₹{Number(item.final_deductions).toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center text-sm text-red-600">
                <span>Advance Recovery</span>
                <span className="font-mono font-medium">-₹{Number(item.final_advance).toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center text-sm text-red-600">
                <span>Penalties</span>
                <span className="font-mono font-medium">-₹{Number(item.final_penalty).toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div className="mt-8 p-6 rounded-2xl bg-indigo-600 text-white shadow-xl shadow-indigo-200">
            <div className="flex justify-between items-end">
              <div>
                <p className="text-xs text-indigo-100 font-medium uppercase tracking-widest mb-1">Net Payable Amount</p>
                <h2 className="text-3xl font-bold">₹{Number(item.final_net).toLocaleString()}</h2>
              </div>
              <ShieldCheck className="h-8 w-8 text-indigo-300 opacity-50" />
            </div>
          </div>

          {item.adjustment_reason && (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Adjustment Reason</p>
              <p className="text-sm text-slate-600 italic">"{item.adjustment_reason}"</p>
            </div>
          )}
        </div>

        <SheetFooter className="mt-8 flex-col sm:flex-row gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl flex-1 border-slate-200">
            Cancel
          </Button>
          <Button 
            onClick={() => processMut.mutate()} 
            disabled={processMut.isPending}
            className="rounded-xl flex-1 bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200"
          >
            {processMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ArrowRight className="h-4 w-4 mr-2" />}
            Confirm & Process
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
