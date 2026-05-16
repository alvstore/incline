import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { Plus, Trash2, Dumbbell, GripVertical } from 'lucide-react';
import { toast } from 'sonner';
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
  exercises: Exercise[];
}

const DEFAULT_DAYS: Day[] = [
  { day: 'Monday', focus: 'Upper Body', exercises: [] },
  { day: 'Tuesday', focus: 'Lower Body', exercises: [] },
  { day: 'Wednesday', focus: 'Rest', exercises: [] },
  { day: 'Thursday', focus: 'Push', exercises: [] },
  { day: 'Friday', focus: 'Pull', exercises: [] },
  { day: 'Saturday', focus: 'Legs / Cardio', exercises: [] },
  { day: 'Sunday', focus: 'Rest', exercises: [] },
];

const EMPTY_EXERCISE: Exercise = { name: '', sets: 3, reps: '12', rest_seconds: 60, weight: '', form_tips: '' };

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
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : 'auto',
  };
  return (
    <div ref={setNodeRef} style={style} className="rounded-md border bg-background p-3 space-y-2">
      <div className="grid gap-2 grid-cols-12">
        <div className="col-span-12 sm:col-span-1 flex items-end justify-center">
          <button
            type="button"
            aria-label="Drag to reorder"
            className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-2 -m-2 touch-none"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        </div>
        <div className="col-span-12 sm:col-span-3">
          <Label className="text-xs">Exercise *</Label>
          <Input value={ex.name} onChange={(e) => onUpdate(exIdx, 'name', e.target.value)} placeholder="Bench Press" />
        </div>
        <div className="col-span-3 sm:col-span-1">
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
        <div className="col-span-3 sm:col-span-2">
          <Label className="text-xs">Weight</Label>
          <Input value={ex.weight} onChange={(e) => onUpdate(exIdx, 'weight', e.target.value)} placeholder="60kg" />
        </div>
        <div className="col-span-12 sm:col-span-1 flex sm:items-end">
          <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive ml-auto" onClick={() => onRemove(exIdx)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div>
        <Label className="text-xs">Form Tips</Label>
        <Textarea
          rows={2}
          value={ex.form_tips}
          onChange={(e) => onUpdate(exIdx, 'form_tips', e.target.value)}
          placeholder="Cues for proper form, breathing, tempo…"
        />
      </div>
      <VideoAttachmentControl
        folder="exercises"
        label="Demo video (URL or upload)"
        value={{ video_url: ex.video_url, video_file_path: ex.video_file_path }}
        onChange={onVideoChange}
      />
    </div>
  );
}

export interface ManualEditorRef {
  canSubmit: boolean;
  submit: () => void;
}

interface ManualWorkoutEditorProps {
  onMetaChange?: (meta: { canSubmit: boolean; submit: () => void; primaryLabel: string }) => void;
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
  const [member, setMember] = useState<PickedMember | null>(null);
  const [days, setDays] = useState<Day[]>(DEFAULT_DAYS);
  const [activeIdx, setActiveIdx] = useState(0);

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
      setDays(draftDays.map((dd: any) => ({
        day: dd.day || '',
        focus: dd.focus || '',
        exercises: (dd.exercises || []).map((ex: any) => {
          const restRaw = ex.rest;
          const restNum = typeof restRaw === 'number'
            ? restRaw
            : typeof restRaw === 'string'
              ? parseInt(restRaw.replace(/\D/g, ''), 10) || 60
              : 60;
          return {
            name: ex.name || '',
            sets: ex.sets ?? 3,
            reps: String(ex.reps ?? '12'),
            rest_seconds: restNum,
            weight: ex.weight || '',
            form_tips: ex.notes || ex.form_tips || '',
            video_url: ex.video_url,
            video_file_path: ex.video_file_path,
          };
        }),
      })));
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
          setDays(tplDays.map((d: any) => ({
            day: d.day || '',
            focus: d.focus || '',
            exercises: (d.exercises || []).map((ex: any) => {
              const restRaw = ex.rest;
              const restNum = typeof restRaw === 'number'
                ? restRaw
                : typeof restRaw === 'string'
                  ? parseInt(restRaw.replace(/\D/g, ''), 10) || 60
                  : 60;
              return {
                name: ex.name || '',
                sets: ex.sets ?? 3,
                reps: String(ex.reps ?? '12'),
                rest_seconds: restNum,
                weight: ex.weight || '',
                form_tips: ex.notes || '',
                video_url: ex.video_url,
                video_file_path: ex.video_file_path,
              };
            }),
          })));
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
        .filter(d => d.exercises.length > 0)
        .map(d => ({
          day: d.day,
          focus: d.focus,
          exercises: d.exercises.map(ex => ({
            name: ex.name,
            sets: ex.sets,
            reps: ex.reps,
            rest: `${ex.rest_seconds}s`,
            weight: ex.weight || undefined,
            notes: ex.form_tips || undefined,
            video_url: ex.video_url || undefined,
            video_file_path: ex.video_file_path || undefined,
          })),
        })),
    }],
  });

  const handleSaveTemplate = useCallback(async () => {
    if (!planName.trim()) { toast.error('Plan name is required'); return; }
    if (totalExercises === 0) { toast.error('Add at least one exercise'); return; }
    if (!templateId) return;
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
      navigate('/fitness/templates');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update template');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planName, description, difficulty, goal, totalExercises, templateId, navigate, queryClient, days]);

  const handlePreview = useCallback(() => {
    if (!planName.trim()) { toast.error('Plan name is required'); return; }
    if (totalExercises === 0) { toast.error('Add at least one exercise'); return; }

    if (draftId) {
      const existing = loadDraft(draftId);
      saveDraft({
        ...(existing || {} as any),
        id: draftId,
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
      navigate(`/fitness/preview/${draftId}`);
      return;
    }

    const id = newDraftId();
    saveDraft({
      id,
      source: 'manual-workout',
      templateId: templateId || undefined,
      type: 'workout',
      name: planName,
      description,
      goal,
      difficulty,
      memberId: member?.id,
      memberName: member?.full_name,
      memberCode: member?.member_code,
      content: buildContent(),
      createdAt: new Date().toISOString(),
    });
    navigate(`/fitness/preview/${id}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planName, description, difficulty, goal, totalExercises, draftId, templateId, member, navigate, days]);

  const canSubmit = !!planName.trim() && totalExercises > 0;
  const submit = useMemo(
    () => (editMode ? handleSaveTemplate : handlePreview),
    [editMode, handleSaveTemplate, handlePreview],
  );
  const primaryLabel = useMemo(
    () => (editMode ? 'Save Template' : draftId ? 'Save & Back to Preview' : 'Continue to Preview'),
    [editMode, draftId],
  );

  useEffect(() => {
    onMetaChange?.({ canSubmit, submit, primaryLabel });
  }, [canSubmit, submit, primaryLabel, onMetaChange]);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Plan Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Plan Name *</Label>
                <Input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="e.g. Push/Pull/Legs Hypertrophy" />
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
                <Label>Description</Label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short summary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Dumbbell className="h-4 w-4" /> Weekly Schedule
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {days.map((d, idx) => (
                <Button
                  key={idx}
                  size="sm"
                  variant={activeIdx === idx ? 'default' : 'outline'}
                  onClick={() => setActiveIdx(idx)}
                  className="gap-1.5"
                >
                  {d.day}
                  {d.exercises.length > 0 && (
                    <Badge variant="secondary" className="h-4 px-1 text-[10px]">{d.exercises.length}</Badge>
                  )}
                </Button>
              ))}
            </div>

            <div className="rounded-lg border p-3 space-y-3 bg-muted/30">
              <div className="flex items-center gap-3">
                <span className="font-semibold text-sm w-20">{days[activeIdx].day}</span>
                <Input
                  className="h-8 max-w-xs"
                  placeholder="Focus (e.g. Chest & Triceps)"
                  value={days[activeIdx].focus}
                  onChange={(e) => updateDay(activeIdx, { focus: e.target.value })}
                />
              </div>

              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleExerciseDragEnd}
              >
                <SortableContext
                  items={days[activeIdx].exercises.map((_, i) => String(i))}
                  strategy={verticalListSortingStrategy}
                >
                  {days[activeIdx].exercises.map((ex, exIdx) => (
                    <SortableExerciseRow
                      key={exIdx}
                      id={String(exIdx)}
                      ex={ex}
                      exIdx={exIdx}
                      onUpdate={updateExercise}
                      onRemove={removeExercise}
                      onVideoChange={(next) => {
                        const updated = days[activeIdx].exercises.map((e, i) =>
                          i === exIdx ? { ...e, video_url: next.video_url, video_file_path: next.video_file_path } : e
                        );
                        updateDay(activeIdx, { exercises: updated });
                      }}
                    />
                  ))}
                </SortableContext>
              </DndContext>

              <Button variant="outline" size="sm" className="w-full border-dashed" onClick={addExercise}>
                <Plus className="h-4 w-4 mr-1" /> Add Exercise
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Optional: Pre-Assign Member</CardTitle>
          </CardHeader>
          <CardContent>
            <MemberSearchPicker value={member} onChange={setMember} label="Member" />
            <p className="text-xs text-muted-foreground mt-2">
              You can also assign on the next step.
            </p>
          </CardContent>
        </Card>
        <Card className="bg-muted/30">
          <CardContent className="pt-4 space-y-1.5">
            <p className="text-xs text-muted-foreground">Total exercises</p>
            <p className="text-2xl font-bold">{totalExercises}</p>
            <p className="text-xs text-muted-foreground">
              across {days.filter(d => d.exercises.length > 0).length} active days
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
