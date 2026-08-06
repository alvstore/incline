/**
 * StaffAttendanceBoard — shift-aware staff attendance day board.
 *
 * Check-in-only model: one record per roster shift block per day
 * (morning / evening / night / full day / unscheduled). Owners, admins and
 * managers can correct or remove a wrong punch from the side sheet.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Clock, Sunrise, Sunset, Moon, CalendarDays, AlertTriangle,
  PencilLine, Trash2, UserCheck, Loader2,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { staffAttendanceService } from '@/services/staffAttendanceService';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export type StaffPunch = {
  id: string;
  user_id: string;
  branch_id: string;
  check_in: string;
  shift_type: string | null;
  shift_date: string | null;
  scheduled_start: string | null;
  late_minutes: number | null;
  is_late: boolean;
  source: string | null;
  notes: string | null;
  name: string;
  avatar_url: string | null;
};

const BLOCKS = [
  { key: 'morning', label: 'Morning shift', icon: Sunrise },
  { key: 'evening', label: 'Evening shift', icon: Sunset },
  { key: 'night', label: 'Night shift', icon: Moon },
  { key: 'full_day', label: 'Full day / unscheduled', icon: CalendarDays },
] as const;

function initials(name?: string | null) {
  return (name || '?').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

function fmtSched(t: string | null) {
  if (!t) return null;
  const [h, m] = t.split(':');
  const d = new Date();
  d.setHours(Number(h), Number(m), 0, 0);
  return format(d, 'h:mm a');
}

export function StaffAttendanceBoard({
  branchId,
  canManage,
}: {
  branchId: string | undefined;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [dateISO, setDateISO] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [editing, setEditing] = useState<StaffPunch | null>(null);
  const [editTime, setEditTime] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<StaffPunch | null>(null);

  const { data: punches = [], isLoading, isError } = useQuery({
    queryKey: ['staff-attendance-board', branchId, dateISO],
    enabled: !!branchId,
    refetchInterval: 60_000,
    queryFn: async (): Promise<StaffPunch[]> => {
      const { data, error } = await supabase
        .from('staff_attendance')
        .select('id, user_id, branch_id, check_in, shift_type, shift_date, scheduled_start, late_minutes, is_late, source, notes')
        .eq('branch_id', branchId!)
        .eq('shift_date', dateISO)
        .order('check_in', { ascending: true });
      if (error) throw error;

      const rows = data || [];
      const ids = [...new Set(rows.map((r) => r.user_id))];
      let profileMap = new Map<string, { full_name: string | null; avatar_url: string | null }>();
      if (ids.length) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url')
          .in('id', ids);
        profileMap = new Map((profiles || []).map((p) => [p.id, p]));
      }

      return rows.map((r) => ({
        ...r,
        name: profileMap.get(r.user_id)?.full_name || 'Unknown',
        avatar_url: profileMap.get(r.user_id)?.avatar_url || null,
      })) as StaffPunch[];
    },
  });

  const grouped = useMemo(() => {
    const map: Record<string, StaffPunch[]> = { morning: [], evening: [], night: [], full_day: [] };
    for (const p of punches) {
      const key = p.shift_type && map[p.shift_type] ? p.shift_type : 'full_day';
      map[key].push(p);
    }
    return map;
  }, [punches]);

  const stats = useMemo(() => ({
    total: punches.length,
    late: punches.filter((p) => p.is_late).length,
    gate: punches.filter((p) => p.source === 'gate').length,
    manual: punches.filter((p) => p.source !== 'gate').length,
  }), [punches]);

  function openEdit(p: StaffPunch) {
    setEditing(p);
    setEditTime(format(new Date(p.check_in), "yyyy-MM-dd'T'HH:mm"));
    setEditNotes(p.notes || '');
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    try {
      await staffAttendanceService.correctPunch(
        editing.id,
        editTime ? new Date(editTime).toISOString() : undefined,
        editNotes || undefined,
      );
      toast.success('Punch corrected');
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ['staff-attendance-board'] });
      queryClient.invalidateQueries({ queryKey: ['staff-attendance'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not correct punch');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await staffAttendanceService.deletePunch(deleting.id);
      toast.success('Punch removed');
      queryClient.invalidateQueries({ queryKey: ['staff-attendance-board'] });
      queryClient.invalidateQueries({ queryKey: ['staff-attendance'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove punch');
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Now strip */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:flex-1">
          {[
            { label: 'Punches', value: stats.total, tone: 'text-foreground' },
            { label: 'Late', value: stats.late, tone: 'text-warning' },
            { label: 'From gate', value: stats.gate, tone: 'text-info' },
            { label: 'Manual', value: stats.manual, tone: 'text-muted-foreground' },
          ].map((s) => (
            <Card key={s.label} className="rounded-2xl border-0 shadow-sm">
              <CardContent className="p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{s.label}</p>
                <p className={cn('text-2xl font-bold', s.tone)}>{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="board-date" className="text-xs text-muted-foreground">Shift date</Label>
          <Input
            id="board-date"
            type="date"
            value={dateISO}
            onChange={(e) => setDateISO(e.target.value)}
            className="h-9 w-[150px]"
          />
        </div>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <UserCheck className="h-3.5 w-3.5" />
        Check-in only — one record per roster shift block. Repeat gate scans in the same block are ignored.
      </p>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      ) : isError ? (
        <div className="py-12 text-center text-muted-foreground">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 opacity-50" />
          Could not load attendance for this day.
        </div>
      ) : punches.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <Clock className="mx-auto mb-3 h-8 w-8 opacity-50" />
          No staff punches recorded on {format(new Date(dateISO), 'd MMM yyyy')}.
        </div>
      ) : (
        <div className="space-y-4">
          {BLOCKS.map(({ key, label, icon: Icon }) => {
            const rows = grouped[key] || [];
            if (!rows.length) return null;
            return (
              <Card key={key} className="rounded-2xl border-0 shadow-lg shadow-muted/40">
                <CardContent className="p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="rounded-full bg-primary/10 p-2 text-primary"><Icon className="h-4 w-4" /></span>
                    <h3 className="text-sm font-semibold text-foreground">{label}</h3>
                    <Badge variant="outline" className="rounded-full text-[11px]">{rows.length}</Badge>
                  </div>
                  <div className="divide-y">
                    {rows.map((p) => (
                      <div key={p.id} className="flex items-center gap-3 py-2.5">
                        <Avatar className="h-9 w-9">
                          <AvatarImage src={p.avatar_url || undefined} />
                          <AvatarFallback className="bg-accent/10 text-xs font-semibold text-accent">{initials(p.name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
                          <p className="text-xs text-muted-foreground">
                            In {format(new Date(p.check_in), 'h:mm a')}
                            {p.scheduled_start && ` · scheduled ${fmtSched(p.scheduled_start)}`}
                            {p.source && ` · ${p.source}`}
                          </p>
                        </div>
                        {p.is_late ? (
                          <Badge className="rounded-full border-0 bg-warning/15 text-warning">
                            Late{p.late_minutes != null ? ` ${p.late_minutes}m` : ''}
                          </Badge>
                        ) : p.scheduled_start ? (
                          <Badge className="rounded-full border-0 bg-success/15 text-success">On time</Badge>
                        ) : (
                          <Badge className="rounded-full border-0 bg-muted text-muted-foreground">Unscheduled</Badge>
                        )}
                        {canManage && (
                          <div className="flex items-center gap-1">
                            <Button
                              size="icon" variant="ghost" className="h-8 w-8"
                              aria-label={`Correct punch for ${p.name}`}
                              onClick={() => openEdit(p)}
                            >
                              <PencilLine className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon" variant="ghost" className="h-8 w-8 text-destructive"
                              aria-label={`Remove punch for ${p.name}`}
                              onClick={() => setDeleting(p)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Correction sheet */}
      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Correct attendance punch</SheetTitle>
            <SheetDescription>
              Adjust the check-in time for {editing?.name}. The shift block and lateness are recalculated
              from the roster, and the correction is recorded against your user.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="correct-time">Check-in time</Label>
              <Input
                id="correct-time" type="datetime-local"
                value={editTime} onChange={(e) => setEditTime(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="correct-notes">Reason / notes</Label>
              <Textarea
                id="correct-notes" rows={3}
                placeholder="e.g. turnstile offline, punch recorded manually"
                value={editNotes} onChange={(e) => setEditNotes(e.target.value)}
              />
            </div>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save correction
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this punch?</AlertDialogTitle>
            <AlertDialogDescription>
              The attendance record for {deleting?.name} on {deleting ? format(new Date(deleting.check_in), 'd MMM, h:mm a') : ''} will
              be deleted. This is audited.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
