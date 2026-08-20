import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, Clock, XCircle, Sun, ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { logPtSession, type PtSessionStatusInput } from '@/services/ptService';

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
  const [sessionDate, setSessionDate] = useState<string>(new Date().toISOString().split('T')[0]);

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
                onSelect={(e) => { e.preventDefault(); setNotes(''); setPending(opt.value); }}
              >
                <Icon className={`h-4 w-4 ${opt.cls}`} />
                {opt.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={!!pending} onOpenChange={(v) => !v && !isLoading && setPending(null)}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Mark {pending ? OPTIONS.find(o => o.value === pending)?.label : ''} — {memberName}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending === 'holiday'
                ? 'Logs a holiday entry. Does not consume a session or create a gym check-in.'
                : pending === 'absent'
                  ? 'Logs an absent session. Consumes one session on session-based packs. No gym check-in.'
                  : 'Logs the session and creates today\'s gym check-in if the member has not checked in.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Notes (optional)</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Focus: legs · 4 sets squat …"
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isLoading}
              onClick={(e) => { e.preventDefault(); if (pending) mark.mutate(pending); }}
            >
              {isLoading
                ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Logging…</>)
                : 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
