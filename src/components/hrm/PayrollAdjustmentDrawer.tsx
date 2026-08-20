import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, HandCoins } from 'lucide-react';
import { pendingAdvanceForUser } from '@/services/expenseService';

interface PayrollAdjustmentDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: any;
}

export function PayrollAdjustmentDrawer({ open, onOpenChange, item }: PayrollAdjustmentDrawerProps) {
  const qc = useQueryClient();
  const [adjustReason, setAdjustReason] = useState('');
  const [formData, setFormData] = useState<any>(null);

  useEffect(() => {
    if (item) {
      setFormData({
        final_base: item.final_base || 0,
        final_pt_commission: item.final_pt_commission || 0,
        final_ot: item.final_ot || 0,
        final_bonus: item.final_bonus || 0,
        final_deductions: item.final_deductions || 0,
        final_advance: item.final_advance || 0,
        final_penalty: item.final_penalty || 0,
      });
      setAdjustReason(item.adjustment_reason || '');
    }
  }, [item]);

  const { data: pendingAdvance = 0 } = useQuery({
    queryKey: ['pending-advance', item?.user_id],
    queryFn: () => pendingAdvanceForUser(item.user_id),
    enabled: !!item?.user_id && open,
  });

  const adjustMut = useMutation({
    mutationFn: async () => {
      const patch = {
        final_base: Number(formData.final_base),
        final_pt_commission: Number(formData.final_pt_commission),
        final_ot: Number(formData.final_ot),
        final_bonus: Number(formData.final_bonus),
        final_deductions: Number(formData.final_deductions),
        final_advance: Number(formData.final_advance),
        final_penalty: Number(formData.final_penalty),
      };
      const { error } = await supabase.rpc('payroll_adjust_item', {
        p_item_id: item.id,
        p_patch: patch as any,
        p_reason: adjustReason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Adjustment saved');
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ['payroll-items'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (!formData) return null;

  const handleChange = (key: string, value: string) => {
    setFormData((prev: any) => ({ ...prev, [key]: value }));
  };

  const fields = [
    { key: 'final_base', label: 'Base Salary' },
    { key: 'final_pt_commission', label: 'PT Commission' },
    { key: 'final_ot', label: 'Overtime' },
    { key: 'final_bonus', label: 'Bonus' },
    { key: 'final_deductions', label: 'Deductions' },
    { key: 'final_advance', label: 'Advance Recovery' },
    { key: 'final_penalty', label: 'Penalty' },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle>Adjust Payroll — {item?.profile?.full_name}</SheetTitle>
        </SheetHeader>

        <div className="space-y-6">
          {pendingAdvance > 0 && (
            <div className="flex flex-col gap-3 rounded-2xl bg-amber-50 p-4 border border-amber-100">
              <div className="flex items-center gap-2 text-sm text-amber-700 font-medium">
                <HandCoins className="h-4 w-4" />
                <span>Outstanding salary advance: ₹{pendingAdvance.toLocaleString('en-IN')}</span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full bg-white hover:bg-amber-100 border-amber-200 text-amber-700 rounded-xl"
                onClick={() => handleChange('final_advance', String(pendingAdvance))}
              >
                Recover full amount in this run
              </Button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {fields.map((f) => (
              <div key={f.key} className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">{f.label}</Label>
                <Input
                  type="number"
                  value={formData[f.key]}
                  onChange={(e) => handleChange(f.key, e.target.value)}
                  className="rounded-xl border-slate-200 focus:ring-indigo-500"
                />
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold text-slate-700">Adjustment Reason <span className="text-red-500">*</span></Label>
            <Textarea
              value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
              placeholder="Provide a reason for this adjustment..."
              className="rounded-xl border-slate-200 focus:ring-indigo-500 min-h-[100px]"
            />
          </div>
        </div>

        <SheetFooter className="mt-8 gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl flex-1">
            Cancel
          </Button>
          <Button 
            onClick={() => adjustMut.mutate()} 
            disabled={!adjustReason.trim() || adjustMut.isPending}
            className="rounded-xl flex-1 bg-indigo-600 hover:bg-indigo-700"
          >
            {adjustMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Adjustment
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
