import { useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { CalendarClock, Gift, Loader2 } from 'lucide-react';
import { format, differenceInCalendarDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface MembershipLite {
  id: string;
  start_date: string;
  end_date: string;
  original_end_date?: string | null;
  membership_plans?: { name?: string | null; duration_days?: number | null } | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  membership: MembershipLite | null;
  onAdjusted?: () => void;
}

export function AdjustMembershipDatesDrawer({ open, onOpenChange, membership, onAdjusted }: Props) {
  const qc = useQueryClient();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open && membership) {
      setStartDate(membership.start_date?.slice(0, 10) ?? '');
      setEndDate(membership.end_date?.slice(0, 10) ?? '');
      setReason('');
    }
  }, [open, membership?.id]);

  const baseEnd = membership?.original_end_date || membership?.end_date || '';

  const { lengthDays, extraDays } = useMemo(() => {
    if (!startDate || !endDate) return { lengthDays: 0, extraDays: 0 };
    const len = differenceInCalendarDays(new Date(endDate), new Date(startDate)) + 1;
    const shift = membership ? differenceInCalendarDays(new Date(startDate), new Date(membership.start_date)) : 0;
    const shiftedBase = baseEnd ? differenceInCalendarDays(new Date(endDate), new Date(baseEnd)) - shift : 0;
    return { lengthDays: len, extraDays: shiftedBase };
  }, [startDate, endDate, baseEnd, membership?.start_date]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('No membership');
      const { data, error } = await supabase.rpc('adjust_membership_dates' as never, {
        p_membership_id: membership.id,
        p_start_date: startDate,
        p_end_date: endDate,
        p_reason: reason.trim(),
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Membership dates updated');
      qc.invalidateQueries({ queryKey: ['member-details'] });
      qc.invalidateQueries({ queryKey: ['membership-free-days'] });
      qc.invalidateQueries({ queryKey: ['members'] });
      onAdjusted?.();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message || 'Could not update dates'),
  });

  const canSubmit =
    !!membership &&
    !!startDate &&
    !!endDate &&
    new Date(endDate) >= new Date(startDate) &&
    reason.trim().length >= 6 &&
    !mutation.isPending;

  if (!membership) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-indigo-600" />
            Adjust Membership Dates
          </SheetTitle>
          <SheetDescription>
            Owner/Admin only. Corrects the plan period and reconciles the complimentary-days ledger.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <Card className="bg-slate-50">
            <CardContent className="pt-4 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">Plan</span>
                <span className="font-medium">{membership.membership_plans?.name || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Current period</span>
                <span className="font-medium">
                  {format(new Date(membership.start_date), 'dd MMM yyyy')} → {format(new Date(membership.end_date), 'dd MMM yyyy')}
                </span>
              </div>
              {baseEnd && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Plan end (before gifts)</span>
                  <span className="font-medium">{format(new Date(baseEnd), 'dd MMM yyyy')}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="adj-start">Start date</Label>
              <Input id="adj-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adj-end">End date</Label>
              <Input id="adj-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>

          <Card className="bg-indigo-50/50 border-indigo-100">
            <CardContent className="pt-4 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-600">Total length (inclusive)</span>
                <span className="font-mono">{lengthDays} days</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600 flex items-center gap-1">
                  <Gift className="h-3 w-3" /> Complimentary days
                </span>
                <span className="font-mono font-semibold">{extraDays > 0 ? `+${extraDays}` : extraDays}</span>
              </div>
              <p className="text-slate-500 pt-1">
                Any difference against the plan end date is logged as a gift entry with your reason.
              </p>
            </CardContent>
          </Card>

          <div className="space-y-2">
            <Label htmlFor="adj-reason">Reason <span className="text-red-500">*</span></Label>
            <Textarea
              id="adj-reason"
              rows={3}
              placeholder="e.g. Founder gift corrected from 20 to 10 complimentary days"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="text-xs text-slate-500">Minimum 6 characters. Written to the audit trail.</p>
          </div>

          <div className="sticky bottom-0 -mx-6 px-6 pt-4 pb-2 bg-white border-t flex gap-2">
            <Button variant="outline" className="flex-1 cursor-pointer" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button className="flex-1 cursor-pointer" disabled={!canSubmit} onClick={() => mutation.mutate()}>
              {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save dates
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
