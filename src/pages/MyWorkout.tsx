import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useMemberData } from '@/hooks/useMemberData';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Activity, AlertCircle, Calendar, Clock, Dumbbell, User } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { PlanDownloadButton } from '@/components/fitness/PlanDownloadButton';
import { WorkoutPlanViewer } from '@/components/member/workout/WorkoutPlanViewer';
import { PlanPageHero } from '@/components/member/plan/PlanPageHero';
import { PlanMetaCard } from '@/components/member/plan/PlanMetaCard';
import {
  PlanEmptyState,
  PlanPageSkeleton,
  PlanPdfCard,
  PlanTipsCard,
} from '@/components/member/plan/PlanStates';

export default function MyWorkout() {
  useAuth();
  const { member, isLoading: memberLoading } = useMemberData();

  const { data: workoutPlan, isLoading: planLoading } = useQuery({
    queryKey: ['my-workout-plan', member?.id],
    enabled: !!member,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_fitness_plans')
        .select('*')
        .eq('member_id', member!.id)
        .eq('plan_type', 'workout')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      let trainerProfile: { full_name: string } | null = null;
      let templateName: string | null = null;
      if (data?.created_by) {
        const { data: tp } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', data.created_by)
          .maybeSingle();
        trainerProfile = tp ?? null;
      }
      if (data && (data as any).template_id) {
        const { data: tpl } = await supabase
          .from('fitness_plan_templates')
          .select('name')
          .eq('id', (data as any).template_id)
          .maybeSingle();
        templateName = tpl?.name ?? null;
      }
      if (!data) return null;
      return { ...data, trainer: trainerProfile, template_name: templateName };
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

  const plan = workoutPlan as any;

  return (
    <AppLayout>
      <div className="space-y-6 pb-8">
        <PlanPageHero
          eyebrow={member.fitness_goals ? `Goal: ${member.fitness_goals}` : 'Personalised Routine'}
          title="My Workout"
          subtitle="Stay consistent with your assigned plan and track your wins."
          action={
            <Button asChild variant="secondary" size="lg" className="shadow-md">
              <Link to="/my-requests">Request New Plan</Link>
            </Button>
          }
        />

        {plan ? (
          <>
            <PlanMetaCard
              planName={plan.plan_name || 'Workout Plan'}
              description={plan.description}
              templateName={plan.template_name}
              icon={<Dumbbell className="h-5 w-5" />}
              action={
                <PlanDownloadButton
                  pdfUrl={plan.pdf_url}
                  pdfFilename={plan.pdf_filename}
                  planName={plan.plan_name || 'Workout Plan'}
                  planType="workout"
                  planData={plan.plan_data}
                  description={plan.description}
                  validFrom={plan.valid_from}
                  validUntil={plan.valid_until}
                  memberName={(member as any)?.profiles?.full_name || null}
                  memberCode={member.member_code}
                  trainerName={plan.trainer?.full_name || null}
                  goal={member.fitness_goals || null}
                  branchId={member.branch_id}
                />
              }
              items={[
                {
                  icon: <Calendar className="h-4 w-4" />,
                  label: 'Created',
                  value: format(new Date(plan.created_at || new Date()), 'dd MMM yyyy'),
                },
                {
                  icon: <Clock className="h-4 w-4" />,
                  label: 'Valid Until',
                  value: plan.valid_until
                    ? format(new Date(plan.valid_until), 'dd MMM yyyy')
                    : 'Ongoing',
                },
                {
                  icon: <User className="h-4 w-4" />,
                  label: 'Trainer',
                  value: plan.trainer?.full_name || 'Assigned Trainer',
                },
              ]}
            />

            {plan.source_kind === 'pdf' && plan.pdf_url ? (
              <PlanPdfCard
                url={plan.pdf_url}
                filename={plan.pdf_filename}
                fallbackTitle="Workout Plan PDF"
              />
            ) : (
              <WorkoutPlanViewer planId={plan.id} planData={plan.plan_data} />
            )}
          </>
        ) : (
          <PlanEmptyState
            icon={<Activity className="h-8 w-8" />}
            title="No Active Workout Plan"
            description="Request a personalised plan from your trainer to take the guesswork out of training."
            primaryLabel="Request Workout Plan"
            primaryTo="/my-requests"
            secondary={
              member.assigned_trainer
                ? { label: 'Book PT Session', to: '/my-pt-sessions' }
                : undefined
            }
          />
        )}

        <PlanTipsCard
          title="Workout Tips"
          tips={[
            'Warm up for 5-10 minutes before training',
            'Stay hydrated throughout your session',
            'Focus on proper form over heavy weight',
            'Rest 60-90 seconds between sets',
            'Track progress in My Progress',
            'Sleep 7-9 hours for optimal recovery',
          ]}
        />
      </div>
    </AppLayout>
  );
}
