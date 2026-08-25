import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, Clock, XCircle, Sun, ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { logPtSession, type PtSessionStatusInput } from '@/services/ptService';
import { getISTToday } from '@/lib/utils/datetime';

interface Props {
  memberPackageId: string;
  trainerId: string;
  memberName: string;
  size?: 'sm' | 'default';
  invalidateKeys?: string[][];
}

const OPTIONS: Array<{ value: PtSessionStatusInput; label: string; Icon: any; cls: string }> = [
  { value: 'present', label: 'Present', Icon: CheckCircle2, cls: 'text-success' },
  { value: 'late',    label: 'Late',    Icon: Clock,        cls: 'text-warning' },
  { value: 'absent',  label: 'Absent',  Icon: XCircle,      cls: 'text-destructive' },
  { value: 'holiday', label: 'Holiday', Icon: Sun,          cls: 'text-info' },
];

export function MarkPtStatusMenu({
  memberPackageId, trainerId, memberName, size = 'sm', invalidateKeys = [],
}: Props) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<PtSessionStatusInput | null>(null);
  const [notes, setNotes] = useState('');
  const [sessionDate, setSessionDate] = useState<string>(getISTToday());

  const CACHE_KEYS: readonly (readonly unknown[])[] = [
    ['my-pt-clients'],
    ['trainer-pt-clients'],
    ['member-pt-packages'],
    ['active-member-packages'],
    ['client-session-stats'],
    ['pt-attendance-roster'],
    ...invalidateKeys,
  ];

  const consumesSession = (s: PtSessionStatusInput) =>
    s === 'present' || s === 'late' || s === 'absent';
  const countsAsCompleted = (s: PtSessionStatusInput) =>
    s === 'present' || s === 'late';

  const patchPtClientRow = (obj: any, status: PtSessionStatusInput) => {
    if (!obj || obj.id !== memberPackageId) return obj;
    const isSessionBased =
      (obj.package_type ?? obj.package?.package_type) === 'session_based';
    if (!isSessionBased || !consumesSession(status)) return obj;
    const remaining = typeof obj.sessions_remaining === 'number'
      ? Math.max(0, obj.sessions_remaining - 1)
      : obj.sessions_remaining;
    return { ...obj, sessions_remaining: remaining };
  };

  const mark = useMutation({
    mutationFn: (status: PtSessionStatusInput) =>
      logPtSession({ 
        memberPackageId, 
        trainerId, 
        status, 
        notes: notes.trim() || undefined,
        sessionDate: sessionDate
      }),
    onMutate: async (status) => {
      // Snapshot + optimistically patch every cache that could hold this row
      const snapshots: Array<[readonly unknown[], unknown]> = [];
      for (const key of CACHE_KEYS) {
        await qc.cancelQueries({ queryKey: key as any });
        const entries = qc.getQueriesData({ queryKey: key as any });
        for (const [qk, data] of entries) {
          snapshots.push([qk, data]);
          if (Array.isArray(data)) {
            qc.setQueryData(qk, (data as any[]).map((r) => patchPtClientRow(r, status)));
          }
        }
      }
      return { snapshots };
    },
    onSuccess: (res: any) => {
      const s = res?.status as string;
      const left = res?.sessions_remaining;
      const msg =
        s === 'completed' || s === 'late'
          ? `Marked ${s === 'late' ? 'late' : 'present'}${typeof left === 'number' ? ` · ${left} sessions left` : ''}`
          : s === 'absent'
            ? `Marked absent${typeof left === 'number' ? ` · ${left} sessions left` : ''}`
            : 'Marked holiday · pack not consumed';
      toast.success(msg, {
        description: res?.gym_check_in_created ? 'Personal Training attendance recorded + Gym check-in created' : 'Personal Training attendance recorded',
      });
      setPending(null);
      setNotes('');
    },
    onError: (e: any, _vars, ctx) => {
      // Roll back optimistic patches
      ctx?.snapshots?.forEach(([qk, data]) => qc.setQueryData(qk as any, data));
      const code = e?.message || '';
      toast.error(
        code.includes('no_sessions_left') || code.includes('Sessions exhausted') ? 'No PT sessions remaining on this pack' :
        code.includes('package_expired') || code.includes('Package expired') ? 'This monthly plan has expired' :
        code.includes('package_not_active') ? 'Package is not active' :
        code.includes('not_authorized') ? 'You are not allowed to mark this session' :
        code.includes('insufficient_gym_attendance') ? 'Cheating blocked: Member or Trainer were not checked in to the gym on this date.' :
        code.includes('session_date_too_old') ? 'Session is too old to record manually (max 7 days).' :
        code || 'Could not log session'
      );
    },
    onSettled: () => {
      CACHE_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: k as any }));
    },
  });

  const isLoading = mark.isPending;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size={size} disabled={isLoading} className="gap-1">
            <CheckCircle2 className="h-4 w-4" />
            Mark
            <ChevronDown className="h-3 w-3 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuLabel className="text-xs">Session status</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {OPTIONS.map((opt) => {
            const Icon = opt.Icon;
            return (
              <DropdownMenuItem
                key={opt.value}
                className="cursor-pointer gap-2"
                onSelect={(e) => { 
                  e.preventDefault(); 
                  setNotes(''); 
                   setSessionDate(getISTToday());
                  setPending(opt.value); 
                }}
              >
                <Icon className={`h-4 w-4 ${opt.cls}`} />
                {opt.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <Sheet open={!!pending} onOpenChange={(v) => !v && !isLoading && setPending(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              Mark {pending ? OPTIONS.find(o => o.value === pending)?.label : ''} — {memberName}
            </SheetTitle>
            <SheetDescription>
              {pending === 'holiday'
                ? 'Logs a holiday entry. Does not consume a session.'
                : pending === 'absent'
                  ? 'Logs an absent session. Consumes one session. No attendance check required for absence.'
                  : 'Logs completion. Verification: Member and Trainer MUST have checked in to the gym on the selected date.'}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 py-6">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Session Date</label>
              <input 
                type="date"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={sessionDate}
                 max={getISTToday()}
                min={new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
                onChange={(e) => setSessionDate(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">
                Both Member and Trainer must have checked in to the gym on this date.
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Notes (optional)</label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Focus: legs · 4 sets squat …"
                rows={4}
              />
            </div>
          </div>
          <SheetFooter className="mt-auto pt-4">
            <Button variant="outline" className="flex-1" onClick={() => setPending(null)} disabled={isLoading}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={isLoading}
              onClick={(e) => { e.preventDefault(); if (pending) mark.mutate(pending); }}
            >
              {isLoading
                ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Logging…</>)
                : 'Confirm'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
