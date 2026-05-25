import { useState, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useBranchContext } from '@/contexts/BranchContext';
import {
  useStaffSchedules, useUpsertShift, useDeleteShift,
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
import {
  Tabs, TabsList, TabsTrigger,
} from '@/components/ui/tabs';
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from '@/components/ui/table';
import { Pencil, Trash2, Sun, Moon, Calendar as CalIcon, AlertCircle } from 'lucide-react';

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

function ShiftPill({ start, end, tone }: { start: string | null; end: string | null; tone: 'morning' | 'evening' }) {
  if (!start || !end) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const overnight = end < start;
  const baseCls =
    overnight
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

interface EditState {
  trainer: TrainerRosterRow;
  weekday: number;
}

export default function StaffRoster() {
  const { effectiveBranchId, currentBranchName } = useBranchContext();
  const branchId = effectiveBranchId;
  const { data, isLoading, isError, error } = useStaffSchedules(branchId);
  const upsert = useUpsertShift(branchId);
  const del = useDeleteShift(branchId);

  const today = new Date().getDay();
  const [weekday, setWeekday] = useState<number>(today);
  const [edit, setEdit] = useState<EditState | null>(null);

  const rows = useMemo(() => data ?? [], [data]);

  return (
    <AppLayout>
      <div className="space-y-6">
        <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Staff Roster</h1>
            <p className="text-sm text-slate-500">
              Split-shift scheduling for trainers · {currentBranchName || 'No branch selected'}
            </p>
          </div>
          <Tabs value={String(weekday)} onValueChange={(v) => setWeekday(Number(v))}>
            <TabsList>
              {WEEKDAYS.map((d) => (
                <TabsTrigger key={d.idx} value={String(d.idx)}>{d.short}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </header>

        <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <CalIcon className="h-5 w-5 text-indigo-600" />
              {WEEKDAYS.find((d) => d.idx === weekday)?.full} schedule
            </CardTitle>
            <Badge variant="outline" className="rounded-full">
              {rows.length} {rows.length === 1 ? 'trainer' : 'trainers'}
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
            {!isLoading && !isError && rows.length === 0 && (
              <div className="p-12 flex flex-col items-center text-center gap-2">
                <CalIcon className="h-10 w-10 text-slate-300" />
                <p className="text-sm font-medium text-slate-700">No trainers in this branch yet</p>
                <p className="text-xs text-slate-500">Add trainers from the Trainers page to start building the roster.</p>
              </div>
            )}
            {!isLoading && !isError && rows.length > 0 && (
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
                  {rows.map((t) => {
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
                          {off ? (
                            <Badge className="bg-slate-100 text-slate-600 rounded-full">Off</Badge>
                          ) : s ? (
                            <Badge className="bg-emerald-100 text-emerald-700 rounded-full">Scheduled</Badge>
                          ) : (
                            <Badge variant="outline" className="rounded-full text-slate-500">Unscheduled</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex gap-1">
                            <Button
                              size="sm" variant="ghost" className="h-8 w-8 p-0"
                              onClick={() => setEdit({ trainer: t, weekday })}
                              aria-label="Edit shift"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {s?.id && (
                              <Button
                                size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                                onClick={() => del.mutate({ userId: t.user_id, weekday })}
                                aria-label="Delete shift"
                              >
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
            )}
          </CardContent>
        </Card>
      </div>

      <ShiftEditSheet
        edit={edit}
        onClose={() => setEdit(null)}
        onSave={(payload) => {
          upsert.mutate(payload, {
            onSuccess: () => setEdit(null),
          });
        }}
        saving={upsert.isPending}
      />
    </AppLayout>
  );
}

// ---------------------------------------------------------------------------
// Edit drawer
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

  const open = !!edit;
  if (!edit) return (
    <Sheet open={false} onOpenChange={() => onClose()}>
      <SheetContent />
    </Sheet>
  );

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
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit shift · {edit.trainer.full_name}</SheetTitle>
          <SheetDescription>{dayName} schedule. Leave a block empty to skip it.</SheetDescription>
        </SheetHeader>

        <div className="py-6 space-y-6">
          <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 px-4">
            <div>
              <Label htmlFor="off-toggle" className="font-medium">Weekly off</Label>
              <p className="text-xs text-slate-500">Marks this day as a rest day.</p>
            </div>
            <Switch id="off-toggle" checked={off} onCheckedChange={setOff} />
          </div>

          <fieldset disabled={off} className="space-y-4 disabled:opacity-50">
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/30 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Sun className="h-4 w-4 text-emerald-600" />
                <span className="font-semibold text-sm text-emerald-900">Morning block</span>
                {(morningStart || morningEnd) && (
                  <Button
                    size="sm" variant="ghost" className="ml-auto h-7 text-xs"
                    onClick={() => { setMorningStart(''); setMorningEnd(''); }}
                  >Clear</Button>
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
                  <Button
                    size="sm" variant="ghost" className="ml-auto h-7 text-xs"
                    onClick={() => { setEveningStart(''); setEveningEnd(''); }}
                  >Clear</Button>
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

          {error && (
            <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>
          )}
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
