/**
 * StaffRosterBoard — dual-shift aware day board for staff attendance.
 *
 * Each person is shown with one chip per rostered shift block (morning /
 * evening / night / full day). A trainer who works mornings and evenings gets
 * two chips, so attending only one block reads as a half day instead of a
 * blanket "Present". Managers can check a block in or mark it absent / on leave.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Sunrise, Sunset, Moon, CalendarDays, LogIn, ShieldAlert, Loader2,
  CheckCircle2, XCircle, Clock, CalendarOff, Info,
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Database } from '@/integrations/supabase/types';

export type RosterBlock = Database['public']['Functions']['staff_roster_board']['Returns'][number];

type PersonRow = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  code: string;
  kind: string;
  blocks: RosterBlock[];
};

const BLOCK_META: Record<string, { label: string; icon: typeof Sunrise }> = {
  morning: { label: 'Morning', icon: Sunrise },
  evening: { label: 'Evening', icon: Sunset },
  night: { label: 'Night', icon: Moon },
  full_day: { label: 'Full day', icon: CalendarDays },
};

const STATE_STYLE: Record<string, string> = {
  attended: 'bg-emerald-100 text-emerald-700',
  missed: 'bg-red-100 text-red-700',
  absent: 'bg-red-100 text-red-700',
  leave: 'bg-blue-100 text-blue-700',
  pending: 'bg-slate-100 text-slate-600',
};

function initials(name?: string | null) {
  return (name || '?').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

function fmtHm(t: string | null) {
  if (!t) return null;
  const [h, m] = t.split(':');
  const d = new Date();
  d.setHours(Number(h), Number(m), 0, 0);
  return format(d, 'h:mm a');
}

export function StaffRosterBoard({
  branchId,
  canManage,
  currentUserId,
}: {
  branchId: string | undefined;
  canManage: boolean;
  currentUserId?: string;
}) {
  const queryClient = useQueryClient();
  const [dateISO, setDateISO] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [search, setSearch] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [marking, setMarking] = useState<{ block: RosterBlock; state: 'absent' | 'leave' } | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: rows = [], isLoading, isError } = useQuery({
    queryKey: ['staff-roster-board', branchId, dateISO],
    enabled: !!branchId,
    refetchInterval: 60_000,
    queryFn: async (): Promise<RosterBlock[]> => {
      const { data, error } = await supabase.rpc('staff_roster_board', {
        p_branch_id: branchId!,
        p_date: dateISO,
      });
      if (error) throw error;
      return (data || []) as RosterBlock[];
    },
  });

  const people = useMemo<PersonRow[]>(() => {
    const map = new Map<string, PersonRow>();
    for (const r of rows) {
      if (!r.user_id) continue;
      const existing = map.get(r.user_id) ?? {
        userId: r.user_id,
        name: r.full_name || 'Unknown',
        avatarUrl: r.avatar_url,
        code: r.staff_code || '',
        kind: r.staff_kind || 'staff',
        blocks: [],
      };
      if (r.shift_type) existing.blocks.push(r);
      map.set(r.user_id, existing);
    }
    const q = search.trim().toLowerCase();
    return Array.from(map.values())
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, search]);

  const stats = useMemo(() => {
    const blocks = rows.filter((r) => !!r.shift_type);
    return {
      rostered: blocks.filter((b) => b.rostered).length,
      attended: blocks.filter((b) => b.state === 'attended').length,
      missed: blocks.filter((b) => b.state === 'missed' || b.state === 'absent').length,
      pending: blocks.filter((b) => b.state === 'pending').length,
    };
  }, [rows]);

  async function checkInBlock(person: PersonRow, block: RosterBlock) {
    if (!branchId) return;
    if (person.userId === currentUserId) {
      toast.error('You cannot mark your own attendance');
      return;
    }
    const key = `${person.userId}-${block.shift_type}`;
    setBusyKey(key);
    try {
      await staffAttendanceService.punchBlock({
        userId: person.userId,
        branchId,
        shiftDate: dateISO,
        scheduledStart: block.scheduled_start,
      });
      toast.success(`${BLOCK_META[block.shift_type || '']?.label || 'Shift'} check-in recorded for ${person.name}`);
      queryClient.invalidateQueries({ queryKey: ['staff-roster-board'] });
      queryClient.invalidateQueries({ queryKey: ['staff-attendance-board'] });
      queryClient.invalidateQueries({ queryKey: ['staff-attendance'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record check-in');
    } finally {
      setBusyKey(null);
    }
  }

  async function submitMark() {
    if (!marking || !branchId) return;
    setSaving(true);
    try {
      await staffAttendanceService.markBlock({
        userId: marking.block.user_id!,
        branchId,
        shiftDate: dateISO,
        shiftType: marking.block.shift_type!,
        state: marking.state,
        reason: reason || null,
      });
      toast.success(marking.state === 'leave' ? 'Block marked as leave' : 'Block marked absent');
      setMarking(null);
      setReason('');
      queryClient.invalidateQueries({ queryKey: ['staff-roster-board'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the mark');
    } finally {
      setSaving(false);
    }
  }

  async function clearMark(block: RosterBlock) {
    if (!branchId) return;
    try {
      await staffAttendanceService.markBlock({
        userId: block.user_id!,
        branchId,
        shiftDate: dateISO,
        shiftType: block.shift_type!,
        state: 'clear',
      });
      queryClient.invalidateQueries({ queryKey: ['staff-roster-board'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not clear the mark');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex-1">
          {[
            { label: 'Blocks rostered', value: stats.rostered, tone: 'text-foreground' },
            { label: 'Attended', value: stats.attended, tone: 'text-success' },
            { label: 'Missed', value: stats.missed, tone: 'text-destructive' },
            { label: 'Upcoming', value: stats.pending, tone: 'text-muted-foreground' },
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
          <Label htmlFor="roster-search" className="sr-only">Search staff</Label>
          <Input
            id="roster-search"
            placeholder="Search staff…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-[180px]"
          />
          <Label htmlFor="roster-date" className="text-xs text-muted-foreground">Date</Label>
          <Input
            id="roster-date"
            type="date"
            value={dateISO}
            onChange={(e) => setDateISO(e.target.value)}
            className="h-9 w-[150px]"
          />
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 p-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" />
        <div className="flex-1 text-sm">
          <p className="font-medium text-foreground">One record per rostered shift block</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Dual-shift staff must be checked in for each block separately. Attending 1 of 2 blocks counts
            as a half day in payroll. Manual entry is a biometric-failure fallback and is audited.
          </p>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs">
              <Info className="h-3.5 w-3.5" /> How pay is derived
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 space-y-2 text-xs">
            <p className="text-sm font-semibold text-foreground">Payable fraction</p>
            <ul className="space-y-1 text-muted-foreground">
              <li>All rostered blocks attended → full day</li>
              <li>Some blocks attended → half day</li>
              <li>Blocks marked as leave are excluded and paid by leave policy</li>
              <li>Hours fall back to the rostered block length when a check-out is missing</li>
            </ul>
          </PopoverContent>
        </Popover>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
        </div>
      ) : isError ? (
        <div className="py-12 text-center text-muted-foreground">
          <XCircle className="mx-auto mb-3 h-8 w-8 opacity-50" />
          Could not load the roster for this day.
        </div>
      ) : people.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <CalendarOff className="mx-auto mb-3 h-8 w-8 opacity-50" />
          No staff found for this branch.
        </div>
      ) : (
        <div className="space-y-3">
          {people.map((p) => {
            const rosteredBlocks = p.blocks.filter((b) => b.rostered);
            const attended = p.blocks.filter((b) => b.state === 'attended').length;
            const fractionLabel = rosteredBlocks.length === 0
              ? (attended > 0 ? 'Unscheduled punch' : 'Off / no roster')
              : attended === 0 ? 'Not checked in'
              : attended >= rosteredBlocks.length ? 'Full day'
              : `Half day · ${attended}/${rosteredBlocks.length} blocks`;

            return (
              <Card key={p.userId} className="rounded-2xl border-0 shadow-lg shadow-muted/40 transition-all duration-200 hover:shadow-xl">
                <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={p.avatarUrl || undefined} />
                      <AvatarFallback className="bg-accent/10 text-xs font-semibold text-accent">{initials(p.name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-foreground">
                        {p.name}{p.userId === currentUserId && <span className="ml-1 text-xs font-normal text-muted-foreground">(You)</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {p.code} · <span className="capitalize">{p.kind}</span> · {fractionLabel}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {p.blocks.length === 0 && (
                      <Badge className="rounded-full border-0 bg-muted text-muted-foreground">No shift rostered</Badge>
                    )}
                    {p.blocks.map((b) => {
                      const meta = BLOCK_META[b.shift_type || 'full_day'] || BLOCK_META.full_day;
                      const Icon = meta.icon;
                      const key = `${p.userId}-${b.shift_type}`;
                      const busy = busyKey === key;
                      return (
                        <div
                          key={key}
                          className={cn(
                            'flex items-center gap-2 rounded-xl px-2.5 py-1.5',
                            STATE_STYLE[b.state || 'pending'] || STATE_STYLE.pending,
                          )}
                        >
                          <Icon className="h-4 w-4" aria-hidden />
                          <div className="text-xs leading-tight">
                            <p className="font-semibold">
                              {meta.label}{!b.rostered && ' (extra)'}
                            </p>
                            <p className="opacity-80">
                              {b.state === 'attended'
                                ? `In ${b.check_in ? format(new Date(b.check_in), 'h:mm a') : '--'}${b.is_late ? ` · late ${b.late_minutes ?? 0}m` : ''}`
                                : b.state === 'leave' ? 'On leave'
                                : b.state === 'absent' ? 'Marked absent'
                                : b.state === 'missed' ? 'Missed'
                                : `Starts ${fmtHm(b.scheduled_start) || '--'}`}
                            </p>
                          </div>
                          {canManage && b.state !== 'attended' && (
                            <div className="flex items-center gap-1">
                              <Button
                                size="icon" variant="ghost"
                                className="h-8 w-8 cursor-pointer hover:bg-background/60"
                                aria-label={`Check in ${p.name} for ${meta.label} shift`}
                                disabled={busy}
                                onClick={() => checkInBlock(p, b)}
                              >
                                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                              </Button>
                              {b.mark_state ? (
                                <Button
                                  size="icon" variant="ghost"
                                  className="h-8 w-8 cursor-pointer hover:bg-background/60"
                                  aria-label={`Clear mark for ${p.name} ${meta.label} shift`}
                                  onClick={() => clearMark(b)}
                                >
                                  <CheckCircle2 className="h-4 w-4" />
                                </Button>
                              ) : (
                                <Button
                                  size="icon" variant="ghost"
                                  className="h-8 w-8 cursor-pointer hover:bg-background/60"
                                  aria-label={`Mark ${p.name} absent or on leave for ${meta.label} shift`}
                                  onClick={() => { setMarking({ block: b, state: 'absent' }); setReason(''); }}
                                >
                                  <XCircle className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          )}
                          {b.state === 'attended' && (
                            <Clock className="h-3.5 w-3.5 opacity-70" aria-hidden />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Sheet open={!!marking} onOpenChange={(o) => { if (!o) { setMarking(null); setReason(''); } }}>
        <SheetContent className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Mark shift block</SheetTitle>
            <SheetDescription>
              Record why this {BLOCK_META[marking?.block.shift_type || 'full_day']?.label.toLowerCase()} block was not
              worked on {format(new Date(dateISO), 'd MMM yyyy')}. Leave blocks are excluded from the payable
              fraction; absent blocks reduce it.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Outcome</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={marking?.state === 'absent' ? 'default' : 'outline'}
                  className="flex-1 cursor-pointer"
                  onClick={() => marking && setMarking({ ...marking, state: 'absent' })}
                >
                  Absent
                </Button>
                <Button
                  type="button"
                  variant={marking?.state === 'leave' ? 'default' : 'outline'}
                  className="flex-1 cursor-pointer"
                  onClick={() => marking && setMarking({ ...marking, state: 'leave' })}
                >
                  On leave
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mark-reason">Reason</Label>
              <Textarea
                id="mark-reason" rows={3}
                placeholder="e.g. informed sick leave for the evening shift"
                value={reason} onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>
          <SheetFooter>
            <Button variant="outline" className="cursor-pointer" onClick={() => setMarking(null)}>Cancel</Button>
            <Button className="cursor-pointer" onClick={submitMark} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
