import { useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { CalendarClock, Loader2 } from 'lucide-react';
import { addDays, format, parseISO } from 'date-fns';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface InvoiceLike {
  id: string;
  invoice_number?: string | null;
  due_date?: string | null;
  payment_due_date?: string | null;
  total_amount?: number | null;
  amount_paid?: number | null;
}

interface SetInvoiceDueDateDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: InvoiceLike | null;
}

const PRESETS = [
  { label: 'Today', days: 0 },
  { label: '+3 days', days: 3 },
  { label: '+7 days', days: 7 },
  { label: '+15 days', days: 15 },
  { label: '+30 days', days: 30 },
];

const toISODate = (d: Date) => format(d, 'yyyy-MM-dd');

export function SetInvoiceDueDateDrawer({ open, onOpenChange, invoice }: SetInvoiceDueDateDrawerProps) {
  const queryClient = useQueryClient();
  const [dueDate, setDueDate] = useState('');
  const [reason, setReason] = useState('');

  const currentDue = invoice?.payment_due_date || invoice?.due_date || null;

  useEffect(() => {
    if (!open) return;
    setDueDate(currentDue ? currentDue.slice(0, 10) : toISODate(addDays(new Date(), 7)));
    setReason('');
  }, [open, currentDue]);

  const balance = useMemo(
    () => Number(invoice?.total_amount || 0) - Number(invoice?.amount_paid || 0),
    [invoice],
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!invoice) throw new Error('No invoice selected');
      if (!dueDate) throw new Error('Pick a due date');
      const { error } = await supabase.rpc('set_invoice_due_date' as never, {
        p_invoice_id: invoice.id,
        p_due_date: dueDate,
        p_reason: reason.trim() || null,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Due date updated');
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['all-overdue-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-detail'] });
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Failed to update due date';
      toast.error(
        message.includes('NOT_ALLOWED')
          ? 'You do not have permission to change due dates'
          : message,
      );
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col p-0">
        <SheetHeader className="sticky top-0 z-10 border-b bg-background px-6 py-4">
          <SheetTitle className="flex items-center gap-2">
            <span className="rounded-full bg-indigo-50 p-2 text-indigo-600 dark:bg-indigo-950">
              <CalendarClock className="h-4 w-4" />
            </span>
            Set Payment Due Date
          </SheetTitle>
          <SheetDescription>
            {invoice?.invoice_number
              ? `Choose when the outstanding balance on ${invoice.invoice_number} is expected.`
              : 'Choose when the outstanding balance is expected.'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <div className="rounded-2xl bg-muted/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Outstanding balance
            </p>
            <p className="text-2xl font-bold">₹{balance.toLocaleString('en-IN')}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Current due date:{' '}
              {currentDue ? format(parseISO(currentDue.slice(0, 10)), 'dd MMM yyyy') : 'not set'}
            </p>
          </div>

          <div className="space-y-3">
            <Label htmlFor="due-date">
              New due date <span className="text-destructive">*</span>
            </Label>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((preset) => {
                const value = toISODate(addDays(new Date(), preset.days));
                const active = value === dueDate;
                return (
                  <Badge
                    key={preset.label}
                    role="button"
                    tabIndex={0}
                    onClick={() => setDueDate(value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setDueDate(value);
                      }
                    }}
                    className={`min-h-[44px] cursor-pointer items-center rounded-full px-4 text-sm font-medium transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                      active
                        ? 'bg-indigo-600 text-white hover:bg-indigo-600'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-muted dark:text-muted-foreground'
                    }`}
                  >
                    {preset.label}
                  </Badge>
                );
              })}
            </div>
            <Input
              id="due-date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="due-reason">Reason (recorded in audit trail)</Label>
            <Textarea
              id="due-reason"
              rows={3}
              placeholder="e.g. Member requested to pay the balance after salary credit"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>

        <div className="sticky bottom-0 flex justify-end gap-3 border-t bg-background px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="cursor-pointer">
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !dueDate}
            className="cursor-pointer"
          >
            {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save due date
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
