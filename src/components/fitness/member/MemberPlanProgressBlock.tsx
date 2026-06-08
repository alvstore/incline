import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Dumbbell, Apple, Replace, Calendar, Sparkles, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import {
  buildProgressSummary,
  fetchMealSwaps,
  fetchWorkoutCompletions,
  fetchMealCompletions,
  type DietPlanSource,
  type WorkoutPlanSource,
} from '@/services/memberPlanProgressService';
import type { DietPlanContent, WorkoutPlanContent } from '@/types/fitnessPlan';

interface Props {
  memberId: string;
}

/** Read-only summary of the member's plan adherence — used in the trainer/admin
 *  Member Profile drawer "Plans" tab. */
export function MemberPlanProgressBlock({ memberId }: Props) {
  const { data: plans = [], isLoading } = useQuery({
    queryKey: ['member-plans-summary', memberId],
    queryFn: async () => {
      const [{ data: fitness }, { data: diet }] = await Promise.all([
        supabase
          .from('member_fitness_plans')
          .select('*')
          .eq('member_id', memberId)
          .order('created_at', { ascending: false }),
        supabase
          .from('diet_plans')
          .select('*')
          .eq('member_id', memberId)
          .eq('is_active', true)
          .order('created_at', { ascending: false }),
      ]);
      const out: Array<{
        id: string;
        source: 'member_fitness_plans' | 'diet_plans';
        name: string;
        type: 'workout' | 'diet';
        validFrom?: string | null;
        validUntil?: string | null;
        content: WorkoutPlanContent | DietPlanContent;
        isAI?: boolean;
      }> = [];
      (fitness || []).forEach((p: any) => {
        out.push({
          id: p.id,
          source: 'member_fitness_plans',
          name: p.plan_name,
          type: p.plan_type,
          validFrom: p.valid_from,
          validUntil: p.valid_until,
          content: p.plan_data || {},
          isAI: p.is_ai_generated,
        });
      });
      (diet || []).forEach((p: any) =>
        out.push({
          id: p.id,
          source: 'diet_plans',
          name: p.name || 'Diet Plan',
          type: 'diet',
          validFrom: p.start_date,
          validUntil: p.end_date,
          content: p.meal_plan || {},
        }),
      );
      return out;
    },
    enabled: !!memberId,
  });

  const primaryWorkout = plans.find((p) => p.type === 'workout');
  const primaryDiet = plans.find((p) => p.type === 'diet');

  const { data: progress } = useQuery({
    queryKey: ['member-plan-progress-trainer', memberId, primaryWorkout?.id, primaryDiet?.id],
    enabled: !!memberId && (!!primaryWorkout || !!primaryDiet),
    queryFn: () =>
      buildProgressSummary({
        memberId,
        workoutPlanSource: primaryWorkout
          ? (primaryWorkout.source as WorkoutPlanSource)
          : null,
        workoutPlanId: primaryWorkout?.id,
        workoutContent: primaryWorkout?.content as WorkoutPlanContent,
        dietPlanSource: primaryDiet ? (primaryDiet.source as DietPlanSource) : null,
        dietPlanId: primaryDiet?.id,
        dietContent: primaryDiet?.content as DietPlanContent,
      }),
  });

  const { data: workoutLog = [] } = useQuery({
    queryKey: ['trainer-workout-log', memberId, primaryWorkout?.source, primaryWorkout?.id],
    enabled: !!primaryWorkout?.id,
    queryFn: () =>
      fetchWorkoutCompletions(memberId, primaryWorkout!.source as WorkoutPlanSource, primaryWorkout!.id),
  });
  const { data: mealLog = [] } = useQuery({
    queryKey: ['trainer-meal-log', memberId, primaryDiet?.source, primaryDiet?.id],
    enabled: !!primaryDiet?.id,
    queryFn: () =>
      fetchMealCompletions(memberId, primaryDiet!.source as DietPlanSource, primaryDiet!.id),
  });
  const { data: swaps = [] } = useQuery({
    queryKey: ['trainer-meal-swaps', memberId, primaryDiet?.source, primaryDiet?.id],
    enabled: !!primaryDiet?.id,
    queryFn: () =>
      fetchMealSwaps(memberId, primaryDiet!.source as DietPlanSource, primaryDiet!.id),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6 flex items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading plan progress…
        </CardContent>
      </Card>
    );
  }

  if (plans.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          No fitness or diet plans assigned yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Plan Adherence</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Dumbbell className="h-3.5 w-3.5" /> Workout (per week)
              </span>
              <span className="font-medium">
                {progress?.completedExercises ?? 0}/{progress?.totalExercises ?? 0} ·{' '}
                {progress?.workoutCompliancePct ?? 0}%
              </span>
            </div>
            <Progress value={progress?.workoutCompliancePct ?? 0} className="h-2" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Apple className="h-3.5 w-3.5" /> Diet (last 7 days)
              </span>
              <span className="font-medium">
                {progress?.completedMealsThisWeek ?? 0}/{progress?.totalMealsThisWeek ?? 0} ·{' '}
                {progress?.dietCompliancePct ?? 0}%
              </span>
            </div>
            <Progress value={progress?.dietCompliancePct ?? 0} className="h-2" />
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div className="rounded-md bg-muted/40 px-3 py-2">
              <div className="text-[10px] uppercase font-semibold text-muted-foreground flex items-center gap-1">
                <Replace className="h-3 w-3" /> Meal swaps
              </div>
              <div className="text-base font-bold">{progress?.swapCount ?? 0}</div>
            </div>
            <div className="rounded-md bg-muted/40 px-3 py-2">
              <div className="text-[10px] uppercase font-semibold text-muted-foreground">
                Weight Δ (60d)
              </div>
              <div className="text-base font-bold">
                {progress?.weightDeltaKg == null
                  ? '—'
                  : `${progress.weightDeltaKg > 0 ? '+' : ''}${progress.weightDeltaKg} kg`}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Assigned Plans</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {plans.map((p) => (
            <div key={`${p.type}-${p.id}`} className="flex items-start justify-between gap-2 border-b last:border-0 pb-2 last:pb-0">
              <div className="min-w-0">
                <div className="font-medium flex items-center gap-2">
                  {p.type === 'workout' ? (
                    <Dumbbell className="h-3.5 w-3.5 text-primary shrink-0" />
                  ) : (
                    <Apple className="h-3.5 w-3.5 text-success shrink-0" />
                  )}
                  <span className="truncate">{p.name}</span>
                  {p.isAI && (
                    <Badge variant="secondary" className="text-[10px] gap-0.5">
                      <Sparkles className="h-2.5 w-2.5" /> AI
                    </Badge>
                  )}
                </div>
                {p.validFrom && (
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Calendar className="h-3 w-3" />
                    {format(new Date(p.validFrom), 'MMM d')}
                    {p.validUntil && ` → ${format(new Date(p.validUntil), 'MMM d, yyyy')}`}
                  </div>
                )}
              </div>
              <Badge variant="outline" className="text-[10px] capitalize">{p.type}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {(workoutLog.length > 0 || mealLog.length > 0 || swaps.length > 0) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs max-h-60 overflow-y-auto">
            {workoutLog.slice(0, 5).map((c) => (
              <div key={`wo-${c.id}`} className="flex items-center gap-2 text-muted-foreground">
                <Dumbbell className="h-3 w-3 text-primary" />
                Completed <span className="text-foreground font-medium">{c.exercise_name || 'exercise'}</span>
                <span className="ml-auto">{format(new Date(c.completed_at), 'MMM d, HH:mm')}</span>
              </div>
            ))}
            {mealLog.slice(0, 5).map((c) => (
              <div key={`ml-${c.id}`} className="flex items-center gap-2 text-muted-foreground">
                <Apple className="h-3 w-3 text-success" />
                Logged <span className="text-foreground font-medium">{c.meal_name || 'meal'}</span>
                <span className="ml-auto">{format(new Date(c.completed_at), 'MMM d, HH:mm')}</span>
              </div>
            ))}
            {swaps.slice(0, 5).map((s) => (
              <div key={`sw-${s.id}`} className="flex items-center gap-2 text-muted-foreground">
                <Replace className="h-3 w-3 text-warning" />
                Swapped to <span className="text-foreground font-medium">{s.new_meal?.name}</span>
                <span className="ml-auto">{format(new Date(s.swapped_at), 'MMM d, HH:mm')}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
