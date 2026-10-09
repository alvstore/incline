import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { isMarked } from './ptAutoAttendanceShared';

type Row = { id: string; member_name: string | null; outcome: string };

export function PtCorrectionRequestDrawer({
  row, defaultAction, onOpenChange,
}: { row: Row | null; defaultAction: 'mark' | 'undo'; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [action, setAction] = useState<'mark' | 'undo'>(defaultAction);
  const [reason, setReason] = useState('');

  useEffect(() => { setAction(defaultAction); setReason(''); }, [row?.id, defaultAction]);

  const submit = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('pt_attendance_request_correction', {
        p_log_id: row!.id, p_action: action, p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Sent to your branch manager for approval');
      qc.invalidateQueries({ queryKey: ['pt-auto-attendance'] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const marked = row ? isMarked(row.outcome) : false;
  const valid = reason.trim().length >= 3 && ((action === 'undo') === marked);

  return (
    <Sheet open={!!row} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg flex flex-col">
        <SheetHeader>
          <SheetTitle>Request correction</SheetTitle>
          <SheetDescription>{row?.member_name ?? 'Member'}. Nothing changes until the branch manager approves.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto space-y-5 py-4">
          <RadioGroup value={action} onValueChange={(v) => setAction(v as 'mark' | 'undo')} className="space-y-2">
            <label htmlFor="corr-mark" className={`flex items-start gap-3 rounded-xl border border-border p-3 ${marked ? 'opacity-50' : 'cursor-pointer hover:bg-secondary'}`}>
              <RadioGroupItem id="corr-mark" value="mark" disabled={marked} className="mt-0.5" />
              <span><span className="text-sm font-medium block">We trained, please mark it</span>
                <span className="text-xs text-muted-foreground">For example, I forgot to scan back in.</span></span>
            </label>
            <label htmlFor="corr-undo" className={`flex items-start gap-3 rounded-xl border border-border p-3 ${!marked ? 'opacity-50' : 'cursor-pointer hover:bg-secondary'}`}>
              <RadioGroupItem id="corr-undo" value="undo" disabled={!marked} className="mt-0.5" />
              <span><span className="text-sm font-medium block">Didn't train, please undo</span>
                <span className="text-xs text-muted-foreground">For example, the client only used the gym on their own.</span></span>
            </label>
          </RadioGroup>
          <div className="space-y-1">
            <Label htmlFor="corr-reason">Reason (required)</Label>
            <Textarea id="corr-reason" maxLength={500} rows={4} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <SheetFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => submit.mutate()} disabled={!valid || submit.isPending}>
            {submit.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Send for approval
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
