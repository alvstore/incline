import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Pencil, UserPlus, Sparkles, Dumbbell, UtensilsCrossed, AlertCircle, Bookmark, Loader2 } from 'lucide-react';
import { CreateFlowLayout } from '@/components/fitness/create/CreateFlowLayout';
import { AssignPlanDrawer } from '@/components/fitness/AssignPlanDrawer';
import { loadDraft, PlanDraft } from '@/lib/planDraft';
import { useBranchContext } from '@/contexts/BranchContext';
import { createPlanTemplate } from '@/services/fitnessService';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { normalizeDietPlan, normalizeWorkoutPlan } from '@/lib/planNormalizer';

export default function PreviewPlanPage() {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [savedTemplateId, setSavedTemplateId] = useState<string | null>(null);
  const { effectiveBranchId } = useBranchContext();
  const queryClient = useQueryClient();

  const handleSaveAsTemplate = async () => {
    if (!draft) return;
    setSavingTemplate(true);
    try {
      const aud = draft.audience || {};
      const tpl = await createPlanTemplate({
        branch_id: effectiveBranchId ?? null,
        name: draft.name,
        type: draft.type,
        description: draft.description,
        difficulty: draft.difficulty,
        goal: draft.goal,
        content: draft.content,
        is_common: !!draft.isCommon,
        target_age_min: aud.target_age_min ?? null,
        target_age_max: aud.target_age_max ?? null,
        target_gender: (aud.target_gender as 'any' | 'male' | 'female') ?? 'any',
        target_experience: aud.target_experience ?? [],
        target_weight_min_kg: aud.target_weight_min_kg ?? null,
        target_weight_max_kg: aud.target_weight_max_kg ?? null,
        duration_weeks: aud.duration_weeks ?? null,
      });
      setSavedTemplateId(tpl.id);
      queryClient.invalidateQueries({ queryKey: ['fitness-templates'] });
      queryClient.invalidateQueries({ queryKey: ['fitness-template-usage'] });
      toast.success(draft.isCommon ? 'Saved as Common Plan template' : 'Saved as template');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save template');
    } finally {
      setSavingTemplate(false);
    }
  };

  useEffect(() => {
    if (planId) setDraft(loadDraft(planId));
  }, [planId]);

  const editPath = useMemo(() => {
    if (!draft) return '/fitness/create';
    const t = draft.type === 'workout' ? 'workout' : 'diet';
    return `/fitness/create/manual?type=${t}&draft=${planId}`;
  }, [draft, planId]);

  if (!planId || !draft) {
    return (
      <CreateFlowLayout title="Preview" step="preview" backTo="/fitness/create">
        <Card className="border-warning/30">
          <CardContent className="py-10 text-center space-y-3">
            <AlertCircle className="h-10 w-10 mx-auto text-warning" />
            <h3 className="text-lg font-semibold">Plan draft not found</h3>
            <p className="text-sm text-muted-foreground">
              This draft is no longer available — drafts only exist for the current browser session.
            </p>
            <Button onClick={() => navigate('/fitness/create')}>Start a new plan</Button>
          </CardContent>
        </Card>
      </CreateFlowLayout>
    );
  }

  const isWorkout = draft.type === 'workout';

  return (
    <>
      <CreateFlowLayout
        title="Preview Plan"
        subtitle={draft.name}
        step="preview"
        backTo={editPath}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate(editPath)} className="gap-1.5">
              <Pencil className="h-4 w-4" /> Edit before assign
            </Button>
            <Button
              variant="outline"
              onClick={handleSaveAsTemplate}
              disabled={savingTemplate || !!savedTemplateId}
              className="gap-1.5"
            >
              {savingTemplate ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Bookmark className="h-4 w-4" />
              )}
              {savedTemplateId ? 'Saved as template' : 'Save as template'}
            </Button>
            <Button onClick={() => setAssignOpen(true)} className="gap-1.5">
              <UserPlus className="h-4 w-4" /> Assign to member
            </Button>
          </>
        }
      >
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Summary */}
          <Card className="lg:col-span-1">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                {isWorkout ? <Dumbbell className="h-4 w-4" /> : <UtensilsCrossed className="h-4 w-4" />}
                Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge>{draft.type}</Badge>
                {draft.source === 'ai' && <Badge variant="outline" className="gap-1"><Sparkles className="h-3 w-3" />AI</Badge>}
                {draft.difficulty && <Badge variant="secondary">{draft.difficulty}</Badge>}
                {draft.goal && <Badge variant="secondary">{draft.goal}</Badge>}
                {draft.daysPerWeek && (
                  <Badge variant="secondary">{draft.daysPerWeek}× / week</Badge>
                )}
                {draft.rotationIntervalDays && draft.rotationIntervalDays > 0 && (
                  <Badge variant="outline" className="border-primary/40 text-primary">
                    Rotates every {draft.rotationIntervalDays}d
                    {Array.isArray(draft.content?.rotation?.variants) && ` · ${draft.content.rotation.variants.length} variants`}
                  </Badge>
                )}
              </div>
              {draft.description && <p className="text-muted-foreground">{draft.description}</p>}
              <div className="space-y-1.5 pt-2 border-t">
                {draft.memberName && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Member</span><span className="font-medium">{draft.memberName}</span></div>
                )}
                {draft.memberCode && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Code</span><span>{draft.memberCode}</span></div>
                )}
                {draft.dietaryType && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Dietary type</span><span className="capitalize">{draft.dietaryType.replace(/_/g, ' ')}</span></div>
                )}
                {draft.cuisine && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Cuisine</span><span className="capitalize">{draft.cuisine}</span></div>
                )}
                {draft.caloriesTarget && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Daily calories</span><span>{draft.caloriesTarget}</span></div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Plan body */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Plan Contents</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[60vh] pr-4">
                {isWorkout ? <WorkoutPreview content={draft.content} /> : <DietPreview content={draft.content} />}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </CreateFlowLayout>

      <AssignPlanDrawer
        open={assignOpen}
        onOpenChange={setAssignOpen}
        plan={{
          name: draft.name,
          type: draft.type,
          description: draft.description,
          content: draft.content,
          template_id: savedTemplateId || draft.templateId,
        }}
        branchId={effectiveBranchId ?? undefined}
      />
    </>
  );
}

function WorkoutPreview({ content }: { content: any }) {
  const plan = normalizeWorkoutPlan(content);
  if (!plan.weeks.length) {
    return <p className="text-sm text-muted-foreground">No workout days configured.</p>;
  }
  return (
    <div className="space-y-5">
      {plan.weeks.map((wk, wi) => (
        <div key={wi} className="space-y-3">
          {plan.weeks.length > 1 && <h4 className="font-semibold text-sm text-primary">Week {wk.week}</h4>}
          {wk.days.map((d, di) => (
            <div key={di} className="rounded-lg border p-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="font-semibold text-sm">{d.day}</p>
                  {d.focus && <p className="text-xs text-muted-foreground">{d.focus}</p>}
                </div>
                <Badge variant="secondary" className="text-xs">{d.exercises.length} exercises</Badge>
              </div>
              <ul className="space-y-1.5">
                {d.exercises.map((ex, ei) => (
                  <li key={ei} className="text-sm flex items-start justify-between gap-2 py-1.5 px-2 rounded hover:bg-muted/40">
                    <div className="min-w-0">
                      <p className="font-medium">{ei + 1}. {ex.name}</p>
                      {ex.notes && <p className="text-xs text-muted-foreground">{ex.notes}</p>}
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {ex.sets}×{ex.reps}{ex.rest ? ` • ${ex.rest}` : ''}{ex.weight ? ` • ${ex.weight}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function DietPreview({ content }: { content: any }) {
  const plan = normalizeDietPlan(content);
  if (!plan.days.length) {
    return <p className="text-sm text-muted-foreground">No meals configured.</p>;
  }
  return (
    <div className="space-y-4">
      {plan.days.map((d, di) => (
        <div key={di} className="space-y-2">
          {plan.days.length > 1 && (
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-sm text-primary">{d.day}</h4>
              <span className="text-xs text-muted-foreground">{Math.round(d.totals.calories)} cal</span>
            </div>
          )}
          {d.slots.map((s, si) => (
            <div key={si} className="rounded-lg border p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="font-semibold text-sm">
                  {s.name}{s.time && <span className="text-xs text-muted-foreground"> • {s.time}</span>}
                </p>
                <Badge variant="secondary" className="text-xs">{Math.round(s.totals.calories)} cal</Badge>
              </div>
              <ul className="space-y-1">
                {s.items.map((it, ii) => (
                  <li key={ii} className="text-sm flex items-center justify-between gap-2 py-1">
                    <span className="min-w-0 flex items-center gap-2">
                      <span className="truncate">{it.food}</span>
                      {it.quantity && <span className="text-xs text-muted-foreground">{it.quantity}</span>}
                      {it.unmatched && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0">not in catalog</Badge>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {Math.round(it.calories)}cal · P{it.protein} C{it.carbs} F{it.fats}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
