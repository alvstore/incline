import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Sparkles,
  Hand,
  Dumbbell,
  UtensilsCrossed,
  ChevronRight,
  Library,
  Users,
  Check,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { FitnessHubTabs } from '@/components/fitness/FitnessHubTabs';
import { fetchPlanTemplates } from '@/services/fitnessService';
import { fetchMealCatalog } from '@/services/mealCatalogService';
import { useBranchContext } from '@/contexts/BranchContext';
import { supabase } from '@/integrations/supabase/client';
import { PipelineTile } from '@/components/fitness/create/PipelineTile';
import { ManualTile } from '@/components/fitness/create/ManualTile';
import { RecentPlansCard } from '@/components/fitness/create/RecentPlansCard';
import { TemplatePickerSheet } from '@/components/fitness/create/TemplatePickerSheet';
import {
  MemberSearchPicker,
  type PickedMember,
} from '@/components/fitness/create/MemberSearchPicker';

export default function CreateModePickerPage() {
  const navigate = useNavigate();
  const { hasAnyRole } = useAuth();
  // AI generation is gated to staff with management privileges (cost + quality control).
  const isAdmin = hasAnyRole(['owner', 'admin', 'manager']);
  const canSeePipeline = hasAnyRole(['owner', 'admin', 'manager']);
  const { effectiveBranchId } = useBranchContext();

  const [member, setMember] = useState<PickedMember | null>(null);
  const [templateSheet, setTemplateSheet] = useState<null | 'workout' | 'diet' | 'any'>(null);

  // Readiness counts for the Catalog → Templates → Assignments strip.
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

  const mealCatalogEmpty = !catalogQuery.isLoading && !catalogQuery.data;

  /** Carries the picked member into whichever editor the user opens next. */
  function withMember(base: string, extra: Record<string, string> = {}) {
    const params = new URLSearchParams(extra);
    if (member) {
      params.set('memberId', member.id);
      params.set('memberName', member.full_name);
      params.set('memberCode', member.member_code);
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <FitnessHubTabs />

        {/* Context bar — one line of orientation, no competing CTAs */}
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Fitness Studio
            </p>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Create a plan
            </h1>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {isAdmin
                ? 'Pick who it is for, then generate with AI, start from a template, or build it by hand.'
                : 'Pick a client, then build a workout or diet plan.'}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => navigate('/fitness/member-plans')}
            className="gap-2 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Users className="h-4 w-4" aria-hidden />
            Assigned plans
          </Button>
        </header>

        {/* Step 0 — who is this for? */}
        <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/60 ring-1 ring-border">
          <CardContent className="p-5 sm:p-6">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">Who is this plan for?</h2>
              <Badge className="rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted">
                Optional
              </Badge>
            </div>
            <MemberSearchPicker value={member} onChange={setMember} label="Member" />
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {member
                ? `${member.full_name} will be pre-filled on the next screen — metrics, goals and history included.`
                : 'Skip this to build a reusable template instead of a member-specific plan.'}
            </p>
          </CardContent>
        </Card>

        {/* Three creation paths */}
        <div className={`grid items-stretch gap-4 ${isAdmin ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
          {isAdmin && (
            <PathCard
              tone="primary"
              icon={<Sparkles className="h-6 w-6" />}
              title="AI-generated"
              badge="Recommended"
              subtitle="A complete, periodised program in under a minute."
              bullets={[
                'Uses member metrics, goals and last plan',
                'Respects branch equipment & diet preferences',
                'Workout or diet, any goal',
              ]}
              cta="Start with AI"
              onClick={() => navigate(withMember('/fitness/create/ai'))}
            />
          )}

          <PathCard
            tone="neutral"
            icon={<Library className="h-6 w-6" />}
            title="From template"
            subtitle="Load a saved plan and adjust what changed."
            bullets={[
              'Fastest path for repeat programming',
              'Edits stay local to this member',
              `${templateQuery.data ?? 0} template${templateQuery.data === 1 ? '' : 's'} in the library`,
            ]}
            cta="Browse templates"
            onClick={() => setTemplateSheet('any')}
          />

          <Card className="flex h-full flex-col rounded-2xl border-0 shadow-lg shadow-slate-200/60 ring-1 ring-border transition-all duration-200 hover:shadow-xl hover:shadow-primary/10">
            <CardContent className="flex flex-1 flex-col gap-4 p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
                  <Hand className="h-6 w-6" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-bold tracking-tight text-foreground">Build manually</h2>
                  <p className="text-sm text-muted-foreground">
                    Full control over every set, rep and macro.
                  </p>
                </div>
              </div>

              <div className="grid gap-3">
                <ManualTile
                  icon={<Dumbbell className="h-5 w-5" />}
                  title="Workout plan"
                  hint="Day-by-day sets, reps & rest"
                  onClick={() => navigate(withMember('/fitness/create/manual', { type: 'workout' }))}
                  secondaryLabel="Start from template"
                  onSecondary={() => setTemplateSheet('workout')}
                />
                <ManualTile
                  icon={<UtensilsCrossed className="h-5 w-5" />}
                  title="Diet plan"
                  hint={
                    mealCatalogEmpty
                      ? 'Needs meals in the catalog first'
                      : 'Meals with live macro tracking'
                  }
                  onClick={() => navigate(withMember('/fitness/create/manual', { type: 'diet' }))}
                  secondaryLabel="Start from template"
                  onSecondary={() => setTemplateSheet('diet')}
                />
              </div>

              {canSeePipeline && mealCatalogEmpty && (
                <div className="mt-auto flex items-start gap-2 rounded-xl bg-warning/10 p-3 text-xs leading-relaxed text-warning-foreground ring-1 ring-warning/30">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                  <span>
                    Your meal catalog is empty, so diet plans will generate without your gym's
                    foods.{' '}
                    <button
                      onClick={() => navigate('/fitness/meal-catalog')}
                      className="cursor-pointer font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Add meals
                    </button>
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Readiness strip */}
        {canSeePipeline && (
          <section aria-label="Plan pipeline readiness" className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Pipeline readiness
            </h2>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
              <PipelineTile
                step={1}
                icon={<UtensilsCrossed className="h-5 w-5" />}
                title="Meal catalog"
                count={catalogQuery.data}
                loading={catalogQuery.isLoading}
                singular="meal"
                plural="meals"
                emptyHint="Add meals to unlock diet plans"
                action="ingredients & macros"
                blocking
                onClick={() => navigate('/fitness/meal-catalog')}
              />
              <PipelineArrow />
              <PipelineTile
                step={2}
                icon={<Library className="h-5 w-5" />}
                title="Plan templates"
                count={templateQuery.data}
                loading={templateQuery.isLoading}
                singular="template"
                plural="templates"
                emptyHint="Save your first template"
                action="reusable programs"
                onClick={() => navigate('/fitness/templates')}
              />
              <PipelineArrow />
              <PipelineTile
                step={3}
                icon={<Users className="h-5 w-5" />}
                title="Member assignments"
                count={assignmentQuery.data}
                loading={assignmentQuery.isLoading}
                singular="plan"
                plural="plans"
                emptyHint="Nothing assigned yet"
                action="active member plans"
                onClick={() => navigate('/fitness/member-plans')}
              />
            </div>
          </section>
        )}

        {/* Recent activity */}
        {canSeePipeline && <RecentPlansCard />}
      </div>

      <TemplatePickerSheet
        open={templateSheet !== null}
        onOpenChange={(o) => setTemplateSheet(o ? templateSheet : null)}
        planType={templateSheet && templateSheet !== 'any' ? templateSheet : undefined}
        member={member}
      />
    </AppLayout>
  );
}

function PathCard({
  tone,
  icon,
  title,
  badge,
  subtitle,
  bullets,
  cta,
  onClick,
}: {
  tone: 'primary' | 'neutral';
  icon: React.ReactNode;
  title: string;
  badge?: string;
  subtitle: string;
  bullets: string[];
  cta: string;
  onClick: () => void;
}) {
  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={cta}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={`group flex h-full cursor-pointer flex-col rounded-2xl border-0 shadow-lg shadow-slate-200/60 ring-1 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
        tone === 'primary' ? 'ring-primary/20' : 'ring-border'
      }`}
    >
      <CardContent className="flex flex-1 flex-col gap-4 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${
              tone === 'primary' ? 'bg-primary/10 text-primary' : 'bg-muted text-foreground'
            }`}
            aria-hidden
          >
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight text-foreground">{title}</h2>
              {badge && (
                <Badge className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10">
                  {badge}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>

        <ul className="space-y-2 text-sm text-muted-foreground">
          {bullets.map((line) => (
            <li key={line} className="flex items-start gap-2">
              <span
                className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600"
                aria-hidden
              >
                <Check className="h-3 w-3" />
              </span>
              <span className="leading-relaxed">{line}</span>
            </li>
          ))}
        </ul>

        <div className="mt-auto pt-1">
          <Button
            variant={tone === 'primary' ? 'default' : 'outline'}
            className="w-full gap-1 focus-visible:ring-2 focus-visible:ring-ring"
            tabIndex={-1}
          >
            {cta}
            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PipelineArrow() {
  return (
    <div className="hidden items-center justify-center text-muted-foreground/60 sm:flex" aria-hidden>
      <ArrowRight className="h-4 w-4" />
    </div>
  );
}
