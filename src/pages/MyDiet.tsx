import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useMemberData } from '@/hooks/useMemberData';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { normalizeDietPlan } from '@/lib/planNormalizer';
import {
  AlertCircle,
  Apple,
  Beef,
  Calendar,
  Clock,
  Droplets,
  Flame,
  User,
  UtensilsCrossed,
  Wheat,
} from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { PlanDownloadButton } from '@/components/fitness/PlanDownloadButton';
import { DietPlanViewer } from '@/components/member/diet/DietPlanViewer';
import { PlanPageHero } from '@/components/member/plan/PlanPageHero';
import { PlanMetaCard } from '@/components/member/plan/PlanMetaCard';
import {
  PlanEmptyState,
  PlanPageSkeleton,
  PlanPdfCard,
  PlanTipsCard,
} from '@/components/member/plan/PlanStates';

interface UnifiedDietPlan {
  id: string;
  source: 'member_fitness_plans' | 'diet_plans';
  name: string;
  start_date: string | null;
  end_date: string | null;
  plan_data: any;
  calories_target: number | null;
  trainer_name: string | null;
  template_id: string | null;
  template_name: string | null;
  source_kind: 'structured' | 'pdf';
  pdf_url: string | null;
  pdf_filename: string | null;
}

export default function MyDiet() {
  useAuth();
  const { member, isLoading: memberLoading } = useMemberData();

  const { data: dietPlan, isLoading: planLoading } = useQuery<UnifiedDietPlan | null>({
    queryKey: ['my-diet-plan-unified', member?.id],
    enabled: !!member,
    queryFn: async () => {
      // Primary source: unified member_fitness_plans table.
      const { data: unified, error: unifiedErr } = await supabase
        .from('member_fitness_plans')
        .select('*')
        .eq('member_id', member!.id)
        .eq('plan_type', 'diet')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (unifiedErr) console.warn('Unified diet fetch failed:', unifiedErr.message);

      if (unified) {
        const planData: any = unified.plan_data || {};
        let trainerName: string | null = null;
        if (unified.created_by) {
          const { data: trainer } = await supabase
            .from('profiles').select('full_name').eq('id', unified.created_by).maybeSingle();
          trainerName = trainer?.full_name ?? null;
        }
        let templateName: string | null = null;
        if ((unified as any).template_id) {
          const { data: tpl } = await supabase
            .from('fitness_plan_templates').select('name').eq('id', (unified as any).template_id).maybeSingle();
          templateName = tpl?.name ?? null;
        }
        return {
          id: unified.id,
          source: 'member_fitness_plans',
          name: unified.plan_name || planData?.name || 'Diet Plan',
          start_date: unified.valid_from || null,
          end_date: unified.valid_until || null,
          plan_data: planData,
          calories_target: planData?.dailyCalories ?? planData?.caloriesTarget ?? null,
          trainer_name: trainerName,
          template_id: (unified as any).template_id ?? null,
          template_name: templateName,
          source_kind: ((unified as any).source_kind as 'pdf' | 'structured') || 'structured',
          pdf_url: (unified as any).pdf_url ?? null,
          pdf_filename: (unified as any).pdf_filename ?? null,
        };
      }

      // Legacy fallback: diet_plans table (read-only, kept for one release).
      const { data: legacy } = await supabase
        .from('diet_plans')
        .select('*, trainer:trainers!trainer_id(id, user_id)')
        .eq('member_id', member!.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!legacy) return null;
      let trainerName: string | null = null;
      if ((legacy as any).trainer?.user_id) {
        const { data: t } = await supabase
          .from('profiles').select('full_name').eq('id', (legacy as any).trainer.user_id).maybeSingle();
        trainerName = t?.full_name ?? null;
      }
      return {
        id: (legacy as any).id,
        source: 'diet_plans',
        name: (legacy as any).name || 'Diet Plan',
        start_date: (legacy as any).start_date || null,
        end_date: (legacy as any).end_date || null,
        plan_data: (legacy as any).plan_data || {},
        calories_target: (legacy as any).calories_target ?? null,
        trainer_name: trainerName,
        template_id: null,
        template_name: null,
        source_kind: 'structured',
        pdf_url: null,
        pdf_filename: null,
      };
    },
  });

  const isLoading = memberLoading || planLoading;

  if (isLoading) {
    return (
      <AppLayout>
        <PlanPageSkeleton />
      </AppLayout>
    );
  }

  if (!member) {
    return (
      <AppLayout>
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
          <AlertCircle className="h-12 w-12 text-warning" />
          <h2 className="text-xl font-semibold">No Member Profile Found</h2>
          <p className="text-muted-foreground">Your account is not linked to a member profile.</p>
        </div>
      </AppLayout>
    );
  }

  // Day-average macros so the hero shows the same numbers the day cards do.
  const normalized = dietPlan ? normalizeDietPlan(dietPlan.plan_data || {}) : null;
  const dayCount = normalized?.days.length || 0;
  const avg = normalized?.days.reduce(
    (acc, d) => ({
      calories: acc.calories + d.totals.calories,
      protein: acc.protein + d.totals.protein,
      carbs: acc.carbs + d.totals.carbs,
      fats: acc.fats + d.totals.fats,
    }),
    { calories: 0, protein: 0, carbs: 0, fats: 0 },
  ) ?? { calories: 0, protein: 0, carbs: 0, fats: 0 };
  const perDay = (value: number) => (dayCount ? Math.round(value / dayCount) : 0);

  const dailyCalories = dietPlan?.calories_target || perDay(avg.calories);
  const notes = normalized?.notes || (dietPlan?.plan_data as any)?.notes;

  return (
    <AppLayout>
      <div className="space-y-6 pb-8">
        <PlanPageHero
          eyebrow={dietPlan ? 'Active Plan' : 'No active plan'}
          title="My Diet"
          subtitle={
            dietPlan?.name ||
            'Your personalised nutrition guide, designed to match your goals.'
          }
          action={
            <Button asChild variant="secondary" size="lg" className="shadow-md">
              <Link to="/my-requests">Request New Plan</Link>
            </Button>
          }
          stats={
            dietPlan
              ? [
                  {
                    icon: <Flame className="h-4 w-4" />,
                    label: 'Daily kcal',
                    value: dailyCalories ? String(dailyCalories) : '—',
                  },
                  {
                    icon: <Beef className="h-4 w-4" />,
                    label: 'Protein',
                    value: perDay(avg.protein) ? `${perDay(avg.protein)}g` : '—',
                  },
                  {
                    icon: <Wheat className="h-4 w-4" />,
                    label: 'Carbs',
                    value: perDay(avg.carbs) ? `${perDay(avg.carbs)}g` : '—',
                  },
                  {
                    icon: <Droplets className="h-4 w-4" />,
                    label: 'Fats',
                    value: perDay(avg.fats) ? `${perDay(avg.fats)}g` : '—',
                  },
                ]
              : undefined
          }
        />

        {dietPlan ? (
          <>
            <PlanMetaCard
              planName={dietPlan.name}
              templateName={dietPlan.template_name}
              icon={<UtensilsCrossed className="h-5 w-5" />}
              action={
                <PlanDownloadButton
                  pdfUrl={dietPlan.pdf_url}
                  pdfFilename={dietPlan.pdf_filename}
                  planName={dietPlan.name}
                  planType="diet"
                  planData={dietPlan.plan_data}
                  caloriesTarget={dietPlan.calories_target}
                  validFrom={dietPlan.start_date}
                  validUntil={dietPlan.end_date}
                  memberName={(member as any)?.profiles?.full_name || null}
                  memberCode={member.member_code}
                  trainerName={dietPlan.trainer_name}
                  branchId={member.branch_id}
                />
              }
              items={[
                {
                  icon: <Calendar className="h-4 w-4" />,
                  label: 'Start',
                  value: dietPlan.start_date
                    ? format(new Date(dietPlan.start_date), 'dd MMM yyyy')
                    : '—',
                },
                {
                  icon: <Clock className="h-4 w-4" />,
                  label: 'End',
                  value: dietPlan.end_date
                    ? format(new Date(dietPlan.end_date), 'dd MMM yyyy')
                    : 'Ongoing',
                },
                {
                  icon: <User className="h-4 w-4" />,
                  label: 'Trainer',
                  value: dietPlan.trainer_name || 'Self-managed',
                },
              ]}
            />

            {dietPlan.source_kind === 'pdf' && dietPlan.pdf_url ? (
              <PlanPdfCard
                url={dietPlan.pdf_url}
                filename={dietPlan.pdf_filename}
                fallbackTitle="Diet Plan PDF"
              />
            ) : (
              <>
                <DietPlanViewer planData={dietPlan.plan_data} />
                {notes && (
                  <Card className="rounded-2xl border-border/60 bg-muted/30">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Trainer Notes</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="whitespace-pre-line text-sm text-muted-foreground">{notes}</p>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </>
        ) : (
          <PlanEmptyState
            icon={<Apple className="h-8 w-8" />}
            title="No Active Diet Plan"
            description="You don't have a personalised diet plan yet. Request one from your trainer to get started."
            primaryLabel="Request Diet Plan"
            primaryTo="/my-requests"
            secondary={
              member.assigned_trainer
                ? { label: 'Book PT Session', to: '/my-pt-sessions' }
                : undefined
            }
          />
        )}

        <PlanTipsCard
          title="Nutrition Tips"
          tips={[
            'Drink 3-4 litres of water through the day',
            'Eat protein with every main meal',
            'Keep meal timings consistent',
            'Prefer whole foods over packaged snacks',
            'Log how you feel after each meal',
            'Sleep 7-9 hours to support recovery',
          ]}
        />
      </div>
    </AppLayout>
  );
}
