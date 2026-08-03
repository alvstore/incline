import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useMemberData } from '@/hooks/useMemberData';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Activity,
  Calendar,
  Dumbbell,
  AlertCircle,
  User,
  Clock,
  Target,
  CheckCircle2,
  Loader2,
  Sparkles,
  FileText,
  Download,
} from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { PlanDownloadButton } from '@/components/fitness/PlanDownloadButton';
import { WorkoutPlanViewer } from '@/components/member/workout/WorkoutPlanViewer';

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
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  if (!member) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
          <AlertCircle className="h-12 w-12 text-warning" />
          <h2 className="text-xl font-semibold">No Member Profile Found</h2>
          <p className="text-muted-foreground">Your account is not linked to a member profile.</p>
        </div>
      </AppLayout>
    );
  }





  return (
    <AppLayout>
      <div className="space-y-6 pb-8">
        {/* ===== HERO ===== */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary to-accent p-6 sm:p-8 text-primary-foreground shadow-lg shadow-primary/20">
          <div className="absolute inset-0 opacity-20 pointer-events-none">
            <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/30 blur-3xl" />
            <div className="absolute -left-8 bottom-0 h-32 w-32 rounded-full bg-white/20 blur-2xl" />
          </div>
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/15 backdrop-blur px-3 py-1 text-xs font-medium">
                <Sparkles className="h-3.5 w-3.5" />
                {member.fitness_goals ? `Goal: ${member.fitness_goals}` : 'Personalised Routine'}
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">My Workout</h1>
              <p className="text-sm sm:text-base text-white/85 max-w-lg">
                Stay consistent with your assigned plan and track your wins.
              </p>
            </div>
            <Button asChild variant="secondary" size="lg" className="shrink-0 shadow-md">
              <Link to="/my-requests">Request New Plan</Link>
            </Button>
          </div>
        </div>

        {/* ===== PLAN ===== */}
        {workoutPlan ? (
          <>
            <Card className="rounded-2xl border-border/60 shadow-sm overflow-hidden">
              <div className="bg-gradient-to-r from-accent/10 via-primary/10 to-accent/5 px-5 py-4 border-b border-border/60">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/15 text-accent">
                      <Dumbbell className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold leading-tight">{workoutPlan.plan_name}</h3>
                      {workoutPlan.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{workoutPlan.description}</p>
                      )}
                      {(workoutPlan as any).template_name && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 italic">
                          From template: <span className="font-medium not-italic">{(workoutPlan as any).template_name}</span>
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <PlanDownloadButton
                      pdfUrl={(workoutPlan as any).pdf_url}
                      pdfFilename={(workoutPlan as any).pdf_filename}
                      planName={workoutPlan.plan_name || 'Workout Plan'}
                      planType="workout"
                      planData={workoutPlan.plan_data}
                      description={(workoutPlan as any).description}
                      validFrom={workoutPlan.valid_from}
                      validUntil={workoutPlan.valid_until}
                      memberName={(member as any)?.profiles?.full_name || null}
                      memberCode={member.member_code}
                      trainerName={(workoutPlan as any).trainer?.full_name || null}
                      goal={member.fitness_goals || null}
                      branchId={member.branch_id}
                    />
                    <Badge className="bg-success text-success-foreground">Active</Badge>
                  </div>
                </div>
              </div>
              <CardContent className="grid gap-4 p-5 sm:grid-cols-3">
                <MetaItem
                  icon={<Calendar className="h-4 w-4" />}
                  label="Created"
                  value={format(new Date(workoutPlan.created_at || new Date()), 'dd MMM yyyy')}
                />
                <MetaItem
                  icon={<Clock className="h-4 w-4" />}
                  label="Valid Until"
                  value={workoutPlan.valid_until ? format(new Date(workoutPlan.valid_until), 'dd MMM yyyy') : 'Ongoing'}
                />
                <MetaItem
                  icon={<User className="h-4 w-4" />}
                  label="Trainer"
                  value={(workoutPlan as any).trainer?.full_name || 'Assigned Trainer'}
                />
              </CardContent>
            </Card>

            {(workoutPlan as any).source_kind === 'pdf' && (workoutPlan as any).pdf_url ? (
              <Card className="rounded-2xl border-border/60 shadow-sm overflow-hidden">
                <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/10 text-accent">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{(workoutPlan as any).pdf_filename || 'Workout Plan PDF'}</CardTitle>
                      <CardDescription className="text-xs">Tap download if the preview doesn't load</CardDescription>
                    </div>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <a href={(workoutPlan as any).pdf_url} target="_blank" rel="noopener noreferrer" download>
                      <Download className="h-4 w-4 mr-1.5" /> Download
                    </a>
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  <iframe
                    src={(workoutPlan as any).pdf_url}
                    title={(workoutPlan as any).pdf_filename || 'Workout Plan'}
                    className="w-full h-[80vh] border-0"
                  />
                </CardContent>
              </Card>
            ) : (
              <WorkoutPlanViewer planId={workoutPlan.id} planData={workoutPlan.plan_data} />
            )}

          </>
        ) : (
          <Card className="rounded-2xl border-dashed">
            <CardContent className="py-16 text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10">
                <Activity className="h-8 w-8 text-accent" />
              </div>
              <h3 className="text-xl font-semibold mb-2">No Active Workout Plan</h3>
              <CardDescription className="mb-6 max-w-md mx-auto">
                Request a personalised plan from your trainer to take the guesswork out of training.
              </CardDescription>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button asChild size="lg">
                  <Link to="/my-requests">Request Workout Plan</Link>
                </Button>
                {member.assigned_trainer && (
                  <Button variant="outline" size="lg" asChild>
                    <Link to="/my-pt-sessions">Book PT Session</Link>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ===== Tips ===== */}
        <Card className="rounded-2xl border-border/60 bg-gradient-to-br from-muted/40 to-background">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" />
              Workout Tips
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2.5 sm:grid-cols-2 text-sm text-muted-foreground">
              {[
                'Warm up for 5-10 minutes before training',
                'Stay hydrated throughout your session',
                'Focus on proper form over heavy weight',
                'Rest 60-90 seconds between sets',
                'Track progress in My Progress',
                'Sleep 7-9 hours for optimal recovery',
              ].map((tip) => (
                <div key={tip} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  <span>{tip}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

function MetaItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold truncate">{value}</p>
      </div>
    </div>
  );
}
