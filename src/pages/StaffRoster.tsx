import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { useBranchContext } from '@/contexts/BranchContext';
import {
  useStaffSchedules, useUpsertShift, useBulkUpsertShifts, useDeleteShift,
  useStaffAttendanceMonth,
  useShiftOverridesForDate, useUpsertShiftOverride, useDeleteShiftOverride,
  type ShiftRow, type TrainerRosterRow, type StaffRoleLabel, type ShiftOverrideRow,
} from '@/hooks/useStaffSchedules';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Pencil, Trash2, Sun, Moon, Calendar as CalIcon, AlertCircle,
  Download, Send, Printer, Clock, ChevronDown, CheckCircle2, XCircle,
  Users, AlertTriangle,
} from 'lucide-react';
import { buildStaffRosterPdf } from '@/utils/pdfBlob';
import { downloadBlob, printBlob } from '@/utils/pdfBlob';
import { uploadAttachment } from '@/utils/uploadAttachment';
import { dispatchCommunication, buildDedupeKey } from '@/lib/comms/dispatch';
import { useToast } from '@/hooks/use-toast';
import { format, startOfMonth, addMonths, addWeeks, startOfWeek, addDays, startOfDay, isSameDay } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronLeft, ChevronRight, Repeat, CalendarDays, X as XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { canEditAnyRoster, canEditRosterRow, canExportRoster } from '@/lib/auth/permissions';

// Returns the next upcoming Sunday (today if today is Sunday)
function nextSunday(from: Date = new Date()): Date {
  const d = startOfDay(from);
  const diff = (7 - d.getDay()) % 7; // 0 if Sunday
  return addDays(d, diff);
}
function prevSunday(from: Date): Date {
  return addDays(startOfDay(from), -7);
}
function nextSundayFrom(from: Date): Date {
  return addDays(startOfDay(from), 7);
}
function toISODate(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

const WEEKDAYS = [
  { idx: 1, short: 'Mon', full: 'Monday' },
  { idx: 2, short: 'Tue', full: 'Tuesday' },
  { idx: 3, short: 'Wed', full: 'Wednesday' },
  { idx: 4, short: 'Thu', full: 'Thursday' },
  { idx: 5, short: 'Fri', full: 'Friday' },
  { idx: 6, short: 'Sat', full: 'Saturday' },
  { idx: 0, short: 'Sun', full: 'Sunday' },
];

// 12-hour AM/PM display ("17:30" -> "5:30 PM")
function fmtTime12(t: string | null | undefined): string | null {
  if (!t) return null;
  const [hStr, mStr] = t.slice(0, 5).split(':');
  let h = Number(hStr);
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${mStr} ${period}`;
}

const ROLE_TONES: Record<StaffRoleLabel, string> = {
  Trainer: 'bg-indigo-100 text-indigo-700',
  Manager: 'bg-violet-100 text-violet-700',
  'Front Desk': 'bg-amber-100 text-amber-700',
  Cleaning: 'bg-emerald-100 text-emerald-700',
  Staff: 'bg-slate-100 text-slate-700',
};

type View = 'day' | 'week' | 'month' | 'attendance';
type RoleFilter = 'all' | StaffRoleLabel;

function ShiftPill({ start, end, tone }: { start: string | null; end: string | null; tone: 'morning' | 'evening' }) {
  if (!start || !end) return <span className="text-xs text-muted-foreground">—</span>;
  const overnight = end < start;
  const baseCls = overnight
    ? 'bg-blue-100 text-blue-700'
    : tone === 'morning'
      ? 'bg-emerald-100 text-emerald-700'
      : 'bg-indigo-100 text-indigo-700';
  const Icon = overnight ? Moon : tone === 'morning' ? Sun : Moon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${baseCls}`}>
      <Icon className="h-3 w-3" />
      {fmtTime12(start)} → {fmtTime12(end)}
      {overnight && <span className="ml-0.5 text-[10px] opacity-70">overnight</span>}
    </span>
  );
}

interface EditState { trainer: TrainerRosterRow; weekday: number; }

export default function StaffRoster() {
  const { effectiveBranchId, currentBranchName } = useBranchContext();
  const branchId = effectiveBranchId;
  const { toast } = useToast();
  const { user, roles } = useAuth();
  const roleNames = useMemo(() => roles.map((r) => r.role), [roles]);
  const editAny = canEditAnyRoster(roleNames);
  const exportOk = canExportRoster(roleNames);
  const canEditFor = (uid: string) => canEditRosterRow(roleNames, uid, user?.id);
  const [searchParams, setSearchParams] = useSearchParams();

  const initialView = (searchParams.get('view') as View) || 'day';
  const [view, setView] = useState<View>(['day', 'week', 'month', 'attendance'].includes(initialView) ? initialView : 'day');
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set('view', view);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const { data, isLoading, isError, error } = useStaffSchedules(branchId);
  const upsert = useUpsertShift(branchId);
  const bulkUpsert = useBulkUpsertShifts(branchId);
  const del = useDeleteShift(branchId);
  const upsertOverride = useUpsertShiftOverride(branchId);
  const deleteOverride = useDeleteShiftOverride(branchId);

  const today = new Date();
  const [weekday, setWeekday] = useState<number>(today.getDay());
  const [weekAnchor, setWeekAnchor] = useState<Date>(startOfWeek(today, { weekStartsOn: 1 }));
  const [monthAnchor, setMonthAnchor] = useState<Date>(startOfMonth(today));
  const [attendanceMonth, setAttendanceMonth] = useState<string>(format(today, 'yyyy-MM'));
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [deptFilter, setDeptFilter] = useState<string | null>(null);

  const [edit, setEdit] = useState<EditState | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [busyPdf, setBusyPdf] = useState(false);
  const [sundayOpen, setSundayOpen] = useState(false);
  const [sundayDate, setSundayDate] = useState<Date>(nextSunday());

  const sundayDateISO = toISODate(sundayDate);
  const { data: sundayOverrides = [] } = useShiftOverridesForDate(branchId, sundayDateISO);

  const allStaff = useMemo(() => data ?? [], [data]);
  const trainers = useMemo(() => {
    let list = roleFilter === 'all' ? allStaff : allStaff.filter((s) => s.role === roleFilter);
    if (deptFilter) list = list.filter((s) => (s.department || '—') === deptFilter);
    return list;
  }, [allStaff, roleFilter, deptFilter]);

  // Dynamic role chips — only roles that actually exist in this branch, with counts.
  const roleChips = useMemo(() => {
    const c = new Map<StaffRoleLabel, number>();
    allStaff.forEach((s) => c.set(s.role, (c.get(s.role) || 0) + 1));
    return Array.from(c.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([role, count]) => ({ role, count }));
  }, [allStaff]);

  // Dynamic department chips — scoped to current role filter so they stay relevant.
  const deptChips = useMemo(() => {
    const scope = roleFilter === 'all' ? allStaff : allStaff.filter((s) => s.role === roleFilter);
    const c = new Map<string, number>();
    scope.forEach((s) => {
      const d = s.department || '—';
      c.set(d, (c.get(d) || 0) + 1);
    });
    return Array.from(c.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([dept, count]) => ({ dept, count }));
  }, [allStaff, roleFilter]);

  // Sunday duty roster for the selected Sunday — merges recurring shifts (weekday=0)
  // with per-date overrides. Overrides win, including is_weekly_off=true to revoke.
  type SundayEntry = {
    staff: TrainerRosterRow;
    source: 'override' | 'recurring';
    morning_start: string | null;
    morning_end: string | null;
    evening_start: string | null;
    evening_end: string | null;
  };
  const sundayDuty = useMemo<SundayEntry[]>(() => {
    const overrideMap = new Map<string, ShiftOverrideRow>();
    sundayOverrides.forEach((o) => overrideMap.set(o.user_id, o));
    const out: SundayEntry[] = [];
    allStaff.forEach((s) => {
      const ov = overrideMap.get(s.user_id);
      if (ov) {
        if (ov.is_weekly_off) return; // explicitly off this Sunday
        if (!ov.morning_start && !ov.evening_start) return;
        out.push({
          staff: s, source: 'override',
          morning_start: ov.morning_start, morning_end: ov.morning_end,
          evening_start: ov.evening_start, evening_end: ov.evening_end,
        });
        return;
      }
      const sh = s.shifts[0];
      if (sh && !sh.is_weekly_off && (sh.morning_start || sh.evening_start)) {
        out.push({
          staff: s, source: 'recurring',
          morning_start: sh.morning_start, morning_end: sh.morning_end,
          evening_start: sh.evening_start, evening_end: sh.evening_end,
        });
      }
    });
    return out;
  }, [allStaff, sundayOverrides]);

  const periodLabel = useMemo(() => {
    if (view === 'day') {
      const dayName = WEEKDAYS.find((d) => d.idx === weekday)?.full || '';
      return `${dayName} · ${format(today, 'dd MMM yyyy')}`;
    }
    if (view === 'week') {
      const end = new Date(weekAnchor); end.setDate(end.getDate() + 6);
      return `Week of ${format(weekAnchor, 'dd MMM')} – ${format(end, 'dd MMM yyyy')}`;
    }
    if (view === 'month') return format(monthAnchor, 'MMMM yyyy');
    return `Attendance · ${format(new Date(attendanceMonth + '-01'), 'MMMM yyyy')}`;
  }, [view, weekday, weekAnchor, monthAnchor, attendanceMonth, today]);

  const handleExportPdf = async (
    mode: 'download' | 'print',
    explicitScope?: 'day' | 'week' | 'month',
  ) => {
    if (trainers.length === 0) {
      toast({ title: 'Nothing to export', description: 'No staff in this branch yet.', variant: 'destructive' });
      return;
    }
    try {
      setBusyPdf(true);
      // Default to WEEK regardless of which tab is open.
      const scope: 'day' | 'week' | 'month' = explicitScope ?? (view === 'attendance' ? 'month' : view === 'day' ? 'week' : view);
      const labelForScope =
        scope === 'day' ? `${WEEKDAYS.find((d) => d.idx === weekday)?.full} · ${format(today, 'dd MMM yyyy')}`
        : scope === 'week' ? `Week of ${format(weekAnchor, 'dd MMM')} – ${format(new Date(weekAnchor.getTime() + 6 * 86400000), 'dd MMM yyyy')}`
        : `${format(monthAnchor, 'MMMM yyyy')}`;
      const blob = await buildStaffRosterPdf({
        scope,
        periodLabel: labelForScope,
        weekday: scope === 'day' ? weekday : undefined,
        monthAnchor: scope === 'month' ? monthAnchor : undefined,
        trainers: trainers.map((t) => ({
          user_id: t.user_id, full_name: t.full_name, shifts: t.shifts, role: t.role,
        })),
        branchId, branchName: currentBranchName,
      });
      if (mode === 'print') {
        printBlob(blob);
      } else {
        const safeBranch = (currentBranchName || 'incline').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        downloadBlob(blob, `roster-${safeBranch}-${scope}-${format(new Date(), 'yyyyMMdd')}.pdf`);
      }
    } catch (e: any) {
      toast({ title: 'PDF generation failed', description: e?.message, variant: 'destructive' });
    } finally {
      setBusyPdf(false);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Hero strip */}
        <div className="rounded-2xl bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-600 p-6 text-white shadow-lg shadow-indigo-500/20">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-white/70">
                <CalIcon className="h-3.5 w-3.5" />
                Duty &amp; Attendance · {currentBranchName || 'No branch selected'}
              </div>
              <h1 className="mt-1 text-3xl font-bold tracking-tight">Staff Roster</h1>
              <p className="mt-1 text-sm text-white/80">{periodLabel}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge className="rounded-full bg-white/15 text-white hover:bg-white/20">
                  {allStaff.length} staff
                </Badge>
                <Badge className="rounded-full bg-white/15 text-white hover:bg-white/20">
                  {allStaff.filter((t) => Object.values(t.shifts).some((s) => s?.is_weekly_off)).length} with weekly-off
                </Badge>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {exportOk && (
                <>
                  <div className="inline-flex rounded-md overflow-hidden">
                    <Button
                      variant="secondary" className="bg-white text-indigo-700 hover:bg-white/90 rounded-r-none"
                      onClick={() => handleExportPdf('download')} disabled={busyPdf}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      {busyPdf ? 'Building…' : 'Export weekly PDF'}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="secondary"
                          className="bg-white text-indigo-700 hover:bg-white/90 rounded-l-none border-l border-indigo-100 px-2"
                          disabled={busyPdf} aria-label="More export options"
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleExportPdf('download', 'week')}>
                          <CalIcon className="mr-2 h-4 w-4" /> This week (default)
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleExportPdf('download', 'day')}>
                          <Sun className="mr-2 h-4 w-4" /> Today only
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleExportPdf('download', 'month')}>
                          <CalIcon className="mr-2 h-4 w-4" /> Full month
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <Button
                    variant="ghost" className="text-white hover:bg-white/15"
                    onClick={() => handleExportPdf('print')} disabled={busyPdf}
                  >
                    <Printer className="mr-2 h-4 w-4" /> Print
                  </Button>
                  <Button
                    variant="ghost" className="text-white hover:bg-white/15"
                    onClick={() => setSendOpen(true)}
                  >
                    <Send className="mr-2 h-4 w-4" /> Send
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Dynamic role + department filter chips */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              <Users className="h-3.5 w-3.5" /> Role
            </span>
            <button
              onClick={() => { setRoleFilter('all'); setDeptFilter(null); }}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                roleFilter === 'all'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              All <span className="opacity-70">· {allStaff.length}</span>
            </button>
            {roleChips.map(({ role, count }) => {
              const active = roleFilter === role;
              return (
                <button
                  key={role}
                  onClick={() => { setRoleFilter(role); setDeptFilter(null); }}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : `${ROLE_TONES[role]} hover:opacity-80`
                  }`}
                >
                  {role} <span className="opacity-70">· {count}</span>
                </button>
              );
            })}
          </div>
          {deptChips.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Department
              </span>
              <button
                onClick={() => setDeptFilter(null)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                  deptFilter === null
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                Any
              </button>
              {deptChips.map(({ dept, count }) => {
                const active = deptFilter === dept;
                return (
                  <button
                    key={dept}
                    onClick={() => setDeptFilter(active ? null : dept)}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                      active
                        ? 'bg-slate-900 text-white'
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {dept} <span className="opacity-70">· {count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Sunday Duty card */}
        <SundayDutyCard
          sundayDate={sundayDate}
          onChangeSundayDate={setSundayDate}
          entries={sundayDuty}
          allStaffCount={allStaff.length}
          canEditFor={canEditFor}
          canAssign={editAny}
          onEdit={(t) => setEdit({ trainer: t, weekday: 0 })}
          onAssign={() => setSundayOpen(true)}
        />

        {/* View switcher */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs value={view} onValueChange={(v) => setView(v as View)}>
            <TabsList>
              <TabsTrigger value="day">Day</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="month">Month</TabsTrigger>
              <TabsTrigger value="attendance">Attendance log</TabsTrigger>
            </TabsList>
          </Tabs>
          {view === 'day' && (
            <Tabs value={String(weekday)} onValueChange={(v) => setWeekday(Number(v))}>
              <TabsList>
                {WEEKDAYS.map((d) => (
                  <TabsTrigger key={d.idx} value={String(d.idx)}>{d.short}</TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
          {view === 'week' && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setWeekAnchor(addWeeks(weekAnchor, -1))}>‹ Prev</Button>
              <span className="text-sm font-medium text-slate-700">{format(weekAnchor, 'dd MMM yyyy')}</span>
              <Button size="sm" variant="outline" onClick={() => setWeekAnchor(addWeeks(weekAnchor, 1))}>Next ›</Button>
            </div>
          )}
          {view === 'month' && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setMonthAnchor(addMonths(monthAnchor, -1))}>‹ Prev</Button>
              <span className="text-sm font-medium text-slate-700">{format(monthAnchor, 'MMMM yyyy')}</span>
              <Button size="sm" variant="outline" onClick={() => setMonthAnchor(addMonths(monthAnchor, 1))}>Next ›</Button>
            </div>
          )}
          {view === 'attendance' && (
            <Input
              type="month" value={attendanceMonth}
              onChange={(e) => setAttendanceMonth(e.target.value)}
              className="w-[180px]"
            />
          )}
        </div>

        {/* Main content card */}
        <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <CalIcon className="h-5 w-5 text-indigo-600" />
              {view === 'day' && `${WEEKDAYS.find((d) => d.idx === weekday)?.full} schedule`}
              {view === 'week' && 'Weekly grid'}
              {view === 'month' && 'Monthly heatmap'}
              {view === 'attendance' && 'Attendance log'}
            </CardTitle>
            <Badge variant="outline" className="rounded-full">
              {trainers.length} {trainers.length === 1 ? 'person' : 'people'}
            </Badge>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading && (
              <div className="p-6 space-y-3">
                {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
              </div>
            )}
            {isError && (
              <div className="p-8 flex flex-col items-center text-center gap-2">
                <AlertCircle className="h-10 w-10 text-red-500" />
                <p className="text-sm text-slate-600">Failed to load roster: {(error as any)?.message}</p>
              </div>
            )}
            {!isLoading && !isError && trainers.length === 0 && view !== 'attendance' && (
              <div className="p-12 flex flex-col items-center text-center gap-2">
                <CalIcon className="h-10 w-10 text-slate-300" />
                <p className="text-sm font-medium text-slate-700">No staff match this filter</p>
                <p className="text-xs text-slate-500">Add staff from the Trainers or HRM pages, or change the role filter.</p>
              </div>
            )}

            {!isLoading && !isError && trainers.length > 0 && view === 'day' && (
              <DayView trainers={trainers} weekday={weekday} onEdit={setEdit} onDelete={(uid, wd) => del.mutate({ userId: uid, weekday: wd })} />
            )}
            {!isLoading && !isError && trainers.length > 0 && view === 'week' && (
              <WeekView trainers={trainers} onEdit={setEdit} />
            )}
            {!isLoading && !isError && trainers.length > 0 && view === 'month' && (
              <MonthView trainers={trainers} monthAnchor={monthAnchor} onEditDay={(wd) => { setWeekday(wd); setView('day'); }} />
            )}
            {view === 'attendance' && (
              <AttendanceMatrix branchId={branchId} ym={attendanceMonth} staff={trainers} />
            )}
          </CardContent>
        </Card>
      </div>

      <ShiftEditSheet
        edit={edit} onClose={() => setEdit(null)}
        onSave={(payload) => upsert.mutate(payload, { onSuccess: () => setEdit(null) })}
        onSaveBulk={(payload) => bulkUpsert.mutate(payload, { onSuccess: () => setEdit(null) })}
        saving={upsert.isPending || bulkUpsert.isPending}
      />

      <RosterSendDrawer
        open={sendOpen} onClose={() => setSendOpen(false)}
        branchId={branchId} branchName={currentBranchName}
        scope="week"
        periodLabel={`Week of ${format(weekAnchor, 'dd MMM yyyy')}`}
        monthAnchor={monthAnchor}
        trainers={trainers}
      />

      <SundayAssignSheet
        open={sundayOpen}
        onClose={() => setSundayOpen(false)}
        sundayDate={sundayDate}
        onChangeSundayDate={setSundayDate}
        allStaff={allStaff}
        existingOverrides={sundayOverrides}
        onAssign={async ({ scope, picks, removedUserIds }) => {
          // Save assigned picks
          for (const a of picks) {
            if (scope === 'recurring') {
              await upsert.mutateAsync({
                user_id: a.user_id,
                weekday: 0,
                morning_start: a.morning_start || null,
                morning_end: a.morning_end || null,
                evening_start: a.evening_start || null,
                evening_end: a.evening_end || null,
                is_weekly_off: false,
              });
            } else {
              await upsertOverride.mutateAsync({
                user_id: a.user_id,
                date: sundayDateISO,
                morning_start: a.morning_start || null,
                morning_end: a.morning_end || null,
                evening_start: a.evening_start || null,
                evening_end: a.evening_end || null,
                is_weekly_off: false,
              });
            }
          }
          // Remove deselected (one-off scope only — delete the override row)
          if (scope === 'one_off') {
            for (const uid of removedUserIds) {
              await deleteOverride.mutateAsync({ userId: uid, date: sundayDateISO });
            }
          }
          const dateLabel = format(sundayDate, 'dd MMM');
          toast({
            title: scope === 'recurring'
              ? `Sunday duty saved for ${picks.length} staff — repeats every Sunday`
              : `Sunday duty saved for ${picks.length} staff on ${dateLabel}`,
          });
          setSundayOpen(false);
        }}
      />
    </AppLayout>
  );
}

// ---------------------------------------------------------------------------
// Day view
// ---------------------------------------------------------------------------
function DayView({
  trainers, weekday, onEdit, onDelete,
}: {
  trainers: TrainerRosterRow[]; weekday: number;
  onEdit: (e: EditState) => void; onDelete: (uid: string, wd: number) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-slate-50/80">
          <TableHead className="font-semibold text-slate-600">Staff</TableHead>
          <TableHead className="font-semibold text-slate-600">Role</TableHead>
          <TableHead className="font-semibold text-slate-600">Morning Shift</TableHead>
          <TableHead className="font-semibold text-slate-600">Evening Shift</TableHead>
          <TableHead className="font-semibold text-slate-600">Status</TableHead>
          <TableHead className="text-right font-semibold text-slate-600">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {trainers.map((t) => {
          const s = t.shifts[weekday];
          const off = s?.is_weekly_off;
          return (
            <TableRow key={t.user_id} className="hover:bg-slate-50/60 transition-colors">
              <TableCell>
                <div className="flex items-center gap-3">
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={t.avatar_url || undefined} />
                    <AvatarFallback className="bg-indigo-50 text-indigo-700 text-xs font-semibold">
                      {t.full_name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col leading-tight">
                    <span className="font-medium text-slate-900">{t.full_name}</span>
                    {t.position && t.position !== t.role && (
                      <span className="text-[11px] text-slate-500">{t.position}{t.department ? ` · ${t.department}` : ''}</span>
                    )}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${ROLE_TONES[t.role]}`}>
                  {t.role}
                </span>
              </TableCell>
              <TableCell>
                {off ? <span className="text-xs text-slate-400">Weekly off</span> :
                  <ShiftPill start={s?.morning_start ?? null} end={s?.morning_end ?? null} tone="morning" />}
              </TableCell>
              <TableCell>
                {off ? <span className="text-xs text-slate-400">—</span> :
                  <ShiftPill start={s?.evening_start ?? null} end={s?.evening_end ?? null} tone="evening" />}
              </TableCell>
              <TableCell>
                {off ? <Badge className="bg-blue-100 text-blue-700 rounded-full">Off</Badge>
                  : s ? <Badge className="bg-emerald-100 text-emerald-700 rounded-full">Scheduled</Badge>
                  : <Badge variant="outline" className="rounded-full text-slate-500">Unscheduled</Badge>}
              </TableCell>
              <TableCell className="text-right">
                <div className="inline-flex gap-1">
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0"
                    onClick={() => onEdit({ trainer: t, weekday })} aria-label="Edit shift">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {s?.id && (
                    <Button size="sm" variant="ghost"
                      className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={() => onDelete(t.user_id, weekday)} aria-label="Delete shift">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ---------------------------------------------------------------------------
// Week view
// ---------------------------------------------------------------------------
function WeekView({ trainers, onEdit }: { trainers: TrainerRosterRow[]; onEdit: (e: EditState) => void }) {
  // Detect if anyone is contracted to work on Sunday
  const sundayContracted = trainers.some((t) => {
    const s = t.shifts[0];
    return s && !s.is_weekly_off && (s.morning_start || s.evening_start);
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50/80">
          <tr>
            <th className="sticky left-0 z-10 bg-slate-50/80 px-4 py-3 text-left font-semibold text-slate-600">Staff</th>
            {WEEKDAYS.map((d) => (
              <th key={d.idx} className="px-3 py-3 text-center font-semibold text-slate-600 min-w-[110px]">
                {d.short}
                {d.idx === 0 && sundayContracted && (
                  <span className="block text-[9px] font-normal text-amber-600 mt-0.5">contracted</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trainers.map((t) => (
            <tr key={t.user_id} className="border-t border-slate-100 hover:bg-slate-50/50">
              <td className="sticky left-0 z-10 bg-white px-4 py-3">
                <div className="flex items-center gap-2">
                  <Avatar className="h-7 w-7">
                    <AvatarImage src={t.avatar_url || undefined} />
                    <AvatarFallback className="bg-indigo-50 text-indigo-700 text-[10px] font-semibold">
                      {t.full_name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col">
                    <span className="font-medium text-slate-900 whitespace-nowrap leading-tight">{t.full_name}</span>
                    {t.position && t.position !== t.role && (
                      <span className="text-[10px] text-slate-500 leading-tight">{t.position}</span>
                    )}
                    <span className={`inline-block w-fit rounded-full px-1.5 text-[9px] font-medium mt-0.5 ${ROLE_TONES[t.role]}`}>
                      {t.role}
                    </span>
                  </div>
                </div>
              </td>
              {WEEKDAYS.map((d) => {
                const s = t.shifts[d.idx];
                return (
                  <td key={d.idx} className="px-2 py-2 text-center align-middle">
                    <button
                      onClick={() => onEdit({ trainer: t, weekday: d.idx })}
                      className="inline-flex w-full flex-col gap-0.5 rounded-lg border border-transparent px-1 py-1 hover:border-indigo-200 hover:bg-indigo-50/40 transition-colors"
                    >
                      {s?.is_weekly_off ? (
                        <span className="inline-block rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">OFF</span>
                      ) : s ? (
                        <>
                          {s.morning_start && s.morning_end && (
                            <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                              {fmtTime12(s.morning_start)}–{fmtTime12(s.morning_end)}
                            </span>
                          )}
                          {s.evening_start && s.evening_end && (
                            <span className="inline-block rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
                              {fmtTime12(s.evening_start)}–{fmtTime12(s.evening_end)}
                            </span>
                          )}
                          {!(s.morning_start || s.evening_start) && (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Month view (heatmap by weekday duty)
// ---------------------------------------------------------------------------
function MonthView({
  trainers, monthAnchor, onEditDay,
}: {
  trainers: TrainerRosterRow[]; monthAnchor: Date; onEditDay: (weekday: number) => void;
}) {
  const year = monthAnchor.getFullYear();
  const month = monthAnchor.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const stats = (wd: number) => {
    let onDuty = 0, off = 0;
    for (const t of trainers) {
      const s = t.shifts[wd];
      if (s?.is_weekly_off) off++;
      else if (s && (s.morning_start || s.evening_start)) onDuty++;
    }
    return { onDuty, off };
  };

  return (
    <div className="p-4">
      <div className="grid grid-cols-7 gap-1 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="text-center py-2">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (d === null) return <div key={i} className="h-24 rounded-lg bg-slate-50/30" />;
          const wd = new Date(year, month, d).getDay();
          const { onDuty, off } = stats(wd);
          const intensity = onDuty === 0 ? 'bg-slate-50' : onDuty <= 2 ? 'bg-indigo-50' : onDuty <= 4 ? 'bg-indigo-100' : 'bg-indigo-200';
          return (
            <button
              key={i}
              onClick={() => onEditDay(wd)}
              className={`h-24 rounded-lg ${intensity} border border-slate-100 hover:border-indigo-400 hover:shadow-md hover:shadow-indigo-500/10 transition-all p-2 text-left flex flex-col`}
            >
              <span className="text-sm font-bold text-slate-900">{d}</span>
              <div className="mt-auto space-y-0.5">
                {onDuty > 0 && <div className="text-[10px] font-medium text-indigo-700">{onDuty} on duty</div>}
                {off > 0 && <div className="text-[10px] font-medium text-blue-600">{off} off</div>}
              </div>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-slate-500 text-center">Click any day to edit that weekday&rsquo;s schedule.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attendance Matrix (robust monthly log with on-time/late/absent detection)
// ---------------------------------------------------------------------------
const GRACE_MINUTES = 10;

type AttCellKind = 'ontime' | 'late' | 'absent' | 'off' | 'unscheduled' | 'future';

function AttendanceMatrix({
  branchId, ym, staff,
}: {
  branchId: string | undefined; ym: string; staff: TrainerRosterRow[];
}) {
  const { data: logs = [], isLoading } = useStaffAttendanceMonth(branchId, ym);
  const [showOnlyLate, setShowOnlyLate] = useState(false);
  const [search, setSearch] = useState('');

  const [year, monthNum] = ym.split('-').map(Number);
  const month = monthNum - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dayNums = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const todayDate = today.getDate();

  // Group logs: user_id → date(YYYY-MM-DD) → earliest check_in
  const checkInByDay = useMemo(() => {
    const map = new Map<string, Map<string, { check_in: string; check_out: string | null; hours: number }>>();
    for (const log of logs) {
      if (!log.check_in) continue;
      const date = log.check_in.slice(0, 10);
      if (!map.has(log.user_id)) map.set(log.user_id, new Map());
      const userMap = map.get(log.user_id)!;
      const hrs = log.total_hours != null ? Number(log.total_hours)
        : (log.check_in && log.check_out
          ? (new Date(log.check_out).getTime() - new Date(log.check_in).getTime()) / 3_600_000
          : 0);
      const existing = userMap.get(date);
      if (!existing || log.check_in < existing.check_in) {
        userMap.set(date, { check_in: log.check_in, check_out: log.check_out, hours: hrs });
      }
    }
    return map;
  }, [logs]);

  function cellFor(staffRow: TrainerRosterRow, d: number): { kind: AttCellKind; lateMin?: number; checkIn?: string; checkOut?: string | null; hours?: number } {
    const dateObj = new Date(year, month, d);
    const wd = dateObj.getDay();
    const shift = staffRow.shifts[wd];
    const dateStr = `${ym}-${String(d).padStart(2, '0')}`;
    const isFuture = isCurrentMonth && d > todayDate;

    if (shift?.is_weekly_off) return { kind: 'off' };

    const log = checkInByDay.get(staffRow.user_id)?.get(dateStr);
    const scheduledStart = shift?.morning_start || shift?.evening_start;

    if (!scheduledStart) {
      if (log) {
        return { kind: 'ontime', checkIn: log.check_in, checkOut: log.check_out, hours: log.hours };
      }
      return { kind: isFuture ? 'future' : 'unscheduled' };
    }

    if (!log) {
      return { kind: isFuture ? 'future' : 'absent' };
    }

    // Compare check-in time vs scheduled start (HH:MM)
    const checkInTime = new Date(log.check_in);
    const [sh, sm] = scheduledStart.slice(0, 5).split(':').map(Number);
    const scheduled = new Date(year, month, d, sh, sm);
    const lateMs = checkInTime.getTime() - scheduled.getTime();
    const lateMin = Math.round(lateMs / 60000);

    if (lateMin > GRACE_MINUTES) {
      return { kind: 'late', lateMin, checkIn: log.check_in, checkOut: log.check_out, hours: log.hours };
    }
    return { kind: 'ontime', checkIn: log.check_in, checkOut: log.check_out, hours: log.hours };
  }

  const rows = useMemo(() => {
    return staff
      .filter((s) => !search.trim() || s.full_name.toLowerCase().includes(search.trim().toLowerCase()))
      .map((s) => {
        const cells = dayNums.map((d) => cellFor(s, d));
        const stats = cells.reduce(
          (acc, c) => {
            if (c.kind === 'ontime') acc.present++;
            if (c.kind === 'late') { acc.present++; acc.late++; }
            if (c.kind === 'absent') acc.absent++;
            if (c.kind === 'off') acc.off++;
            if (c.hours) acc.hours += c.hours;
            return acc;
          },
          { present: 0, late: 0, absent: 0, off: 0, hours: 0 },
        );
        return { staff: s, cells, stats };
      })
      .filter((r) => !showOnlyLate || r.stats.late > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff, dayNums, checkInByDay, showOnlyLate, search, ym]);

  const kpis = useMemo(() => {
    let totalCheckIns = 0, totalLate = 0, totalAbsent = 0;
    rows.forEach((r) => {
      totalCheckIns += r.stats.present;
      totalLate += r.stats.late;
      totalAbsent += r.stats.absent;
    });
    const onTime = totalCheckIns - totalLate;
    const onTimePct = totalCheckIns > 0 ? Math.round((onTime / totalCheckIns) * 100) : 0;
    return { totalStaff: rows.length, onTimePct, totalLate, totalAbsent };
  }, [rows]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* KPI strip */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <KpiCard label="Staff tracked" value={String(kpis.totalStaff)} icon={<Users className="h-4 w-4" />} tone="indigo" />
        <KpiCard label="On-time rate" value={`${kpis.onTimePct}%`} icon={<CheckCircle2 className="h-4 w-4" />} tone="emerald" />
        <KpiCard label="Late arrivals" value={String(kpis.totalLate)} icon={<AlertTriangle className="h-4 w-4" />} tone="amber" />
        <KpiCard label="Absences" value={String(kpis.totalAbsent)} icon={<XCircle className="h-4 w-4" />} tone="red" />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search staff…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-[200px] h-9"
        />
        <Button
          size="sm" variant={showOnlyLate ? 'default' : 'outline'}
          onClick={() => setShowOnlyLate((v) => !v)}
          className={showOnlyLate ? 'bg-amber-500 hover:bg-amber-600 text-white' : ''}
        >
          <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
          {showOnlyLate ? 'Showing late only' : 'Show only late'}
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
          <LegendDot tone="emerald" label="On time" />
          <LegendDot tone="amber" label="Late" />
          <LegendDot tone="red" label="Absent" />
          <LegendDot tone="blue" label="Weekly off" />
          <LegendDot tone="slate" label="Unscheduled" />
        </div>
      </div>

      {/* Matrix */}
      <div className="overflow-x-auto rounded-xl border border-slate-100">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 sticky top-0">
            <tr>
              <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-semibold text-slate-600 min-w-[180px]">Staff</th>
              {dayNums.map((d) => {
                const wd = new Date(year, month, d).getDay();
                const isWeekend = wd === 0 || wd === 6;
                return (
                  <th key={d} className={`px-1 py-2 text-center font-semibold ${isWeekend ? 'text-indigo-600' : 'text-slate-600'} min-w-[24px]`}>
                    <div>{d}</div>
                    <div className="text-[8px] font-normal text-slate-400">{['S', 'M', 'T', 'W', 'T', 'F', 'S'][wd]}</div>
                  </th>
                );
              })}
              <th className="px-2 py-2 text-center font-semibold text-emerald-700 min-w-[44px]">P</th>
              <th className="px-2 py-2 text-center font-semibold text-amber-700 min-w-[44px]">L</th>
              <th className="px-2 py-2 text-center font-semibold text-red-700 min-w-[44px]">A</th>
              <th className="px-2 py-2 text-center font-semibold text-blue-700 min-w-[44px]">O</th>
              <th className="px-2 py-2 text-center font-semibold text-slate-700 min-w-[56px]">Hours</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={daysInMonth + 6} className="py-12 text-center text-slate-500">
                  <Clock className="mx-auto h-10 w-10 opacity-40 mb-2" />
                  No attendance to show.
                </td>
              </tr>
            )}
            {rows.map(({ staff: s, cells, stats }) => (
              <tr key={s.user_id} className="border-t border-slate-100 hover:bg-slate-50/40">
                <td className="sticky left-0 z-10 bg-white px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-6 w-6">
                      <AvatarImage src={s.avatar_url || undefined} />
                      <AvatarFallback className="bg-indigo-50 text-indigo-700 text-[9px]">
                        {s.full_name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col leading-tight">
                      <span className="font-medium text-slate-900 text-xs">{s.full_name}</span>
                      <span className={`inline-block w-fit rounded-full px-1.5 text-[9px] font-medium ${ROLE_TONES[s.role]}`}>
                        {s.role}
                      </span>
                    </div>
                  </div>
                </td>
                {cells.map((c, i) => (
                  <AttCell key={i} cell={c} day={i + 1} />
                ))}
                <td className="text-center font-semibold text-emerald-700">{stats.present}</td>
                <td className="text-center font-semibold text-amber-700">{stats.late}</td>
                <td className="text-center font-semibold text-red-700">{stats.absent}</td>
                <td className="text-center font-semibold text-blue-700">{stats.off}</td>
                <td className="text-center font-semibold text-slate-700">{stats.hours.toFixed(1)}h</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-slate-500">
        Late = check-in more than {GRACE_MINUTES} min after scheduled start. Absent = scheduled day with no check-in.
      </p>
    </div>
  );
}

function AttCell({ cell, day }: { cell: ReturnType<typeof Object> & any; day: number }) {
  const tone = {
    ontime: 'bg-emerald-100 text-emerald-700',
    late: 'bg-amber-100 text-amber-700',
    absent: 'bg-red-100 text-red-700',
    off: 'bg-blue-100 text-blue-700',
    unscheduled: 'text-slate-300',
    future: 'text-slate-200',
  }[cell.kind as AttCellKind];

  const symbol = {
    ontime: '✓',
    late: 'L',
    absent: '✗',
    off: '—',
    unscheduled: '·',
    future: '·',
  }[cell.kind as AttCellKind];

  const title = (() => {
    if (cell.kind === 'late') return `Day ${day} · ${cell.lateMin} min late · in ${cell.checkIn ? format(new Date(cell.checkIn), 'hh:mm a') : '?'}`;
    if (cell.kind === 'ontime') return `Day ${day} · ${cell.checkIn ? format(new Date(cell.checkIn), 'hh:mm a') : ''}${cell.checkOut ? ` → ${format(new Date(cell.checkOut), 'hh:mm a')}` : ''}`;
    if (cell.kind === 'absent') return `Day ${day} · absent`;
    if (cell.kind === 'off') return `Day ${day} · weekly off`;
    return `Day ${day}`;
  })();

  return (
    <td className="px-0.5 py-1 text-center">
      <span
        title={title}
        className={`inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-semibold ${tone}`}
      >
        {symbol}
      </span>
    </td>
  );
}

function KpiCard({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone: 'indigo' | 'emerald' | 'amber' | 'red' }) {
  const toneCls = {
    indigo: 'bg-indigo-50 text-indigo-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
  }[tone];
  return (
    <div className="rounded-xl bg-white border border-slate-100 shadow-sm p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</span>
        <span className={`p-1.5 rounded-full ${toneCls}`}>{icon}</span>
      </div>
      <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
    </div>
  );
}

function LegendDot({ tone, label }: { tone: 'emerald' | 'amber' | 'red' | 'blue' | 'slate'; label: string }) {
  const cls = {
    emerald: 'bg-emerald-400', amber: 'bg-amber-400', red: 'bg-red-400', blue: 'bg-blue-400', slate: 'bg-slate-300',
  }[tone];
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-2 w-2 rounded-full ${cls}`} />{label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Edit drawer (with Apply-to-days bulk control)
// ---------------------------------------------------------------------------
type ApplyMode = 'this' | 'weekdays' | 'all' | 'custom';

function ShiftEditSheet({
  edit, onClose, onSave, onSaveBulk, saving,
}: {
  edit: EditState | null;
  onClose: () => void;
  onSave: (row: Partial<ShiftRow> & { user_id: string; weekday: number }) => void;
  onSaveBulk: (input: {
    user_id: string;
    weekdays: number[];
    template: Omit<Partial<ShiftRow>, 'user_id' | 'weekday'>;
    existingShifts: Record<number, ShiftRow | undefined>;
    overwriteWeeklyOff?: boolean;
  }) => void;
  saving: boolean;
}) {
  const existing = edit?.trainer.shifts[edit.weekday];
  const [morningStart, setMorningStart] = useState('');
  const [morningEnd, setMorningEnd] = useState('');
  const [eveningStart, setEveningStart] = useState('');
  const [eveningEnd, setEveningEnd] = useState('');
  const [off, setOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyMode, setApplyMode] = useState<ApplyMode>('this');
  const [customDays, setCustomDays] = useState<Set<number>>(new Set());
  const [overwriteOff, setOverwriteOff] = useState(false);

  useMemo(() => {
    setMorningStart(existing?.morning_start?.slice(0, 5) ?? '');
    setMorningEnd(existing?.morning_end?.slice(0, 5) ?? '');
    setEveningStart(existing?.evening_start?.slice(0, 5) ?? '');
    setEveningEnd(existing?.evening_end?.slice(0, 5) ?? '');
    setOff(!!existing?.is_weekly_off);
    setError(null);
    setApplyMode('this');
    setCustomDays(new Set([edit?.weekday ?? 0]));
    setOverwriteOff(false);
  }, [edit?.trainer.user_id, edit?.weekday, existing]);

  const otherOffDay = useMemo(() => {
    if (!edit || !off) return null;
    for (const [wdKey, s] of Object.entries(edit.trainer.shifts)) {
      const wd = Number(wdKey);
      if (wd !== edit.weekday && s?.is_weekly_off) {
        return WEEKDAYS.find((d) => d.idx === wd)?.full || null;
      }
    }
    return null;
  }, [edit, off]);

  if (!edit) return null;

  const targetWeekdays = (): number[] => {
    if (applyMode === 'this') return [edit.weekday];
    if (applyMode === 'weekdays') return [1, 2, 3, 4, 5, 6]; // Mon–Sat
    if (applyMode === 'all') return [0, 1, 2, 3, 4, 5, 6];
    return Array.from(customDays).sort();
  };

  const handleSave = () => {
    setError(null);
    if (!off) {
      const mFilled = !!morningStart || !!morningEnd;
      const eFilled = !!eveningStart || !!eveningEnd;
      if (mFilled && (!morningStart || !morningEnd)) { setError('Morning shift needs both start and end times.'); return; }
      if (eFilled && (!eveningStart || !eveningEnd)) { setError('Evening shift needs both start and end times.'); return; }
      if (!mFilled && !eFilled) { setError('Add at least one shift block or mark as weekly off.'); return; }
    }

    const template: Omit<Partial<ShiftRow>, 'user_id' | 'weekday'> = {
      is_weekly_off: off,
      morning_start: off ? null : (morningStart || null),
      morning_end:   off ? null : (morningEnd || null),
      evening_start: off ? null : (eveningStart || null),
      evening_end:   off ? null : (eveningEnd || null),
    };

    const days = targetWeekdays();
    if (days.length === 0) { setError('Pick at least one day to apply this to.'); return; }

    // Bulk weekly-off is forbidden (one-off-per-user db index)
    if (off && days.length > 1) {
      setError('Weekly-off can only be applied to one day. Switch "Apply to" to "Only this day".');
      return;
    }

    if (days.length === 1) {
      onSave({ user_id: edit.trainer.user_id, weekday: days[0], ...template });
    } else {
      onSaveBulk({
        user_id: edit.trainer.user_id,
        weekdays: days,
        template,
        existingShifts: edit.trainer.shifts,
        overwriteWeeklyOff: overwriteOff,
      });
    }
  };

  const dayName = WEEKDAYS.find((d) => d.idx === edit.weekday)?.full;
  const isSunday = edit.weekday === 0;

  const previewCount = targetWeekdays().length;

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit shift · {edit.trainer.full_name}</SheetTitle>
          <SheetDescription>{dayName} schedule. Leave a block empty to skip it.</SheetDescription>
        </SheetHeader>

        <div className="py-6 space-y-6">
          {/* Apply to days */}
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <CalIcon className="h-4 w-4 text-indigo-600" />
              <span className="font-semibold text-sm text-indigo-900">Apply this shift to</span>
              <Badge variant="outline" className="ml-auto text-[10px] rounded-full">{previewCount} day{previewCount === 1 ? '' : 's'}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {([
                ['this', `Only ${dayName}`],
                ['weekdays', 'All weekdays (Mon–Sat)'],
                ['all', 'Every day (Mon–Sun)'],
                ['custom', 'Custom days…'],
              ] as [ApplyMode, string][]).map(([k, label]) => (
                <label key={k} className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer ${
                  applyMode === k ? 'border-indigo-400 bg-white' : 'border-slate-200 bg-white/60'
                }`}>
                  <input
                    type="radio" name="apply-mode" value={k}
                    checked={applyMode === k}
                    onChange={() => setApplyMode(k)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            {applyMode === 'custom' && (
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((d) => {
                  const sel = customDays.has(d.idx);
                  return (
                    <button
                      key={d.idx} type="button"
                      onClick={() => {
                        const next = new Set(customDays);
                        if (next.has(d.idx)) next.delete(d.idx); else next.add(d.idx);
                        setCustomDays(next);
                      }}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        sel ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-600'
                      }`}
                    >
                      {d.short}
                    </button>
                  );
                })}
              </div>
            )}
            {applyMode !== 'this' && !off && (
              <div className="flex items-start gap-2 text-xs text-slate-600">
                <input
                  id="ow" type="checkbox" className="mt-0.5"
                  checked={overwriteOff} onChange={(e) => setOverwriteOff(e.target.checked)}
                />
                <label htmlFor="ow">
                  Overwrite existing weekly-off days. <span className="text-slate-400">(Off by default — weekly-off rows are preserved.)</span>
                </label>
              </div>
            )}
          </div>

          {isSunday && !off && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div>
                Sunday is a contractual working day for some staff. You can assign a normal shift here.
                <button
                  type="button"
                  className="ml-2 underline font-medium"
                  onClick={() => { setMorningStart('06:00'); setMorningEnd('12:00'); }}
                >
                  Assign 6 AM – 12 PM
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 px-4">
            <div>
              <Label htmlFor="off-toggle" className="font-medium">Weekly off</Label>
              <p className="text-xs text-slate-500">Marks this day as a rest day. Only one weekly-off allowed per staff member.</p>
            </div>
            <Switch id="off-toggle" checked={off} onCheckedChange={setOff} />
          </div>

          {otherOffDay && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2">
              ⚠ {edit.trainer.full_name} already has a weekly-off on <b>{otherOffDay}</b>. Saving will fail unless you clear the existing off-day first.
            </div>
          )}

          <fieldset disabled={off} className="space-y-4 disabled:opacity-50">
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/30 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Sun className="h-4 w-4 text-emerald-600" />
                <span className="font-semibold text-sm text-emerald-900">Morning block</span>
                {(morningStart || morningEnd) && (
                  <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs"
                    onClick={() => { setMorningStart(''); setMorningEnd(''); }}>Clear</Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="ms" className="text-xs">Start</Label>
                  <Input id="ms" type="time" value={morningStart} onChange={(e) => setMorningStart(e.target.value)} />
                  {morningStart && <p className="text-[10px] text-slate-500 mt-1">{fmtTime12(morningStart)}</p>}
                </div>
                <div>
                  <Label htmlFor="me" className="text-xs">End</Label>
                  <Input id="me" type="time" value={morningEnd} onChange={(e) => setMorningEnd(e.target.value)} />
                  {morningEnd && <p className="text-[10px] text-slate-500 mt-1">{fmtTime12(morningEnd)}</p>}
                </div>
              </div>
              {morningStart && morningEnd && morningEnd < morningStart && (
                <p className="text-xs text-blue-700">Overnight shift detected (ends next day).</p>
              )}
            </div>

            <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Moon className="h-4 w-4 text-indigo-600" />
                <span className="font-semibold text-sm text-indigo-900">Evening block</span>
                {(eveningStart || eveningEnd) && (
                  <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs"
                    onClick={() => { setEveningStart(''); setEveningEnd(''); }}>Clear</Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="es" className="text-xs">Start</Label>
                  <Input id="es" type="time" value={eveningStart} onChange={(e) => setEveningStart(e.target.value)} />
                  {eveningStart && <p className="text-[10px] text-slate-500 mt-1">{fmtTime12(eveningStart)}</p>}
                </div>
                <div>
                  <Label htmlFor="ee" className="text-xs">End</Label>
                  <Input id="ee" type="time" value={eveningEnd} onChange={(e) => setEveningEnd(e.target.value)} />
                  {eveningEnd && <p className="text-[10px] text-slate-500 mt-1">{fmtTime12(eveningEnd)}</p>}
                </div>
              </div>
            </div>
          </fieldset>

          {error && <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}
        </div>

        <SheetFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : previewCount > 1 ? `Save to ${previewCount} days` : 'Save shift'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Send drawer — WhatsApp / Email via dispatchCommunication
// ---------------------------------------------------------------------------
function RosterSendDrawer({
  open, onClose, branchId, branchName, scope, periodLabel, weekday, monthAnchor, trainers,
}: {
  open: boolean; onClose: () => void;
  branchId: string | undefined; branchName: string | null | undefined;
  scope: 'day' | 'week' | 'month';
  periodLabel: string; weekday?: number; monthAnchor?: Date;
  trainers: TrainerRosterRow[];
}) {
  const { toast } = useToast();
  const [channel, setChannel] = useState<'whatsapp' | 'email'>('whatsapp');
  const [recipient, setRecipient] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!recipient.trim()) {
      toast({ title: 'Recipient required', variant: 'destructive' });
      return;
    }
    if (!branchId) {
      toast({ title: 'No branch selected', variant: 'destructive' });
      return;
    }
    try {
      setSending(true);
      const blob = await buildStaffRosterPdf({
        scope, periodLabel, weekday, monthAnchor,
        trainers: trainers.map((t) => ({ user_id: t.user_id, full_name: t.full_name, shifts: t.shifts })),
        branchId, branchName,
      });
      const safeBranch = (branchName || 'incline').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      const filename = `roster-${safeBranch}-${scope}-${format(new Date(), 'yyyyMMdd')}.pdf`;
      const { url } = await uploadAttachment(blob, {
        folder: 'roster', filename, contentType: 'application/pdf',
      });

      const body = `Staff roster · ${branchName || 'Incline'} · ${periodLabel}\n\nDownload: ${url}`;
      const result = await dispatchCommunication({
        branch_id: branchId,
        channel,
        category: 'announcement',
        recipient: recipient.trim(),
        payload: {
          subject: channel === 'email' ? `Staff Roster — ${periodLabel}` : undefined,
          body,
          use_branded_template: channel === 'email',
        },
        dedupe_key: buildDedupeKey(['roster', scope, format(new Date(), 'yyyyMMddHHmm'), channel, recipient.trim()]),
        force: true,
        attachment: channel === 'whatsapp'
          ? { url, filename, content_type: 'application/pdf', kind: 'document' }
          : undefined,
      });

      if (result.status === 'failed') {
        toast({ title: 'Send failed', description: result.reason, variant: 'destructive' });
      } else {
        toast({ title: 'Roster sent', description: `Status: ${result.status}` });
        onClose();
        setRecipient('');
      }
    } catch (e: any) {
      toast({ title: 'Send failed', description: e?.message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Send roster</SheetTitle>
          <SheetDescription>{periodLabel}</SheetDescription>
        </SheetHeader>
        <div className="py-6 space-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500">Channel</Label>
            <Tabs value={channel} onValueChange={(v) => setChannel(v as 'whatsapp' | 'email')} className="mt-2">
              <TabsList className="w-full">
                <TabsTrigger value="whatsapp" className="flex-1">WhatsApp</TabsTrigger>
                <TabsTrigger value="email" className="flex-1">Email</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div>
            <Label htmlFor="rcp" className="text-xs uppercase tracking-wider text-slate-500">
              {channel === 'whatsapp' ? 'WhatsApp number (+91…)' : 'Email address'}
            </Label>
            <Input
              id="rcp" className="mt-2"
              placeholder={channel === 'whatsapp' ? '+919876543210' : 'manager@theincline.in'}
              value={recipient} onChange={(e) => setRecipient(e.target.value)}
            />
          </div>
          <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            A branded weekly roster PDF will be generated and sent as an attachment.
          </div>
        </div>
        <SheetFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSend} disabled={sending}>
            {sending ? 'Sending…' : 'Send roster'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Sunday Duty card + Assign sheet (date-aware + recurring/one-off scope)
// ---------------------------------------------------------------------------
interface SundayEntryPublic {
  staff: TrainerRosterRow;
  source: 'override' | 'recurring';
  morning_start: string | null;
  morning_end: string | null;
  evening_start: string | null;
  evening_end: string | null;
}

function SundayDatePicker({
  date, onChange,
}: { date: Date; onChange: (d: Date) => void }) {
  const [open, setOpen] = useState(false);
  const isUpcoming = isSameDay(date, nextSunday());
  return (
    <div className="flex items-center gap-1">
      <Button
        size="icon" variant="ghost"
        onClick={() => onChange(prevSunday(date))}
        className="h-8 w-8 text-slate-500 hover:text-amber-600"
        aria-label="Previous Sunday"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 rounded-full border-amber-200 bg-white text-xs font-semibold text-slate-800 hover:border-amber-400 hover:bg-amber-50"
          >
            <CalendarDays className="h-3.5 w-3.5 text-amber-600" />
            {format(date, 'EEE, dd MMM yyyy')}
            {isUpcoming && (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">
                Next
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={(d) => { if (d) { onChange(d); setOpen(false); } }}
            disabled={(d) => d.getDay() !== 0 || d < startOfDay(new Date())}
            initialFocus
            className={cn('p-3 pointer-events-auto')}
          />
        </PopoverContent>
      </Popover>
      <Button
        size="icon" variant="ghost"
        onClick={() => onChange(nextSundayFrom(date))}
        className="h-8 w-8 text-slate-500 hover:text-amber-600"
        aria-label="Next Sunday"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function SundayDutyCard({
  sundayDate, onChangeSundayDate, entries, allStaffCount, onEdit, onAssign,
}: {
  sundayDate: Date;
  onChangeSundayDate: (d: Date) => void;
  entries: SundayEntryPublic[];
  allStaffCount: number;
  onEdit: (t: TrainerRosterRow) => void;
  onAssign: () => void;
}) {
  return (
    <Card className="rounded-2xl border-0 shadow-lg shadow-amber-100/40 bg-gradient-to-br from-amber-50/60 via-white to-white">
      <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Sun className="h-5 w-5 text-amber-500" />
            Sunday Duty
          </CardTitle>
          <Badge variant="outline" className="rounded-full text-[10px]">
            {entries.length} assigned
          </Badge>
          <SundayDatePicker date={sundayDate} onChange={onChangeSundayDate} />
        </div>
        <Button
          size="sm"
          onClick={onAssign}
          className="bg-amber-500 hover:bg-amber-600 text-white shadow-sm"
          disabled={allStaffCount === 0}
        >
          + Assign Sunday
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {entries.length === 0 ? (
          <p className="text-xs text-slate-500 py-2">
            No one assigned for <b>{format(sundayDate, 'EEE, dd MMM')}</b>. Most staff have Sunday as their weekly off — tap <b>Assign Sunday</b> to add duty for this Sunday or every Sunday.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {entries.map((e) => {
              const t = e.staff;
              return (
                <button
                  key={t.user_id}
                  onClick={() => onEdit(t)}
                  className="group flex items-center gap-2 rounded-full bg-white border border-amber-200 pl-1 pr-3 py-1 hover:border-amber-400 hover:shadow-sm transition-all"
                  title={e.source === 'override' ? `One-off for ${format(sundayDate, 'dd MMM')}` : 'Recurring every Sunday'}
                >
                  <Avatar className="h-6 w-6">
                    <AvatarImage src={t.avatar_url || undefined} />
                    <AvatarFallback className="bg-amber-100 text-amber-700 text-[10px] font-semibold">
                      {t.full_name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-xs font-medium text-slate-900">{t.full_name}</span>
                  <span className={cn(
                    'rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                    e.source === 'override'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-slate-100 text-slate-600',
                  )}>
                    {e.source === 'override' ? 'One-off' : 'Recurring'}
                  </span>
                  <span className="text-[10px] text-amber-700 font-medium">
                    {e.morning_start && fmtTime12(e.morning_start)}
                    {e.morning_start && e.morning_end && '–'}
                    {e.morning_end && fmtTime12(e.morning_end)}
                    {e.evening_start && (e.morning_start ? ' · ' : '')}
                    {e.evening_start && fmtTime12(e.evening_start)}
                    {e.evening_start && e.evening_end && '–'}
                    {e.evening_end && fmtTime12(e.evening_end)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface SundayPick {
  user_id: string;
  morning_start: string;
  morning_end: string;
  evening_start: string;
  evening_end: string;
}

type SundayScope = 'one_off' | 'recurring';

function SundayAssignSheet({
  open, onClose, sundayDate, onChangeSundayDate, allStaff, existingOverrides, onAssign,
}: {
  open: boolean;
  onClose: () => void;
  sundayDate: Date;
  onChangeSundayDate: (d: Date) => void;
  allStaff: TrainerRosterRow[];
  existingOverrides: ShiftOverrideRow[];
  onAssign: (args: {
    scope: SundayScope;
    picks: SundayPick[];
    removedUserIds: string[];
  }) => Promise<void> | void;
}) {
  const [scope, setScope] = useState<SundayScope>('one_off');
  const [picks, setPicks] = useState<Record<string, SundayPick>>({});
  const [initialUserIds, setInitialUserIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset + prefill whenever the sheet opens, the date changes, or scope changes.
  useEffect(() => {
    if (!open) { setPicks({}); setSearch(''); setInitialUserIds(new Set()); return; }
    const next: Record<string, SundayPick> = {};
    const ids = new Set<string>();
    if (scope === 'one_off') {
      // Prefill from existing overrides for the selected Sunday
      existingOverrides.forEach((o) => {
        if (o.is_weekly_off || (!o.morning_start && !o.evening_start)) return;
        next[o.user_id] = {
          user_id: o.user_id,
          morning_start: (o.morning_start || '').slice(0, 5),
          morning_end: (o.morning_end || '').slice(0, 5),
          evening_start: (o.evening_start || '').slice(0, 5),
          evening_end: (o.evening_end || '').slice(0, 5),
        };
        ids.add(o.user_id);
      });
    } else {
      // Prefill from current recurring Sunday shifts (weekday=0)
      allStaff.forEach((s) => {
        const sh = s.shifts[0];
        if (sh && !sh.is_weekly_off && (sh.morning_start || sh.evening_start)) {
          next[s.user_id] = {
            user_id: s.user_id,
            morning_start: (sh.morning_start || '').slice(0, 5),
            morning_end: (sh.morning_end || '').slice(0, 5),
            evening_start: (sh.evening_start || '').slice(0, 5),
            evening_end: (sh.evening_end || '').slice(0, 5),
          };
          ids.add(s.user_id);
        }
      });
    }
    setPicks(next);
    setInitialUserIds(ids);
  }, [open, scope, sundayDate, existingOverrides, allStaff]);

  const filtered = allStaff.filter((c) =>
    !search.trim() || c.full_name.toLowerCase().includes(search.trim().toLowerCase())
  );
  const selected = Object.values(picks);
  const removedUserIds = useMemo(
    () => Array.from(initialUserIds).filter((id) => !picks[id]),
    [initialUserIds, picks],
  );
  const hasChanges = selected.length > 0 || removedUserIds.length > 0;

  const toggle = (uid: string) => {
    setPicks((p) => {
      if (p[uid]) { const next = { ...p }; delete next[uid]; return next; }
      return { ...p, [uid]: { user_id: uid, morning_start: '06:00', morning_end: '12:00', evening_start: '', evening_end: '' } };
    });
  };

  const updateField = (uid: string, field: keyof SundayPick, val: string) => {
    setPicks((p) => p[uid] ? { ...p, [uid]: { ...p[uid], [field]: val } } : p);
  };

  const handleConfirm = async () => {
    if (!hasChanges) return;
    setSaving(true);
    try { await onAssign({ scope, picks: selected, removedUserIds }); } finally { setSaving(false); }
  };

  const dateLabel = format(sundayDate, 'EEE, dd MMM yyyy');
  const isUpcoming = isSameDay(sundayDate, nextSunday());

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sun className="h-5 w-5 text-amber-500" /> Assign Sunday Duty
          </SheetTitle>
          <SheetDescription>
            Assigning duty for <b>{dateLabel}</b>{isUpcoming ? ' (next Sunday)' : ''}. Choose whether this applies just to this Sunday or repeats every Sunday going forward. Times default to 6 AM – 12 PM and are editable per person.
          </SheetDescription>
        </SheetHeader>

        <div className="py-4 space-y-4">
          {/* Date picker row */}
          <div className="flex flex-col gap-2 rounded-xl border border-amber-100 bg-amber-50/40 p-3">
            <Label className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
              Sunday date
            </Label>
            <SundayDatePicker date={sundayDate} onChange={onChangeSundayDate} />
          </div>

          {/* Scope toggle */}
          <div className="space-y-2">
            <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Apply to
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setScope('one_off')}
                className={cn(
                  'flex items-start gap-2 rounded-xl border p-3 text-left transition-all',
                  scope === 'one_off'
                    ? 'border-amber-400 bg-amber-50 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-slate-300',
                )}
              >
                <CalendarDays className={cn('h-4 w-4 mt-0.5', scope === 'one_off' ? 'text-amber-600' : 'text-slate-400')} />
                <div>
                  <div className="text-xs font-semibold text-slate-900">Just this Sunday</div>
                  <div className="text-[10px] text-slate-500 leading-tight">One-off for {format(sundayDate, 'dd MMM')}. Their weekly schedule stays unchanged.</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setScope('recurring')}
                className={cn(
                  'flex items-start gap-2 rounded-xl border p-3 text-left transition-all',
                  scope === 'recurring'
                    ? 'border-indigo-400 bg-indigo-50 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-slate-300',
                )}
              >
                <Repeat className={cn('h-4 w-4 mt-0.5', scope === 'recurring' ? 'text-indigo-600' : 'text-slate-400')} />
                <div>
                  <div className="text-xs font-semibold text-slate-900">Every Sunday going forward</div>
                  <div className="text-[10px] text-slate-500 leading-tight">Overrides their weekly off permanently until changed.</div>
                </div>
              </button>
            </div>
          </div>

          <Input
            placeholder="Search staff…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9"
          />
          <div className="rounded-xl border border-slate-100 divide-y divide-slate-100 max-h-[360px] overflow-y-auto">
            {filtered.length === 0 && (
              <p className="p-6 text-center text-sm text-slate-500">No matching staff.</p>
            )}
            {filtered.map((c) => {
              const pick = picks[c.user_id];
              const isOn = !!pick;
              const wasInitial = initialUserIds.has(c.user_id);
              return (
                <div key={c.user_id} className={`p-3 ${isOn ? 'bg-amber-50/50' : 'bg-white'}`}>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isOn}
                      onChange={() => toggle(c.user_id)}
                      className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                    />
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={c.avatar_url || undefined} />
                      <AvatarFallback className="bg-indigo-50 text-indigo-700 text-xs font-semibold">
                        {c.full_name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate flex items-center gap-1.5">
                        {c.full_name}
                        {wasInitial && !isOn && (
                          <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-600">
                            Will be removed
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {c.position || c.role}{c.department ? ` · ${c.department}` : ''}
                      </div>
                    </div>
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${ROLE_TONES[c.role]}`}>
                      {c.role}
                    </span>
                  </label>

                  {isOn && (
                    <div className="mt-3 ml-7 grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wider text-emerald-700 flex items-center gap-1">
                          <Sun className="h-3 w-3" /> Morning
                        </Label>
                        <div className="flex items-center gap-1">
                          <Input type="time" value={pick.morning_start} onChange={(e) => updateField(c.user_id, 'morning_start', e.target.value)} className="h-8 text-xs" />
                          <span className="text-slate-400 text-xs">→</span>
                          <Input type="time" value={pick.morning_end} onChange={(e) => updateField(c.user_id, 'morning_end', e.target.value)} className="h-8 text-xs" />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wider text-indigo-700 flex items-center gap-1">
                          <Moon className="h-3 w-3" /> Evening
                        </Label>
                        <div className="flex items-center gap-1">
                          <Input type="time" value={pick.evening_start} onChange={(e) => updateField(c.user_id, 'evening_start', e.target.value)} className="h-8 text-xs" />
                          <span className="text-slate-400 text-xs">→</span>
                          <Input type="time" value={pick.evening_end} onChange={(e) => updateField(c.user_id, 'evening_end', e.target.value)} className="h-8 text-xs" />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <SheetFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleConfirm}
            disabled={!hasChanges || saving}
            className={cn(
              'text-white',
              scope === 'recurring' ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-amber-500 hover:bg-amber-600',
            )}
          >
            {saving
              ? 'Saving…'
              : scope === 'recurring'
                ? `Apply to ${selected.length || ''} staff · every Sunday`
                : `Save for ${format(sundayDate, 'dd MMM')}${selected.length ? ` (${selected.length})` : ''}`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
