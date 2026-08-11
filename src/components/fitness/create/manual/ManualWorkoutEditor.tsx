import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getPlanTemplate, updatePlanTemplate } from '@/services/fitnessService';
import type { WorkoutPlanContent } from '@/types/fitnessPlan';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, Trash2, Dumbbell, GripVertical, ChevronDown, CalendarDays, Copy, AlertCircle } from 'lucide-react';

import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { DayRail } from '@/components/fitness/create/DayRail';
import { PlanStatCard } from '@/components/fitness/create/PlanStatCard';
import { MemberSearchPicker, PickedMember } from '@/components/fitness/create/MemberSearchPicker';
import { newDraftId, saveDraft, loadDraft } from '@/lib/planDraft';
import { VideoAttachmentControl } from '@/components/fitness/VideoAttachmentControl';

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface Exercise {
  name: string;
  equipment: string;
  sets: number;
  reps: string;
  rest_seconds: number;
  weight: string;
  form_tips: string;
  video_url?: string;
  video_file_path?: string;
}

interface Day {
  day: string;
  focus: string;
  warmup: string;
  cooldown: string;
  exercises: Exercise[];
}

const DEFAULT_DAYS: Day[] = [
  { day: 'Monday', focus: 'Upper Body', warmup: '', cooldown: '', exercises: [] },
  { day: 'Tuesday', focus: 'Lower Body', warmup: '', cooldown: '', exercises: [] },
  { day: 'Wednesday', focus: 'Rest', warmup: '', cooldown: '', exercises: [] },
  { day: 'Thursday', focus: 'Push', warmup: '', cooldown: '', exercises: [] },
  { day: 'Friday', focus: 'Pull', warmup: '', cooldown: '', exercises: [] },
  { day: 'Saturday', focus: 'Legs / Cardio', warmup: '', cooldown: '', exercises: [] },
  { day: 'Sunday', focus: 'Rest', warmup: '', cooldown: '', exercises: [] },
];

const EMPTY_EXERCISE: Exercise = { name: '', equipment: '', sets: 3, reps: '12', rest_seconds: 60, weight: '', form_tips: '' };

/** Normalise one stored exercise (template/draft JSON) into the editor shape. */
function toEditorExercise(ex: any): Exercise {
  const restRaw = ex?.rest;
  const restNum = typeof restRaw === 'number'
    ? restRaw
    : typeof restRaw === 'string'
      ? parseInt(restRaw.replace(/\D/g, ''), 10) || 60
      : (typeof ex?.rest_seconds === 'number' ? ex.rest_seconds : 60);
  const tips = ex?.form_tips ?? ex?.notes ?? '';
  return {
    name: ex?.name || '',
    equipment: ex?.equipment || '',
    sets: ex?.sets ?? 3,
    reps: String(ex?.reps ?? '12'),
    rest_seconds: restNum,
    weight: ex?.weight || '',
    form_tips: Array.isArray(tips) ? tips.filter(Boolean).join('\n') : String(tips || ''),
    video_url: ex?.video_url,
    video_file_path: ex?.video_file_path,
  };
}

const WARMUP_RE = /^(warm[\s-]?up|warmup)$/i;
const COOLDOWN_RE = /^(cool[\s-]?down|cooldown|stretch(ing)?)$/i;

/**
 * Legacy lift: older plans encoded warm-up / cool-down as fake exercises.
 * Move them into the dedicated day fields so the PDF renders them properly.
 */
function toEditorDay(d: any): Day {
  const exercises: Exercise[] = (d?.exercises || []).map(toEditorExercise);
  let warmup = d?.warmup ? String(d.warmup) : '';
  let cooldown = d?.cooldown ? String(d.cooldown) : '';

  if (!warmup && exercises.length && WARMUP_RE.test(exercises[0].name.trim())) {
    warmup = exercises[0].form_tips || exercises[0].name;
    exercises.shift();
  }
  const last = exercises[exercises.length - 1];
  if (!cooldown && last && COOLDOWN_RE.test(last.name.trim())) {
    cooldown = last.form_tips || last.name;
    exercises.pop();
  }

  return {
    day: d?.day || '',
    focus: d?.focus || '',
    warmup,
    cooldown,
    exercises,
  };
}


interface SortableExerciseRowProps {
  id: string;
  ex: Exercise;
  exIdx: number;
  onUpdate: (exIdx: number, field: keyof Exercise, value: any) => void;
  onRemove: (exIdx: number) => void;
  onVideoChange: (next: { video_url?: string; video_file_path?: string }) => void;
}

function SortableExerciseRow({ id, ex, exIdx, onUpdate, onRemove, onVideoChange }: SortableExerciseRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const [open, setOpen] = useState(!!(ex.form_tips || ex.equipment || ex.video_url || ex.video_file_path));
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : 'auto',
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-2xl border bg-card p-3 shadow-sm transition-shadow duration-200 hover:shadow-md"
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label="Drag to reorder"
          className="mt-7 shrink-0 cursor-grab touch-none p-2 text-muted-foreground transition-colors hover:text-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-12 sm:col-span-5">
              <Label className="text-xs">Exercise *</Label>
              <Input value={ex.name} onChange={(e) => onUpdate(exIdx, 'name', e.target.value)} placeholder="Bench Press" />
            </div>
            <div className="col-span-3 sm:col-span-2">
              <Label className="text-xs">Sets</Label>
              <Input type="number" min={1} value={ex.sets} onChange={(e) => onUpdate(exIdx, 'sets', parseInt(e.target.value) || 1)} />
            </div>
            <div className="col-span-3 sm:col-span-2">
              <Label className="text-xs">Reps</Label>
              <Input value={ex.reps} onChange={(e) => onUpdate(exIdx, 'reps', e.target.value)} placeholder="8-10" />
            </div>
            <div className="col-span-3 sm:col-span-2">
              <Label className="text-xs">Rest (s)</Label>
              <Input type="number" min={0} value={ex.rest_seconds} onChange={(e) => onUpdate(exIdx, 'rest_seconds', parseInt(e.target.value) || 0)} />
            </div>
            <div className="col-span-3 sm:col-span-1">
              <Label className="text-xs">Weight</Label>
              <Input value={ex.weight} onChange={(e) => onUpdate(exIdx, 'weight', e.target.value)} placeholder="60kg" />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 cursor-pointer gap-1 px-2 text-xs text-muted-foreground"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
            >
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', open && 'rotate-180')} />
              {open ? 'Hide details' : 'Equipment, form tips & video'}
            </Button>
          </div>

          {open && (
            <div className="space-y-2 border-t pt-2">
              <div>
                <Label className="text-xs">Equipment / Machine</Label>
                <Input
                  value={ex.equipment}
                  onChange={(e) => onUpdate(exIdx, 'equipment', e.target.value)}
                  placeholder="e.g. Flat bench press machine, Smith machine, Cable stack"
                />
              </div>
              <div>
                <Label className="text-xs">Form Tips</Label>
                <Textarea
                  rows={2}
                  value={ex.form_tips}
                  onChange={(e) => onUpdate(exIdx, 'form_tips', e.target.value)}
                  placeholder="Cues for proper form, breathing, tempo… (one cue per line)"
                />
              </div>
              <VideoAttachmentControl
                folder="exercises"
                label="Demo video (URL or upload)"
                value={{ video_url: ex.video_url, video_file_path: ex.video_file_path }}
                onChange={onVideoChange}
              />
            </div>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="mt-6 h-9 w-9 shrink-0 cursor-pointer text-destructive"
          onClick={() => onRemove(exIdx)}
          aria-label="Remove exercise"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}


export interface ManualEditorRef {
  canSubmit: boolean;
  submit: () => void;
}

interface ManualWorkoutEditorProps {
  onMetaChange?: (meta: { canSubmit: boolean; submit: () => void; primaryLabel: string; dirty: boolean; saving: boolean }) => void;
}

export default function ManualWorkoutEditor({ onMetaChange }: ManualWorkoutEditorProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const templateId = searchParams.get('template');
  const editMode = searchParams.get('edit') === '1' && !!templateId;
  const draftId = searchParams.get('draft');

  const [planName, setPlanName] = useState('');
  const [description, setDescription] = useState('');
  const [difficulty, setDifficulty] = useState('intermediate');
  const [goal, setGoal] = useState('General Fitness');
  // Pre-selected on the create landing page and carried through the URL.
  const prefillMemberId = searchParams.get('memberId');
  const [member, setMember] = useState<PickedMember | null>(
    prefillMemberId
      ? {
          id: prefillMemberId,
          full_name: searchParams.get('memberName') || '',
          member_code: searchParams.get('memberCode') || '',
        }
      : null,
  );

  const [days, setDays] = useState<Day[]>(DEFAULT_DAYS);
  const [activeIdx, setActiveIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const dirtySeedRef = useRef(false);

  useEffect(() => {
    if (!dirtySeedRef.current) { dirtySeedRef.current = true; return; }
    setDirty(true);
  }, [days, planName, description, difficulty, goal]);

  useEffect(() => {
    if (!draftId) return;
    const d = loadDraft(draftId);
    if (!d) {
      toast.error('Draft not found — it may have expired this session');
      return;
    }
    setPlanName(d.name || '');
    setDescription(d.description || '');
    if (d.difficulty) setDifficulty(d.difficulty);
    if (d.goal) setGoal(d.goal);
    if (d.memberId) {
      setMember({ id: d.memberId, full_name: d.memberName || '', member_code: d.memberCode || '' } as PickedMember);
    }
    const content: any = d.content || {};
    const draftDays: any[] = content?.weeks?.[0]?.days || content?.days || [];
    if (draftDays.length) {
      setDays(draftDays.map(toEditorDay));
    }

  }, [draftId]);

  useEffect(() => {
    if (!templateId) return;
    let cancelled = false;
    (async () => {
      try {
        const tpl = await getPlanTemplate(templateId);
        if (cancelled) return;
        if (!tpl) { toast.error('Template not found'); return; }
        if (tpl.type !== 'workout') {
          toast.error('That template is a diet plan — opening the diet builder instead');
          navigate(`/fitness/create/manual?type=diet&template=${templateId}${editMode ? '&edit=1' : ''}`, { replace: true });
          return;
        }
        setPlanName(tpl.name);
        setDescription(tpl.description || '');
        if (tpl.difficulty) setDifficulty(tpl.difficulty);
        if (tpl.goal) setGoal(tpl.goal);
        const content: any = tpl.content || {};
        const tplDays: any[] = content?.weeks?.[0]?.days || [];
        if (tplDays.length) {
          setDays(tplDays.map(toEditorDay));
        }

        toast.success(`Loaded template: ${tpl.name}`);
      } catch (err: any) {
        toast.error(err?.message || 'Failed to load template');
      }
    })();
    return () => { cancelled = true; };
  }, [templateId, navigate, editMode]);

  const updateDay = (idx: number, patch: Partial<Day>) =>
    setDays(prev => prev.map((d, i) => i === idx ? { ...d, ...patch } : d));

  const addExercise = () =>
    updateDay(activeIdx, { exercises: [...days[activeIdx].exercises, { ...EMPTY_EXERCISE }] });

  const updateExercise = (exIdx: number, field: keyof Exercise, value: any) => {
    const next = days[activeIdx].exercises.map((ex, i) => i === exIdx ? { ...ex, [field]: value } : ex);
    updateDay(activeIdx, { exercises: next });
  };

  const removeExercise = (exIdx: number) =>
    updateDay(activeIdx, { exercises: days[activeIdx].exercises.filter((_, i) => i !== exIdx) });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleExerciseDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const list = days[activeIdx].exercises;
    const oldIdx = Number(active.id);
    const newIdx = Number(over.id);
    if (Number.isNaN(oldIdx) || Number.isNaN(newIdx)) return;
    updateDay(activeIdx, { exercises: arrayMove(list, oldIdx, newIdx) });
  };

  const totalExercises = days.reduce((s, d) => s + d.exercises.length, 0);

  const buildContent = (): WorkoutPlanContent => ({
    name: planName,
    type: 'workout' as const,
    difficulty,
    goal,
    description,
    weeks: [{
      week: 1,
      days: days
        .filter(d => d.exercises.length > 0 || d.warmup.trim() || d.cooldown.trim())
        .map(d => ({
          day: d.day,
          focus: d.focus,
          warmup: d.warmup.trim() || undefined,
          cooldown: d.cooldown.trim() || undefined,
          exercises: d.exercises.map(ex => ({
            name: ex.name,
            equipment: ex.equipment || undefined,
            sets: ex.sets,
            reps: ex.reps,
            rest: `${ex.rest_seconds}s`,
            weight: ex.weight || undefined,
            form_tips: ex.form_tips || undefined,
            notes: ex.form_tips || undefined,
            video_url: ex.video_url || undefined,
            video_file_path: ex.video_file_path || undefined,
          })),
        })),

    }],
  });

  const validate = (): string | null => {
    if (!planName.trim()) return 'Plan name is required';
    if (totalExercises === 0) return 'Add at least one exercise';
    return null;
  };

  const failValidation = (err: string) => {
    setValidationError(err);
    toast.error(err);
  };

  const handleSaveTemplate = useCallback(async () => {
    const err = validate();
    if (err) { failValidation(err); return; }
    setValidationError(null);
    if (!templateId) return;
    setSaving(true);
    try {
      await updatePlanTemplate(templateId, {
        name: planName.trim(),
        description: description.trim() || null,
        difficulty: difficulty || null,
        goal: goal || null,
        content: buildContent(),
      });
      queryClient.invalidateQueries({ queryKey: ['fitness-templates'] });
      queryClient.invalidateQueries({ queryKey: ['fitness-template-usage'] });
      toast.success('Template updated');
      setDirty(false);
      navigate('/fitness/templates');
    } catch (err2: any) {
      toast.error(err2?.message || 'Failed to update template');
    } finally {
      setSaving(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planName, description, difficulty, goal, totalExercises, templateId, navigate, queryClient, days]);

  const handlePreview = useCallback(() => {
    const err = validate();
    if (err) { failValidation(err); return; }
    setValidationError(null);

    const id = draftId || newDraftId();
    const existing = draftId ? loadDraft(draftId) : null;
    const ok = saveDraft({
      ...(existing || ({} as any)),
      id,
      source: existing?.source || 'manual-workout',
      templateId: existing?.templateId || templateId || undefined,
      type: 'workout',
      name: planName,
      description,
      goal,
      difficulty,
      memberId: existing?.memberId || member?.id,
      memberName: existing?.memberName || member?.full_name,
      memberCode: existing?.memberCode || member?.member_code,
      memberProfile: existing?.memberProfile,
      content: buildContent(),
      createdAt: existing?.createdAt || new Date().toISOString(),
    });

    if (!ok) {
      toast.error('Could not save this draft in the browser — please retry');
      return;
    }
    setDirty(false);
    navigate(`/fitness/preview/${id}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planName, description, difficulty, goal, totalExercises, draftId, templateId, member, navigate, days]);

  const canSubmit = !saving;
  const submit = useMemo(
    () => (editMode ? handleSaveTemplate : handlePreview),
    [editMode, handleSaveTemplate, handlePreview],
  );
  const primaryLabel = useMemo(
    () => (saving ? 'Saving…' : editMode ? 'Save Template' : draftId ? 'Save & Back to Preview' : 'Continue to Preview'),
    [editMode, draftId, saving],
  );

  useEffect(() => {
    onMetaChange?.({ canSubmit, submit, primaryLabel, dirty, saving });
  }, [canSubmit, submit, primaryLabel, dirty, saving, onMetaChange]);


  const activeDays = days.filter((d) => d.exercises.length > 0).length;
  const totalSets = days.reduce((s, d) => s + d.exercises.reduce((n, e) => n + (Number(e.sets) || 0), 0), 0);

  const copyDayTo = (targets: number[]) => {
    const source = days[activeIdx];
    if (!source) return;
    setDays((prev) =>
      prev.map((d, i) =>
        targets.includes(i)
          ? { ...d, focus: source.focus, warmup: source.warmup, cooldown: source.cooldown, exercises: source.exercises.map((e) => ({ ...e })) }
          : d,
      ),
    );
    toast.success(targets.length > 1 ? 'Copied to all other days' : 'Day copied');
  };

  /**
   * Move a whole session (focus, warm-up, exercises, cool-down) onto another
   * weekday. Day names stay fixed — only the content moves. When the target
   * already has content the two days swap so nothing is lost.
   */
  const moveDayContent = (from: number, to: number) => {
    if (from === to) return;
    setDays((prev) => {
      const src = prev[from];
      const dst = prev[to];
      if (!src || !dst) return prev;
      const pick = (d: typeof src) => ({
        focus: d.focus,
        warmup: d.warmup,
        cooldown: d.cooldown,
        exercises: d.exercises.map((e) => ({ ...e })),
      });
      return prev.map((d, i) => {
        if (i === to) return { ...d, ...pick(src) };
        if (i === from) return { ...d, ...pick(dst) };
        return d;
      });
    });
    setActiveIdx(to);
    const swapped = days[to]?.exercises.length > 0;
    toast.success(
      swapped
        ? `Swapped ${days[from].day} and ${days[to].day}`
        : `Moved ${days[from].day} workout to ${days[to].day}`,
    );
  };

  const clearDay = () => {
    updateDay(activeIdx, { exercises: [], warmup: '', cooldown: '' });
    toast.success(`${days[activeIdx].day} cleared`);
  };


  const active = days[activeIdx];

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      {/* Left: plan details + day rail */}
      <div className="space-y-4 lg:col-span-3">
        {validationError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-2xl bg-destructive/10 p-3 text-sm font-medium text-destructive"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{validationError}</span>
          </div>
        )}
        <Card className="rounded-2xl border-0 shadow-md shadow-muted-foreground/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Plan Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="wk-name">Plan Name *</Label>
              <Input id="wk-name" value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="e.g. Push/Pull/Legs Hypertrophy" />
            </div>
            <div className="space-y-1.5">
              <Label>Goal</Label>
              <Select value={goal} onValueChange={setGoal}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Weight Loss">Weight Loss</SelectItem>
                  <SelectItem value="Muscle Gain">Muscle Gain</SelectItem>
                  <SelectItem value="General Fitness">General Fitness</SelectItem>
                  <SelectItem value="Endurance">Endurance</SelectItem>
                  <SelectItem value="Flexibility">Flexibility</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Difficulty</Label>
              <Select value={difficulty} onValueChange={setDifficulty}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="beginner">Beginner</SelectItem>
                  <SelectItem value="intermediate">Intermediate</SelectItem>
                  <SelectItem value="advanced">Advanced</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wk-desc">Description</Label>
              <Input id="wk-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short summary" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-0 shadow-md shadow-muted-foreground/10">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              <CalendarDays className="h-4 w-4" /> Week
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DayRail
              ariaLabel="Select training day"
              activeIndex={activeIdx}
              onSelect={setActiveIdx}
              onMove={moveDayContent}
              days={days.map((d) => ({
                label: d.day,
                meta: d.exercises.length ? `${d.exercises.length} exercises` : 'Rest / empty',
                muted: d.exercises.length === 0,
              }))}
            />
            <p className="mt-2 text-[11px] text-muted-foreground">
              Drag a day onto another to move that workout — day names stay put, only the session moves.
            </p>

          </CardContent>
        </Card>
      </div>

      {/* Middle: the day workbench */}
      <div className="space-y-4 lg:col-span-6">
        <Card className="rounded-2xl border-0 shadow-md shadow-muted-foreground/10">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Dumbbell className="h-4 w-4 text-primary" /> {active.day}
                <Badge variant="secondary" className="rounded-full text-[11px]">
                  {active.exercises.length} exercises
                </Badge>
              </CardTitle>
              <div className="flex items-center gap-1.5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-9 cursor-pointer gap-1">
                      <Copy className="h-3.5 w-3.5" /> Copy day
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => copyDayTo(days.map((_, i) => i).filter((i) => i !== activeIdx))}>
                      Copy to all other days
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {days.map((d, i) =>
                      i === activeIdx ? null : (
                        <DropdownMenuItem key={d.day + i} onClick={() => copyDayTo([i])}>
                          Copy to {d.day}
                        </DropdownMenuItem>
                      ),
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-9 cursor-pointer gap-1">
                      <ArrowRightLeft className="h-3.5 w-3.5" /> Move day
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {days.map((d, i) =>
                      i === activeIdx ? null : (
                        <DropdownMenuItem key={`mv-${d.day}-${i}`} onClick={() => moveDayContent(activeIdx, i)}>
                          Move to {d.day}
                          {d.exercises.length > 0 && (
                            <span className="ml-2 text-[11px] text-muted-foreground">swap</span>
                          )}
                        </DropdownMenuItem>
                      ),
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 cursor-pointer text-muted-foreground"
                  onClick={clearDay}
                >
                  Clear
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="wk-focus">Focus</Label>
              <Input
                id="wk-focus"
                placeholder="Focus (e.g. Chest & Triceps)"
                value={active.focus}
                onChange={(e) => updateDay(activeIdx, { focus: e.target.value })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Warm-up</Label>
                <Textarea
                  rows={2}
                  placeholder="e.g. 5 min treadmill walk, shoulder dislocates x15, band pull-aparts x20"
                  value={active.warmup}
                  onChange={(e) => updateDay(activeIdx, { warmup: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Cool-down</Label>
                <Textarea
                  rows={2}
                  placeholder="e.g. 5 min easy cycle, chest & lat stretch 30s each side"
                  value={active.cooldown}
                  onChange={(e) => updateDay(activeIdx, { cooldown: e.target.value })}
                />
              </div>
            </div>

            {active.exercises.length === 0 && (
              <div className="rounded-2xl border border-dashed p-6 text-center">
                <Dumbbell className="mx-auto h-6 w-6 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium">No exercises on {active.day}</p>
                <p className="text-xs text-muted-foreground">Add one below, or leave this day as rest.</p>
              </div>
            )}

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleExerciseDragEnd}>
              <SortableContext
                items={active.exercises.map((_, i) => String(i))}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {active.exercises.map((ex, exIdx) => (
                    <SortableExerciseRow
                      key={exIdx}
                      id={String(exIdx)}
                      ex={ex}
                      exIdx={exIdx}
                      onUpdate={updateExercise}
                      onRemove={removeExercise}
                      onVideoChange={(next) => {
                        const updated = active.exercises.map((e, i) =>
                          i === exIdx ? { ...e, video_url: next.video_url, video_file_path: next.video_file_path } : e,
                        );
                        updateDay(activeIdx, { exercises: updated });
                      }}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            <Button variant="outline" className="w-full cursor-pointer border-dashed" onClick={addExercise}>
              <Plus className="mr-1 h-4 w-4" /> Add Exercise
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Right: insight panel */}
      <div className="space-y-4 self-start lg:col-span-3 lg:sticky lg:top-40">
        <PlanStatCard
          label="Total exercises"
          value={totalExercises}
          hint={`across ${activeDays} active ${activeDays === 1 ? 'day' : 'days'}`}
          icon={<Dumbbell className="h-4 w-4" />}
          tone="primary"
        />
        <PlanStatCard label="Weekly sets" value={totalSets} hint="Sum of all sets in the week" />
        <Card className="rounded-2xl border-0 shadow-md shadow-muted-foreground/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Optional: Pre-Assign Member
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MemberSearchPicker value={member} onChange={setMember} label="Member" />
            <p className="mt-2 text-xs text-muted-foreground">You can also assign on the next step.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

