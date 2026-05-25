import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { useBranchContext } from '@/contexts/BranchContext';
import {
  useStaffSchedules, useUpsertShift, useDeleteShift,
  useStaffAttendanceMonth,
  type ShiftRow, type TrainerRosterRow,
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
  Pencil, Trash2, Sun, Moon, Calendar as CalIcon, AlertCircle,
  Download, Send, Printer, Clock,
} from 'lucide-react';
import { buildStaffRosterPdf } from '@/utils/pdfBlob';
import { downloadBlob, printBlob } from '@/utils/pdfBlob';
import { uploadAttachment } from '@/utils/uploadAttachment';
import { dispatchCommunication, buildDedupeKey } from '@/lib/comms/dispatch';
import { useToast } from '@/hooks/use-toast';
import { format, startOfMonth, addMonths, addWeeks, startOfWeek } from 'date-fns';

const WEEKDAYS = [
  { idx: 1, short: 'Mon', full: 'Monday' },
  { idx: 2, short: 'Tue', full: 'Tuesday' },
  { idx: 3, short: 'Wed', full: 'Wednesday' },
  { idx: 4, short: 'Thu', full: 'Thursday' },
  { idx: 5, short: 'Fri', full: 'Friday' },
  { idx: 6, short: 'Sat', full: 'Saturday' },
  { idx: 0, short: 'Sun', full: 'Sunday' },
];

const fmtTime = (t: string | null) => (t ? t.slice(0, 5) : null);

type View = 'day' | 'week' | 'month' | 'attendance';

function ShiftPill({ start, end, tone }: { start: string | null; end: string | null; tone: 'morning' | 'evening' }) {
  if (!start || !end) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
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
      {fmtTime(start)} → {fmtTime(end)}
      {overnight && <span className="ml-0.5 text-[10px] opacity-70">overnight</span>}
    </span>
  );
}

interface EditState { trainer: TrainerRosterRow; weekday: number; }

export default function StaffRoster() {
  const { effectiveBranchId, currentBranchName } = useBranchContext();
  const branchId = effectiveBranchId;
  const { toast } = useToast();
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
  const del = useDeleteShift(branchId);

  const today = new Date();
  const [weekday, setWeekday] = useState<number>(today.getDay());
  const [weekAnchor, setWeekAnchor] = useState<Date>(startOfWeek(today, { weekStartsOn: 1 }));
  const [monthAnchor, setMonthAnchor] = useState<Date>(startOfMonth(today));
  const [attendanceMonth, setAttendanceMonth] = useState<string>(format(today, 'yyyy-MM'));

  const [edit, setEdit] = useState<EditState | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [busyPdf, setBusyPdf] = useState(false);

  const trainers = useMemo(() => data ?? [], [data]);

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

  const handleExportPdf = async (mode: 'download' | 'print') => {
    if (trainers.length === 0) {
      toast({ title: 'Nothing to export', description: 'No trainers in this branch yet.', variant: 'destructive' });
      return;
    }
    try {
      setBusyPdf(true);
      const scope = view === 'attendance' ? 'month' : view;
      const blob = await buildStaffRosterPdf({
        scope,
        periodLabel,
        weekday: view === 'day' ? weekday : undefined,
        monthAnchor: view === 'month' ? monthAnchor : view === 'attendance' ? new Date(attendanceMonth + '-01') : undefined,
        trainers: trainers.map((t) => ({
          user_id: t.user_id, full_name: t.full_name, shifts: t.shifts,
        })),
        branchId, branchName: currentBranchName,
      });
      if (mode === 'print') {
        printBlob(blob);
      } else {
        const safeBranch = (currentBranchName || 'incline').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        downloadBlob(blob, `roster-${safeBranch}-${view}-${format(new Date(), 'yyyyMMdd')}.pdf`);
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
                  {trainers.length} trainer{trainers.length === 1 ? '' : 's'}
                </Badge>
                <Badge className="rounded-full bg-white/15 text-white hover:bg-white/20">
                  {trainers.filter((t) => Object.values(t.shifts).some((s) => s?.is_weekly_off)).length} with weekly-off
                </Badge>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary" className="bg-white text-indigo-700 hover:bg-white/90"
                onClick={() => handleExportPdf('download')} disabled={busyPdf}
              >
                <Download className="mr-2 h-4 w-4" />
                {busyPdf ? 'Building…' : 'Export PDF'}
              </Button>
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
            </div>
          </div>
        </div>

        {/* View switcher */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs value={view} onValueChange={(v) => setView(v as View)}>
            <TabsList>
              <TabsTrigger value="day">Day</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="month">Month</TabsTrigger>
              <TabsTrigger value="attendance">Attendance</TabsTrigger>
            </TabsList>
          </Tabs>
          {/* Period controls */}
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
              {trainers.length} {trainers.length === 1 ? 'trainer' : 'trainers'}
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
                <p className="text-sm font-medium text-slate-700">No trainers in this branch yet</p>
                <p className="text-xs text-slate-500">Add trainers from the Trainers page to start building the roster.</p>
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
              <AttendanceView branchId={branchId} ym={attendanceMonth} trainers={trainers} />
            )}
          </CardContent>
        </Card>
      </div>

      <ShiftEditSheet
        edit={edit} onClose={() => setEdit(null)}
        onSave={(payload) => upsert.mutate(payload, { onSuccess: () => setEdit(null) })}
        saving={upsert.isPending}
      />

      <RosterSendDrawer
        open={sendOpen} onClose={() => setSendOpen(false)}
        branchId={branchId} branchName={currentBranchName}
        scope={view === 'attendance' ? 'month' : view}
        periodLabel={periodLabel}
        weekday={view === 'day' ? weekday : undefined}
        monthAnchor={view === 'month' ? monthAnchor : view === 'attendance' ? new Date(attendanceMonth + '-01') : undefined}
        trainers={trainers}
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
          <TableHead className="font-semibold text-slate-600">Trainer</TableHead>
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
                  <span className="font-medium text-slate-900">{t.full_name}</span>
                </div>
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
                {off ? <Badge className="bg-slate-100 text-slate-600 rounded-full">Off</Badge>
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
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50/80">
          <tr>
            <th className="sticky left-0 z-10 bg-slate-50/80 px-4 py-3 text-left font-semibold text-slate-600">Trainer</th>
            {WEEKDAYS.map((d) => (
              <th key={d.idx} className="px-3 py-3 text-center font-semibold text-slate-600 min-w-[110px]">{d.short}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trainers.map((t) => (
            <tr key={t.user_id} className="border-t border-slate-100 hover:bg-slate-50/50">
              <td className="sticky left-0 z-10 bg-white px-4 py-3 group-hover:bg-slate-50">
                <div className="flex items-center gap-2">
                  <Avatar className="h-7 w-7">
                    <AvatarImage src={t.avatar_url || undefined} />
                    <AvatarFallback className="bg-indigo-50 text-indigo-700 text-[10px] font-semibold">
                      {t.full_name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                    </AvatarFallback>
                  </Avatar>
                  <span className="font-medium text-slate-900 whitespace-nowrap">{t.full_name}</span>
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
                              {fmtTime(s.morning_start)}–{fmtTime(s.morning_end)}
                            </span>
                          )}
                          {s.evening_start && s.evening_end && (
                            <span className="inline-block rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
                              {fmtTime(s.evening_start)}–{fmtTime(s.evening_end)}
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
// Month view
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
                {onDuty > 0 && (
                  <div className="text-[10px] font-medium text-indigo-700">
                    {onDuty} on duty
                  </div>
                )}
                {off > 0 && (
                  <div className="text-[10px] font-medium text-blue-600">
                    {off} off
                  </div>
                )}
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
// Attendance view (migrated from HRM)
// ---------------------------------------------------------------------------
function AttendanceView({
  branchId, ym, trainers,
}: {
  branchId: string | undefined; ym: string; trainers: TrainerRosterRow[];
}) {
  const { data: logs = [], isLoading } = useStaffAttendanceMonth(branchId, ym);
  const trainerMap = useMemo(() => {
    const m = new Map<string, TrainerRosterRow>();
    trainers.forEach((t) => m.set(t.user_id, t));
    return m;
  }, [trainers]);

  const summary = useMemo(() => {
    const map = new Map<string, { days: Set<string>; hours: number }>();
    for (const log of logs) {
      const uid = log.user_id;
      if (!map.has(uid)) map.set(uid, { days: new Set(), hours: 0 });
      const entry = map.get(uid)!;
      if (log.check_in) entry.days.add(log.check_in.slice(0, 10));
      if (log.total_hours) entry.hours += Number(log.total_hours);
      else if (log.check_in && log.check_out) {
        const h = (new Date(log.check_out).getTime() - new Date(log.check_in).getTime()) / 3_600_000;
        if (h > 0) entry.hours += h;
      }
    }
    return map;
  }, [logs]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Per-trainer summary cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {trainers.map((t) => {
          const s = summary.get(t.user_id) || { days: new Set(), hours: 0 };
          return (
            <div key={t.user_id} className="rounded-xl bg-white border border-slate-100 shadow-sm p-3">
              <div className="flex items-center gap-3">
                <Avatar className="h-9 w-9">
                  <AvatarImage src={t.avatar_url || undefined} />
                  <AvatarFallback className="bg-indigo-50 text-indigo-700 text-xs font-semibold">
                    {t.full_name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                  </AvatarFallback>
                </Avatar>
                <span className="font-medium text-slate-900 truncate">{t.full_name}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-emerald-50 p-2 text-center">
                  <p className="text-lg font-bold text-emerald-700">{s.days.size}</p>
                  <p className="text-[10px] uppercase tracking-wider text-emerald-600">Days</p>
                </div>
                <div className="rounded-lg bg-indigo-50 p-2 text-center">
                  <p className="text-lg font-bold text-indigo-700">{s.hours.toFixed(1)}h</p>
                  <p className="text-[10px] uppercase tracking-wider text-indigo-600">Hours</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Detailed log */}
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50/80">
            <TableHead>Staff</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Check In</TableHead>
            <TableHead>Check Out</TableHead>
            <TableHead>Hours</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.slice(0, 100).map((log) => {
            const t = trainerMap.get(log.user_id);
            const hrs = log.total_hours ?? (log.check_in && log.check_out
              ? (new Date(log.check_out).getTime() - new Date(log.check_in).getTime()) / 3_600_000
              : null);
            return (
              <TableRow key={log.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="bg-indigo-50 text-indigo-700 text-[10px]">
                        {(t?.full_name || '?').split(' ').map((n) => n[0]).slice(0, 2).join('')}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm">{t?.full_name || 'Unknown'}</span>
                  </div>
                </TableCell>
                <TableCell>{log.check_in ? format(new Date(log.check_in), 'dd MMM yyyy') : '—'}</TableCell>
                <TableCell>{log.check_in ? format(new Date(log.check_in), 'hh:mm a') : '—'}</TableCell>
                <TableCell>
                  {log.check_out
                    ? format(new Date(log.check_out), 'hh:mm a')
                    : <Badge variant="outline" className="text-amber-700 border-amber-300">Active</Badge>}
                </TableCell>
                <TableCell>{hrs != null ? `${Number(hrs).toFixed(1)}h` : '—'}</TableCell>
              </TableRow>
            );
          })}
          {logs.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="py-12 text-center text-slate-500">
                <Clock className="mx-auto h-10 w-10 opacity-40 mb-2" />
                No attendance records this month.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit drawer (with weekly-off duplicate guard)
// ---------------------------------------------------------------------------
function ShiftEditSheet({
  edit, onClose, onSave, saving,
}: {
  edit: EditState | null;
  onClose: () => void;
  onSave: (row: Partial<ShiftRow> & { user_id: string; weekday: number }) => void;
  saving: boolean;
}) {
  const existing = edit?.trainer.shifts[edit.weekday];
  const [morningStart, setMorningStart] = useState('');
  const [morningEnd, setMorningEnd] = useState('');
  const [eveningStart, setEveningStart] = useState('');
  const [eveningEnd, setEveningEnd] = useState('');
  const [off, setOff] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state whenever the edit target changes
  useMemo(() => {
    setMorningStart(fmtTime(existing?.morning_start ?? null) ?? '');
    setMorningEnd(fmtTime(existing?.morning_end ?? null) ?? '');
    setEveningStart(fmtTime(existing?.evening_start ?? null) ?? '');
    setEveningEnd(fmtTime(existing?.evening_end ?? null) ?? '');
    setOff(!!existing?.is_weekly_off);
    setError(null);
  }, [edit?.trainer.user_id, edit?.weekday, existing]);

  // Detect existing weekly-off on a different weekday
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

  const handleSave = () => {
    setError(null);
    if (!off) {
      const mFilled = !!morningStart || !!morningEnd;
      const eFilled = !!eveningStart || !!eveningEnd;
      if (mFilled && (!morningStart || !morningEnd)) { setError('Morning shift needs both start and end times.'); return; }
      if (eFilled && (!eveningStart || !eveningEnd)) { setError('Evening shift needs both start and end times.'); return; }
      if (!mFilled && !eFilled) { setError('Add at least one shift block or mark as weekly off.'); return; }
    }
    onSave({
      user_id: edit.trainer.user_id,
      weekday: edit.weekday,
      is_weekly_off: off,
      morning_start: off ? null : (morningStart || null),
      morning_end:   off ? null : (morningEnd || null),
      evening_start: off ? null : (eveningStart || null),
      evening_end:   off ? null : (eveningEnd || null),
    });
  };

  const dayName = WEEKDAYS.find((d) => d.idx === edit.weekday)?.full;

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit shift · {edit.trainer.full_name}</SheetTitle>
          <SheetDescription>{dayName} schedule. Leave a block empty to skip it.</SheetDescription>
        </SheetHeader>

        <div className="py-6 space-y-6">
          <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 px-4">
            <div>
              <Label htmlFor="off-toggle" className="font-medium">Weekly off</Label>
              <p className="text-xs text-slate-500">Marks this day as a rest day. Only one weekly-off allowed per trainer.</p>
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
                </div>
                <div>
                  <Label htmlFor="me" className="text-xs">End</Label>
                  <Input id="me" type="time" value={morningEnd} onChange={(e) => setMorningEnd(e.target.value)} />
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
                </div>
                <div>
                  <Label htmlFor="ee" className="text-xs">End</Label>
                  <Input id="ee" type="time" value={eveningEnd} onChange={(e) => setEveningEnd(e.target.value)} />
                </div>
              </div>
            </div>
          </fieldset>

          {error && <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}
        </div>

        <SheetFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save shift'}
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
            A branded PDF of this roster will be generated and sent as an attachment.
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
