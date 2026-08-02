import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sparkles,
  Hand,
  Dumbbell,
  UtensilsCrossed,
  ChevronRight,
  Library,
  Users,
  ArrowRight,
  Check,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { FitnessHubTabs } from '@/components/fitness/FitnessHubTabs';
import { useQuery } from '@tanstack/react-query';
import { fetchPlanTemplates } from '@/services/fitnessService';
import { fetchMealCatalog } from '@/services/mealCatalogService';
import { useBranchContext } from '@/contexts/BranchContext';
import { supabase } from '@/integrations/supabase/client';

export default function CreateModePickerPage() {
  const navigate = useNavigate();
  const { hasAnyRole } = useAuth();
  // AI generation is gated to staff with management privileges (cost + quality control).
  const isAdmin = hasAnyRole(['owner', 'admin', 'manager']);
  const canSeePipeline = hasAnyRole(['owner', 'admin', 'manager']);
  const { effectiveBranchId } = useBranchContext();

  // Lightweight pipeline counts so the landing surfaces the Catalog →
  // Templates → Assignments flow at a glance. All queries are gated behind
  // canSeePipeline so members never trigger them.
  const catalogQuery = useQuery({
    queryKey: ['fitness-pipeline-catalog', effectiveBranchId],
    queryFn: async () => {
      const rows = await fetchMealCatalog({ branchId: effectiveBranchId ?? null });
      return rows.length;
    },
    enabled: canSeePipeline,
  });
  const templateQuery = useQuery({
    queryKey: ['fitness-pipeline-templates', effectiveBranchId],
    queryFn: async () => {
      const rows = await fetchPlanTemplates(effectiveBranchId ?? undefined);
      return rows.length;
    },
    enabled: canSeePipeline,
  });
  const assignmentQuery = useQuery({
    queryKey: ['fitness-pipeline-assignments', effectiveBranchId],
    queryFn: async () => {
      let q = supabase.from('member_fitness_plans').select('id', { count: 'exact', head: true });
      if (effectiveBranchId) q = q.eq('branch_id', effectiveBranchId);
      const { count, error } = await q;
      if (error) {
        console.warn('assignment count failed:', error.message);
        return 0;
      }
      return count ?? 0;
    },
    enabled: canSeePipeline,
  });

  return (
    <AppLayout>
      <div className="space-y-6">
        <FitnessHubTabs />

        {/* Hero */}
        <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 p-6 sm:p-8 shadow-lg shadow-indigo-500/20">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/10 blur-2xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-24 right-24 h-48 w-48 rounded-full bg-white/5 blur-2xl"
          />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-xl space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-white/70">
                Fitness Studio
              </p>
              <h1 className="text-2xl sm:text-3xl font-bold text-white">Create a Plan</h1>
              <p className="text-sm leading-relaxed text-white/80">
                {isAdmin
                  ? 'Generate a personalised program with AI in seconds, or build every set, rep and meal by hand.'
                  : 'Build a workout or diet plan for one of your clients.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {isAdmin && (
                <Button
                  size="lg"
                  onClick={() => navigate('/fitness/create/ai')}
                  className="gap-2 bg-white text-indigo-700 hover:bg-white/90 focus:ring-2 focus:ring-white focus:outline-none"
                >
                  <Sparkles className="h-4 w-4" />
                  Start with AI
                </Button>
              )}
              <Button
                size="lg"
                variant="outline"
                onClick={() => navigate('/fitness/create/manual?type=workout')}
                className="gap-2 border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white focus:ring-2 focus:ring-white focus:outline-none"
              >
                <Hand className="h-4 w-4" />
                Build manually
              </Button>
            </div>
          </div>
        </section>

        {/* Pipeline */}
        {canSeePipeline && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <PipelineTile
              icon={<UtensilsCrossed className="h-5 w-5" />}
              title="Meal Catalog"
              count={catalogQuery.data}
              loading={catalogQuery.isLoading}
              singular="meal"
              plural="meals"
              emptyHint="Add your first meal"
              hint="Source ingredients & macros"
              onClick={() => navigate('/fitness/meal-catalog')}
            />
            <PipelineArrow />
            <PipelineTile
              icon={<Library className="h-5 w-5" />}
              title="Plan Templates"
              count={templateQuery.data}
              loading={templateQuery.isLoading}
              singular="template"
              plural="templates"
              emptyHint="No templates yet"
              hint="Reusable plans for any goal"
              onClick={() => navigate('/fitness/templates')}
            />
            <PipelineArrow />
            <PipelineTile
              icon={<Users className="h-5 w-5" />}
              title="Member Assignments"
              count={assignmentQuery.data}
              loading={assignmentQuery.isLoading}
              singular="plan"
              plural="plans"
              emptyHint="Nothing assigned yet"
              hint="Active workout & diet plans"
              onClick={() => navigate('/fitness/member-plans')}
            />
          </div>
        )}

        {/* Mode cards */}
        <div className={`grid items-stretch gap-4 ${isAdmin ? 'lg:grid-cols-2' : 'lg:grid-cols-1'}`}>
          {isAdmin && (
            <Card
              role="button"
              tabIndex={0}
              aria-label="Create an AI-generated plan"
              onClick={() => navigate('/fitness/create/ai')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate('/fitness/create/ai');
                }
              }}
              className="group flex h-full cursor-pointer flex-col rounded-2xl border-0 shadow-lg shadow-slate-200/60 ring-1 ring-indigo-100 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-indigo-500/10 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:ring-white/10"
            >
              <CardContent className="flex flex-1 flex-col gap-4 p-5 sm:p-6">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                    <Sparkles className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-bold tracking-tight">AI-Generated Plan</h2>
                      <Badge className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[10px] font-medium text-indigo-700 hover:bg-indigo-100">
                        Recommended
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      A complete, periodised program in under a minute.
                    </p>
                  </div>
                </div>

                <ul className="space-y-2 text-sm text-muted-foreground">
                  {[
                    'Pre-fills member metrics — age, weight, BMI and goals',
                    'Respects your branch equipment and dietary preferences',
                    'Full week layouts for workout or diet, any goal',
                  ].map((line) => (
                    <li key={line} className="flex items-start gap-2">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                        <Check className="h-3 w-3" />
                      </span>
                      <span className="leading-relaxed">{line}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-auto pt-1">
                  <Button className="w-full gap-1 focus:ring-2 focus:ring-indigo-500 focus:outline-none">
                    Start with AI
                    <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="flex h-full flex-col rounded-2xl border-0 shadow-lg shadow-slate-200/60 ring-1 ring-slate-200/70 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10 dark:ring-white/10">
            <CardContent className="flex flex-1 flex-col gap-4 p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200">
                  <Hand className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-bold tracking-tight">Build Manually</h2>
                  <p className="text-sm text-muted-foreground">
                    Full control over every set, rep and macro.
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <ManualTile
                  icon={<Dumbbell className="h-5 w-5" />}
                  title="Workout Plan"
                  hint="Day-by-day sets, reps & rest"
                  onClick={() => navigate('/fitness/create/manual?type=workout')}
                />
                <ManualTile
                  icon={<UtensilsCrossed className="h-5 w-5" />}
                  title="Diet Plan"
                  hint="Meals with live macro tracking"
                  onClick={() => navigate('/fitness/create/manual?type=diet')}
                />
              </div>

              <p className="mt-auto text-xs leading-relaxed text-muted-foreground">
                Start from a blank sheet or duplicate an existing template, then save it back to the
                library for reuse.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Secondary links */}
        <div className="grid gap-2 sm:grid-cols-2">
          <SecondaryLink
            icon={<Library className="h-4 w-4" />}
            label="Browse template library"
            onClick={() => navigate('/fitness/templates')}
          />
          <SecondaryLink
            icon={<Users className="h-4 w-4" />}
            label="View assigned member plans"
            onClick={() => navigate('/fitness/member-plans')}
          />
        </div>
      </div>
    </AppLayout>
  );
}

function PipelineTile({
  icon,
  title,
  count,
  loading,
  singular,
  plural,
  emptyHint,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  loading: boolean;
  singular: string;
  plural: string;
  emptyHint: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={title}
      className="group min-h-[44px] flex-1 rounded-2xl bg-card p-4 text-left shadow-lg shadow-slate-200/50 ring-1 ring-slate-200/70 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-indigo-500/10 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:ring-white/10"
    >
      <div className="mb-2 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{title}</p>
          <p className="truncate text-xs text-muted-foreground">{hint}</p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:text-indigo-600" />
      </div>
      {loading ? (
        <Skeleton className="h-8 w-24 rounded-md" />
      ) : count && count > 0 ? (
        <p className="text-2xl font-bold tabular-nums">
          {count}
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            {count === 1 ? singular : plural}
          </span>
        </p>
      ) : (
        <p className="py-1 text-sm font-medium text-indigo-600">{emptyHint}</p>
      )}
    </button>
  );
}

function ManualTile({
  icon,
  title,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={title}
      className="group flex min-h-[92px] flex-col items-start gap-1.5 rounded-xl bg-muted/40 p-4 text-left ring-1 ring-slate-200/70 transition-all duration-200 hover:bg-muted/70 hover:ring-indigo-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:ring-white/10"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
        {icon}
      </span>
      <span className="text-sm font-semibold">{title}</span>
      <span className="text-xs leading-relaxed text-muted-foreground">{hint}</span>
    </button>
  );
}

function SecondaryLink({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex min-h-[44px] items-center justify-between rounded-xl px-4 py-3 text-sm font-medium text-slate-600 ring-1 ring-slate-200/70 transition-colors hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-slate-300 dark:ring-white/10"
    >
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      <ChevronRight className="h-4 w-4" />
    </button>
  );
}

function PipelineArrow() {
  return (
    <div className="hidden items-center justify-center text-muted-foreground/60 sm:flex">
      <ArrowRight className="h-4 w-4" />
    </div>
  );
}
