import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ptCloseoutFormSchema, type PtCloseoutForm } from '@/lib/invoices/ptCloseout';
import { previewPtCloseout, savePtCloseout } from '@/services/ptCloseoutService';

export interface PtInvoiceCloseoutDrawerProps {
  invoiceId: string; open: boolean; onOpenChange: (open: boolean) => void;
}
const money = (amount: number) => `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export function PtInvoiceCloseoutDrawer({ invoiceId, open, onOpenChange }: PtInvoiceCloseoutDrawerProps) {
  const queryClient = useQueryClient();
  const form = useForm<PtCloseoutForm>({ resolver: zodResolver(ptCloseoutFormSchema), defaultValues: { reason: '', externalCommission: 0 } });
  const external = Number(form.watch('externalCommission'));
  const preview = useQuery({
    queryKey: ['pt-closeout-preview', invoiceId, external],
    enabled: open && Number.isFinite(external) && external >= 0,
    queryFn: () => previewPtCloseout(invoiceId, external),
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: (values: PtCloseoutForm) => {
      const result = preview.data;
      if (!result || result.original_total === undefined || preview.isFetching) throw new Error('Refresh the preview before saving.');
      return savePtCloseout({ invoiceId, reason: values.reason, externalCommission: values.externalCommission, total: result.original_total, paid: result.retained_amount });
    },
    onSuccess: async () => {
      await Promise.all(['invoices', 'invoice-stats', 'invoice-details', 'invoice-payments', 'member-all-invoices', 'member-pending-invoices', 'member-invoices', 'member-details', 'member-pt-packages', 'active-member-packages', 'pt-closeout-history', 'trainer-earnings-summary', 'pt-commission-ledger', 'pt_settlements'].map(key => queryClient.invalidateQueries({ queryKey: [key] })));
      toast.success('PT closed — received cash preserved and remaining dues waived.');
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const result = preview.data;
  return (
    <Sheet open={open} onOpenChange={next => { if (!mutation.isPending) onOpenChange(next); }}>
      <SheetContent className="flex w-full flex-col sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Close PT &amp; waive balance</SheetTitle>
          <SheetDescription>{result?.already ? 'This PT invoice has already been closed.' : 'Cash receipts stay unchanged. PT access ends; the remaining invoice balance is waived, not refunded.'}</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={form.handleSubmit(values => mutation.mutate(values))}>
            <div className="flex-1 space-y-5 overflow-y-auto py-5">
              <FormField control={form.control} name="externalCommission" render={({ field }) => (
                <FormItem>
                  <FormLabel>Commission already paid outside linked payroll (₹)</FormLabel>
                  <FormControl><Input {...field} type="number" min="0" step="0.01" className="min-h-11" disabled={mutation.isPending || result?.already} /></FormControl>
                  <FormDescription>Only enter a confirmed historical payout. Linked payroll is counted separately; do not enter it again.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              {preview.isFetching && <Skeleton className="h-48 w-full" />}
              {preview.isError && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>{preview.error.message}<Button type="button" variant="outline" className="mt-3 min-h-11 cursor-pointer" onClick={() => preview.refetch()}>Refresh preview</Button></AlertDescription></Alert>}
              {result && !preview.isFetching && <dl className="space-y-3 rounded-xl bg-muted/40 p-4 text-sm" aria-live="polite">
                {[
                  ['Cash retained', result.retained_amount], ['Balance waived', result.waived_amount],
                  ['Revised trainer entitlement', result.commission_entitlement],
                  ['Linked payroll preserved', result.payroll_linked_commission ?? 0],
                  ['Confirmed external payout', result.confirmed_external_commission ?? external],
                  ['Still payable to trainer', result.remaining_commission],
                ].map(([label, amount]) => <div key={String(label)} className="flex items-start justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="shrink-0 font-semibold tabular-nums">{money(Number(amount))}</dd></div>)}
              </dl>}
              <Alert><AlertTriangle className="h-4 w-4" /><AlertDescription>Existing sessions and payslips remain in history. Unpaid commission is recalculated; no new member payment or refund is recorded.</AlertDescription></Alert>
              <FormField control={form.control} name="reason" render={({ field }) => (
                <FormItem><FormLabel>Reason <span className="text-destructive">*</span></FormLabel><FormControl><Textarea {...field} rows={4} aria-required="true" disabled={mutation.isPending || result?.already} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <SheetFooter className="border-t pt-4">
              <Button type="button" variant="outline" className="min-h-11 cursor-pointer" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>Keep invoice</Button>
              <Button type="submit" className="min-h-11 cursor-pointer" disabled={!result || result.already || preview.isFetching || preview.isError || mutation.isPending}>
                {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Close PT &amp; waive balance
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}