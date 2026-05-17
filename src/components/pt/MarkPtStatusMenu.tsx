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
  { value: 'present', label: 'Present', Icon: CheckCircle2, cls: 'text-emerald-600' },
  { value: 'late',    label: 'Late',    Icon: Clock,        cls: 'text-amber-600' },
  { value: 'absent',  label: 'Absent',  Icon: XCircle,      cls: 'text-red-600' },
  { value: 'holiday', label: 'Holiday', Icon: Sun,          cls: 'text-blue-600' },
];

export function MarkPtStatusMenu({
  memberPackageId, trainerId, memberName, size = 'sm', invalidateKeys = [],
}: Props) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<PtSessionStatusInput | null>(null);
  const [notes, setNotes] = useState('');

  const mark = useMutation({
    mutationFn: (status: PtSessionStatusInput) =>
      logPtSession({ memberPackageId, trainerId, status, notes: notes.trim() || undefined }),
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
        description: res?.gym_check_in_created ? 'Gym check-in created' : undefined,
      });
      setPending(null);
      setNotes('');
      [['trainer-pt-clients'], ['client-session-stats'], ['member-pt-packages'], ['pt-attendance-roster'], ...invalidateKeys]
        .forEach((k) => qc.invalidateQueries({ queryKey: k }));
    },
    onError: (e: any) => {
      const code = e?.message || '';
      toast.error(
        code.includes('no_sessions_left') ? 'No PT sessions remaining on this pack' :
        code.includes('package_expired') ? 'This monthly plan has expired' :
        code.includes('package_not_active') ? 'Package is not active' :
        code.includes('not_authorized') ? 'You are not allowed to mark this session' :
        code || 'Could not log session'
      );
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
            <label className="text-xs font-medium text-slate-600">Notes (optional)</label>
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
