/**
 * AttendanceDetailDrawer — per-day, per-shift-block attendance review and
 * correction surface for HR.
 *
 * Reads the authoritative block state from the `staff_day_blocks` RPC (roster
 * block, punch, marks, lateness, hours) and performs every write through the
 * server RPCs — `staff_mark_manual_attendance`, `staff_correct_attendance`,
 * `staff_delete_attendance` and `staff_mark_block`. Lateness, shift resolution
 * and hours are never computed in the browser, and payroll amounts are never
 * touched from here: attendance changes only flag the payroll run as stale.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Sunrise, Sunset, Moon, CalendarDays, Loader2, UserCheck, Trash2, PencilLine,
  CalendarX2, Plane, RotateCcw, AlertTriangle, Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { staffAttendanceService } from '@/services/staffAttendanceService';
import type { Database } from '@/integrations/supabase/types';

type DayBlock = Database['public']['Functions']['staff_day_blocks']['Returns'][number];

const BLOCK_META: Record<string, { label: string; icon: typeof Sunrise }> = {
  morning: { label: 'Morning shift', icon: Sunrise },
  evening: { label: 'Evening shift', icon: Sunset },
  night: { label: 'Night shift', icon: Moon },
  full_day: { label: 'Full day', icon: CalendarDays },
};

/** timestamptz -> value for <input type="datetime-local"> in IST. */
function toISTInput(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso)
    .toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' })
    .replace(' ', 'T')
    .slice(0, 16);
}

/** IST wall-clock input value -> UTC instant. */
function fromISTInput(v: string): string | null {
  if (!v) return null;
  return new Date(`${v}:00+05:30`).toISOString();
}

function fmtTime(t: string | null) {
  if (!t) return '—';
  const [h, m] = t.split(':');
  const d = new Date();
  d.setHours(Number(h), Number(m), 0, 0);
  return format(d, 'h:mm a');
}

export interface AttendanceDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string | null;
  staffName: string;
  /** yyyy-MM-dd (shift date, IST) */
  date: string | null;
  branchId?: string | null;
  canManage: boolean;
}

export function AttendanceDetailDrawer({
  open, onOpenChange, userId, staffName, date, branchId, canManage,
}: AttendanceDetailDrawerProps) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editIn, setEditIn] = useState('');
  const [editOut, setEditOut] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<DayBlock | null>(null);

  const { data: blocks = [], isLoading, isError } = useQuery({
    queryKey: ['staff-day-blocks', userId, date],
    enabled: open && !!userId && !!date,
    queryFn: () => staffAttendanceService.getDayBlocks(userId!, date!) as Promise<DayBlock[]>,
  });

  useEffect(() => {
    if (!open) { setReason(''); setEditing(null); setConfirmDelete(null); }
  }, [open]);

  const heading = useMemo(
    () => (date ? format(new Date(`${date}T00:00:00`), 'EEEE, d MMM yyyy') : ''),
    [date],
  );

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['staff-day-blocks'] });
    qc.invalidateQueries({ queryKey: ['staff-attendance'] });
    qc.invalidateQueries({ queryKey: ['staff-attendance-month'] });
    qc.invalidateQueries({ queryKey: ['staff-attendance-board'] });
    qc.invalidateQueries({ queryKey: ['payroll-items'] });
  }

  function requireReason(): string | null {
    const r = reason.trim();
    if (!r) {
      toast.error('Add a reason first — every attendance change is audited.');
      return null;
    }
    return r;
  }

  async function run(key: string, fn: () => Promise<unknown>, success: string) {
    setBusy(key);
    try {
      await fn();
      toast.success(success);
      setReason('');
      setEditing(null);
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  function markPresent(b: DayBlock) {
    const r = requireReason();
    if (!r || !userId || !date) return;
    void run(`present:${b.shift_type}`, () => staffAttendanceService.markManualAttendance({
      userId,
      shiftDate: date,
      shiftType: b.shift_type as 'morning' | 'evening' | 'night' | 'full_day',
      reason: r,
      branchId,
    }), 'Attendance recorded');
  }

  function saveCorrection(b: DayBlock) {
    const r = requireReason();
    if (!r || !b.attendance_id) return;
    void run(`correct:${b.shift_type}`, () => staffAttendanceService.correctPunch(
      b.attendance_id!,
      fromISTInput(editIn) ?? undefined,
      undefined,
      {
        checkOut: fromISTInput(editOut),
        clearCheckOut: !editOut,
        reason: r,
      },
    ), 'Attendance corrected');
  }

  function mark(b: DayBlock, state: 'absent' | 'leave' | 'clear') {
    const r = state === 'clear' ? 'cleared' : requireReason();
    if (!r || !userId || !date) return;
    void run(`${state}:${b.shift_type}`, () => staffAttendanceService.markBlock({
      userId,
      branchId: branchId || '',
      shiftDate: date,
      shiftType: b.shift_type,
      state,
      reason: state === 'clear' ? null : r,
    }), state === 'clear' ? 'Mark cleared' : `Marked ${state}`);
  }

  function doDelete() {
    const b = confirmDelete;
    const r = reason.trim();
    if (!b?.attendance_id || !r) return;
    setConfirmDelete(null);
    void run(`delete:${b.shift_type}`, () => staffAttendanceService.deletePunch(b.attendance_id!, r),
      'Attendance record removed');
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{staffName}</SheetTitle>
            <SheetDescription>{heading}</SheetDescription>
          </SheetHeader>

          <div className="space-y-4 py-4">
            {isLoading ? (
              <div className="space-y-3">
                {[0, 1].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
              </div>
            ) : isError ? (
              <div className="py-10 text-center text-muted-foreground">
                <AlertTriangle className="mx-auto mb-2 h-7 w-7 opacity-50" />
                Could not load this day.
              </div>
            ) : blocks.length === 0 ? (
              <div className="rounded-2xl bg-muted/40 p-6 text-center text-sm text-muted-foreground">
                <CalendarDays className="mx-auto mb-2 h-7 w-7 opacity-50" />
                No roster block on this day.
              </div>
            ) : (
              blocks.map((b) => {
                const meta = BLOCK_META[b.shift_type] ?? BLOCK_META.full_day;
                const Icon = meta.icon;
                const isEditing = editing === b.shift_type;
                return (
                  <div key={b.shift_type} className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="rounded-full bg-primary/10 p-2 text-primary"><Icon className="h-4 w-4" /></span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-foreground">{meta.label}</p>
                        <p className="text-xs text-muted-foreground">
                          Rostered {fmtTime(b.scheduled_start)} – {fmtTime(b.scheduled_end)}
                          {b.is_overnight ? ' (overnight)' : ''}
                        </p>
                      </div>
                      <StateBadge block={b} />
                    </div>

                    <div className="mb-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <span>In: <strong className="text-foreground">{b.check_in ? format(new Date(b.check_in), 'h:mm a') : '—'}</strong></span>
                      <span>Out: <strong className="text-foreground">{b.check_out ? format(new Date(b.check_out), 'h:mm a') : '—'}</strong></span>
                      <span>Hours: <strong className="text-foreground">{b.hours != null ? Number(b.hours).toFixed(2) : '—'}</strong></span>
                      <span>Source: <strong className="text-foreground">{b.source || (b.mark_state ? 'mark' : '—')}</strong></span>
                    </div>
                    {b.mark_reason && (
                      <p className="mb-3 text-xs text-muted-foreground">Reason: {b.mark_reason}</p>
                    )}

                    {canManage && isEditing && (
                      <div className="mb-3 space-y-2 rounded-xl bg-muted/40 p-3">
                        <div className="space-y-1">
                          <Label htmlFor={`in-${b.shift_type}`} className="text-xs">Check-in (IST)</Label>
                          <Input id={`in-${b.shift_type}`} type="datetime-local" value={editIn}
                            onChange={(e) => setEditIn(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`out-${b.shift_type}`} className="text-xs">Check-out (IST, optional)</Label>
                          <Input id={`out-${b.shift_type}`} type="datetime-local" value={editOut}
                            onChange={(e) => setEditOut(e.target.value)} />
                        </div>
                        <div className="flex gap-2 pt-1">
                          <Button size="sm" variant="outline" className="flex-1" onClick={() => setEditing(null)}>Cancel</Button>
                          <Button size="sm" className="flex-1" disabled={busy !== null}
                            onClick={() => saveCorrection(b)}>
                            {busy === `correct:${b.shift_type}` && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                            Save correction
                          </Button>
                        </div>
                      </div>
                    )}

                    {canManage && !isEditing && (
                      <div className="flex flex-wrap gap-2">
                        {!b.attendance_id && (
                          <Button size="sm" variant="outline" disabled={busy !== null}
                            onClick={() => markPresent(b)}>
                            {busy === `present:${b.shift_type}`
                              ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              : <UserCheck className="mr-1.5 h-3.5 w-3.5" />}
                            Mark present
                          </Button>
                        )}
                        {b.attendance_id && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => {
                              setEditing(b.shift_type);
                              setEditIn(toISTInput(b.check_in));
                              setEditOut(toISTInput(b.check_out));
                            }}>
                              <PencilLine className="mr-1.5 h-3.5 w-3.5" /> Correct
                            </Button>
                            <Button size="sm" variant="outline" className="text-destructive"
                              onClick={() => setConfirmDelete(b)}>
                              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove
                            </Button>
                          </>
                        )}
                        {!b.attendance_id && b.mark_state !== 'absent' && (
                          <Button size="sm" variant="outline" disabled={busy !== null}
                            onClick={() => mark(b, 'absent')}>
                            <CalendarX2 className="mr-1.5 h-3.5 w-3.5" /> Absent
                          </Button>
                        )}
                        {!b.attendance_id && b.mark_state !== 'leave' && (
                          <Button size="sm" variant="outline" disabled={busy !== null}
                            onClick={() => mark(b, 'leave')}>
                            <Plane className="mr-1.5 h-3.5 w-3.5" /> Leave
                          </Button>
                        )}
                        {b.mark_state && (
                          <Button size="sm" variant="ghost" disabled={busy !== null}
                            onClick={() => mark(b, 'clear')}>
                            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Clear mark
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {canManage && (
              <div className="space-y-1.5">
                <Label htmlFor="att-reason">Reason (required for every change)</Label>
                <Textarea
                  id="att-reason" rows={2} value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. turnstile offline, approved sick leave, punched at the wrong terminal"
                />
                <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" />
                  Shift, lateness and hours are recalculated on the server. Payroll amounts are never
                  changed here — an open payroll run is only flagged for recalculation.
                </p>
              </div>
            )}
          </div>

          <SheetFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this attendance record?</AlertDialogTitle>
            <AlertDialogDescription>
              {staffName}&rsquo;s {confirmDelete ? (BLOCK_META[confirmDelete.shift_type]?.label ?? 'shift') : 'shift'} record
              on {heading} will be deleted. The reason you entered is stored in the audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} disabled={!reason.trim()}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function StateBadge({ block }: { block: DayBlock }) {
  if (block.mark_state === 'leave') return <Badge className="rounded-full border-0 bg-info/15 text-info">On leave</Badge>;
  if (block.mark_state === 'absent') return <Badge className="rounded-full border-0 bg-destructive/15 text-destructive">Absent</Badge>;
  if (block.attendance_id && block.is_late) {
    return (
      <Badge className="rounded-full border-0 bg-warning/15 text-warning">
        Late{block.late_minutes != null ? ` ${block.late_minutes}m` : ''}
      </Badge>
    );
  }
  if (block.attendance_id) return <Badge className="rounded-full border-0 bg-success/15 text-success">Present</Badge>;
  if (!block.rostered) return <Badge className="rounded-full border-0 bg-muted text-muted-foreground">Not rostered</Badge>;
  return <Badge className="rounded-full border-0 bg-muted text-muted-foreground">No record</Badge>;
}
