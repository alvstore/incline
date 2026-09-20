import { useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { CalendarDays, Loader2, Sunrise, Sun, Sunset } from 'lucide-react';
import { toast } from 'sonner';
import { TrainerPicker } from '@/components/classes/TrainerPicker';
import { useTrainers } from '@/hooks/useTrainers';
import { useCreateClassTemplate, useUpdateClassTemplate } from '@/hooks/useClassTypes';
import {
  SHIFT_META, SHIFT_ORDER, WEEKDAYS, WEEKDAY_PRESETS, addDaysKey, formatTime12, istDateKey, labelForDateKey, nextOccurrences, shiftForTime,
} from '@/lib/classes/schedule';
import { cn } from '@/lib/utils';
import type { ClassShift, ClassTemplateRow, ClassTypeRow } from '@/types/classEngine';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string;
  classType: ClassTypeRow | null;
  template?: ClassTemplateRow | null;
  /** Pre-select a shift when opening from a "+ Morning rule" style button. */
  defaultShift?: ClassShift;
}

interface FormState {
  label: string;
  shift_type: ClassShift;
  start_time: string;
  duration_minutes: number;
  capacity: number;
  recurring_days: number[];
  trainer_id: string;
  external_trainer_name: string;
  venue: string;
  valid_from: string;
  valid_until: string;
  is_active: boolean;
}

const SHIFT_ICON: Record<ClassShift, typeof Sunrise> = { morning: Sunrise, afternoon: Sun, evening: Sunset };
const DEFAULT_START: Record<ClassShift, string> = { morning: '07:00', afternoon: '12:30', evening: '18:30' };

function emptyForm(shift: ClassShift, todayKey: string): FormState {
  return {
    label: '',
    shift_type: shift,
    start_time: DEFAULT_START[shift],
    duration_minutes: 60,
    capacity: 20,
    recurring_days: [1, 3, 5],
    trainer_id: '',
    external_trainer_name: '',
    venue: '',
    valid_from: todayKey,
    valid_until: '',
    is_active: true,
  };
}

/**
 * One schedule rule under a class type — e.g. "Morning batch · 7:00 AM ·
 * Mon/Wed/Fri · Ritesh". Saving generates the next 30 days of sessions
 * automatically; editing updates future sessions that were not hand-edited.
 */
export function ScheduleRuleDrawer({ open, onOpenChange, branchId, classType, template, defaultShift = 'morning' }: Props) {
  const isEdit = !!template;
  const todayKey = useMemo(() => istDateKey(new Date()), []);
  const [form, setForm] = useState<FormState>(() => emptyForm(defaultShift, todayKey));
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const { data: trainers } = useTrainers(branchId);
  const createTemplate = useCreateClassTemplate();
  const updateTemplate = useUpdateClassTemplate();
  const busy = createTemplate.isPending || updateTemplate.isPending;

  useEffect(() => {
    if (!open) return;
    if (template) {
      setForm({
        label: template.label ?? '',
        shift_type: template.shift_type,
        start_time: template.start_time.slice(0, 5),
        duration_minutes: template.duration_minutes,
        capacity: template.capacity,
        recurring_days: [...(template.recurring_days ?? [])],
        trainer_id: template.trainer_id ?? '',
        external_trainer_name: template.external_trainer_name ?? '',
        venue: template.venue ?? '',
        valid_from: template.valid_from,
        valid_until: template.valid_until ?? '',
        is_active: template.is_active,
      });
    } else {
      setForm(emptyForm(defaultShift, todayKey));
    }
    setErrors({});
  }, [open, template, defaultShift, todayKey]);

  const suggestedShift = shiftForTime(form.start_time);
  const shiftMismatch = suggestedShift !== form.shift_type;

  const preview = useMemo(
    () => nextOccurrences(form.recurring_days, form.valid_from < todayKey ? todayKey : form.valid_from, 5, form.valid_until || null),
    [form.recurring_days, form.valid_from, form.valid_until, todayKey],
  );

  const toggleDay = (d: number) => {
    setForm((f) => ({
      ...f,
      recurring_days: f.recurring_days.includes(d) ? f.recurring_days.filter((x) => x !== d) : [...f.recurring_days, d],
    }));
  };

  const validate = (): boolean => {
    const next: Partial<Record<keyof FormState, string>> = {};
    if (!/^\d{2}:\d{2}$/.test(form.start_time)) next.start_time = 'Pick a start time.';
    if (form.duration_minutes < 10 || form.duration_minutes > 480) next.duration_minutes = 'Between 10 and 480 minutes.';
    if (form.capacity < 1) next.capacity = 'At least 1 spot.';
    if (form.recurring_days.length === 0) next.recurring_days = 'Choose at least one weekday.';
    if (!form.valid_from) next.valid_from = 'Pick a start date.';
    if (form.valid_until && form.valid_until < form.valid_from) next.valid_until = 'End date must be after the start date.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!classType || !validate()) return;
    const guest = form.external_trainer_name.trim();
    const payload = {
      class_type_id: classType.id,
      branch_id: branchId,
      label: form.label.trim() || null,
      shift_type: form.shift_type,
      start_time: `${form.start_time}:00`,
      duration_minutes: form.duration_minutes,
      capacity: form.capacity,
      recurring_days: [...form.recurring_days].sort((a, b) => a - b),
      trainer_id: form.trainer_id || null,
      external_trainer_name: form.trainer_id ? null : guest || null,
      venue: form.venue.trim() || null,
      valid_from: form.valid_from,
      valid_until: form.valid_until || null,
      is_active: form.is_active,
    };
    try {
      if (isEdit && template) {
        await updateTemplate.mutateAsync({ id: template.id, updates: payload });
        toast.success('Schedule rule updated', { description: 'Future sessions were refreshed. Hand-edited sessions were left untouched.' });
      } else {
        await createTemplate.mutateAsync(payload);
        toast.success(`${classType.name} · ${SHIFT_META[form.shift_type].label} rule added`, {
          description: 'Sessions for the next 30 days are now on the calendar.',
        });
      }
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      toast.error(isEdit ? 'Could not update rule' : 'Could not add rule', { description: msg });
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-6 py-5 text-left">
          <SheetTitle>{isEdit ? 'Edit schedule rule' : 'Add schedule rule'}</SheetTitle>
          <SheetDescription>
            {classType ? <><span className="font-medium text-foreground">{classType.name}</span> · sessions are generated 30 days ahead and kept in sync with this rule.</> : 'Pick a class first.'}
          </SheetDescription>
        </SheetHeader>

        <form id="schedule-rule-form" onSubmit={handleSubmit} className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {/* Shift */}
          <div className="space-y-2">
            <Label>Batch</Label>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Batch">
              {SHIFT_ORDER.map((shift) => {
                const Icon = SHIFT_ICON[shift];
                const active = form.shift_type === shift;
                return (
                  <button
                    key={shift}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setForm((f) => ({ ...f, shift_type: shift, start_time: f.start_time === DEFAULT_START[f.shift_type] ? DEFAULT_START[shift] : f.start_time }))}
                    className={cn(
                      'flex min-h-[64px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border p-2 text-xs font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary',
                      active ? 'border-primary bg-primary/5 text-primary shadow-sm' : 'text-muted-foreground hover:bg-muted/60',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {SHIFT_META[shift].label}
                    <span className="text-[10px] font-normal opacity-70">{SHIFT_META[shift].window}</span>
                  </button>
                );
              })}
            </div>
            {shiftMismatch && (
              <p className="text-xs text-warning">
                {formatTime12(form.start_time)} usually counts as {SHIFT_META[suggestedShift].label.toLowerCase()} — members will still see it under {SHIFT_META[form.shift_type].label}.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="rule-label">Rule name <span className="text-muted-foreground">(optional)</span></Label>
            <Input id="rule-label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder={`${SHIFT_META[form.shift_type].label} batch`} maxLength={60} />
          </div>

          {/* Time / duration / capacity */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="rule-start">Start time <span className="text-destructive">*</span></Label>
              <Input id="rule-start" type="time" step={300} value={form.start_time} aria-invalid={!!errors.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
              {errors.start_time && <p className="text-xs text-destructive">{errors.start_time}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-duration">Minutes</Label>
              <Input id="rule-duration" type="number" min={10} max={480} step={5} value={form.duration_minutes} aria-invalid={!!errors.duration_minutes}
                onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })} />
              {errors.duration_minutes && <p className="text-xs text-destructive">{errors.duration_minutes}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-capacity">Capacity</Label>
              <Input id="rule-capacity" type="number" min={1} max={500} value={form.capacity} aria-invalid={!!errors.capacity}
                onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} />
              {errors.capacity && <p className="text-xs text-destructive">{errors.capacity}</p>}
            </div>
          </div>

          {/* Days */}
          <div className="space-y-2">
            <Label>Repeats on <span className="text-destructive">*</span></Label>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Weekdays">
              {WEEKDAYS.map((d) => {
                const on = form.recurring_days.includes(d.value);
                return (
                  <button
                    key={d.value}
                    type="button"
                    aria-pressed={on}
                    aria-label={d.label}
                    onClick={() => toggleDay(d.value)}
                    className={cn(
                      'h-10 min-w-[44px] cursor-pointer rounded-full border px-3 text-xs font-semibold transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-primary',
                      on ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted/60',
                    )}
                  >
                    {d.short}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_PRESETS.map((p) => (
                <Button key={p.label} type="button" variant="ghost" size="sm" className="h-7 cursor-pointer px-2 text-xs"
                  onClick={() => setForm({ ...form, recurring_days: p.days })}>
                  {p.label}
                </Button>
              ))}
            </div>
            {errors.recurring_days && <p className="text-xs text-destructive">{errors.recurring_days}</p>}
          </div>

          <TrainerPicker
            trainers={trainers}
            trainerId={form.trainer_id}
            guestName={form.external_trainer_name}
            onChange={({ trainerId, guestName }) => setForm({ ...form, trainer_id: trainerId, external_trainer_name: guestName })}
          />

          <div className="space-y-2">
            <Label htmlFor="rule-venue">Studio / venue</Label>
            <Input id="rule-venue" value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })}
              placeholder={classType?.default_venue ? `Default: ${classType.default_venue}` : 'Studio 1'} />
          </div>

          {/* Validity */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="rule-from">Starts from</Label>
              <Input id="rule-from" type="date" value={form.valid_from} aria-invalid={!!errors.valid_from}
                onChange={(e) => setForm({ ...form, valid_from: e.target.value })} />
              {errors.valid_from && <p className="text-xs text-destructive">{errors.valid_from}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-until">Ends on <span className="text-muted-foreground">(optional)</span></Label>
              <Input id="rule-until" type="date" value={form.valid_until} min={form.valid_from} aria-invalid={!!errors.valid_until}
                onChange={(e) => setForm({ ...form, valid_until: e.target.value })} />
              {errors.valid_until && <p className="text-xs text-destructive">{errors.valid_until}</p>}
            </div>
          </div>

          {/* Preview */}
          <div className="rounded-xl bg-muted/50 p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" /> Next sessions
            </div>
            {preview.length === 0 ? (
              <p className="text-sm text-muted-foreground">Pick weekdays to preview the first sessions.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {preview.map((k) => (
                  <Badge key={k} variant="secondary" className="rounded-full font-normal">
                    {labelForDateKey(k, todayKey)} · {formatTime12(form.start_time)}
                  </Badge>
                ))}
                {preview.length === 5 && <Badge variant="outline" className="rounded-full font-normal">…and on, 30 days ahead</Badge>}
              </div>
            )}
            {form.valid_from > addDaysKey(todayKey, 30) && (
              <p className="mt-2 text-xs text-muted-foreground">Sessions appear once the start date is within the 30-day window.</p>
            )}
          </div>

          {isEdit && (
            <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
              <div>
                <Label htmlFor="rule-active" className="text-sm">Rule is active</Label>
                <p className="text-xs text-muted-foreground">Pausing removes unbooked future sessions; booked ones stay until you cancel them.</p>
              </div>
              <Switch id="rule-active" checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
            </div>
          )}
        </form>

        <SheetFooter className="flex-row justify-end gap-2 border-t px-6 py-4">
          <Button type="button" variant="outline" className="cursor-pointer" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button type="submit" form="schedule-rule-form" className="cursor-pointer" disabled={busy || !classType}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? 'Save rule' : 'Add rule & generate sessions'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
