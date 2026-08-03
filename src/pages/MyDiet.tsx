import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useMemberData } from '@/hooks/useMemberData';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { normalizeDietPlan } from '@/lib/planNormalizer';
import {
  UtensilsCrossed,
  Calendar,
  AlertCircle,
  User,
  Clock,
  Flame,
  Apple,
  Beef,
  Droplets,
  Wheat,
  Sparkles,
  ChefHat,
  Loader2,
  BookmarkCheck,
  FileText,
  Download,
} from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';

interface MealMacros {
  calories?: number;
  protein?: number;
  carbs?: number;
  fats?: number;
}

interface MealEntry extends MealMacros {
  time?: string;
  name: string;
  items?: Array<string | { food?: string; name?: string; quantity?: string }>;
}

const MEAL_ACCENTS: Record<string, { bg: string; text: string; ring: string }> = {
  breakfast: { bg: 'bg-warning/10', text: 'text-warning', ring: 'ring-warning/20' },
  lunch: { bg: 'bg-success/10', text: 'text-success', ring: 'ring-success/20' },
  dinner: { bg: 'bg-primary/10', text: 'text-primary', ring: 'ring-primary/20' },
  snack: { bg: 'bg-accent/10', text: 'text-accent', ring: 'ring-accent/20' },
};

const accentForMeal = (name: string) => {
  const key = Object.keys(MEAL_ACCENTS).find((k) => name.toLowerCase().includes(k));
  return key ? MEAL_ACCENTS[key] : { bg: 'bg-muted', text: 'text-foreground', ring: 'ring-border' };
};

const renderItem = (item: string | { food?: string; name?: string; quantity?: string }) => {
  if (typeof item === 'string') return item;
  const label = item.food || item.name || '';
  return item.quantity ? `${label} — ${item.quantity}` : label;
};

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
  const { profile } = useAuth();
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
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-success" />
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

  // Adapter: take whatever shape the plan_data is in (legacy `meals[]`,
  // unified `slots[]`, or AI day-keyed) and produce a flat MealEntry[] for
  // this page's existing renderer.
  const rawPlan = dietPlan?.plan_data || {};
  let displayMeals: MealEntry[] = [];
  if (Array.isArray(rawPlan.meals) && rawPlan.meals.length && typeof rawPlan.meals[0]?.name === 'string') {
    displayMeals = rawPlan.meals as MealEntry[];
  } else {
    const normalized = normalizeDietPlan(rawPlan);
    const day0 = normalized.days[0];
    if (day0) {
      displayMeals = day0.slots.map((s) => ({
        name: s.name,
        time: s.time,
        items: s.items.map((it) => ({
          food: it.food,
          quantity: it.quantity,
          calories: it.calories,
          protein: it.protein,
          carbs: it.carbs,
          fats: it.fats,
          // Pass through catalog tagging so badges render below.
          ...(it.catalog_id ? { catalog_id: it.catalog_id } : {}),
          ...(it.unmatched ? { unmatched: it.unmatched } : {}),
        } as any)),
        calories: s.totals.calories,
        protein: s.totals.protein,
        carbs: s.totals.carbs,
        fats: s.totals.fats,
      }));
    }
  }

  const planData: { meals: MealEntry[]; notes?: string; macros?: any; hydration?: string } = {
    meals: displayMeals,
    notes: rawPlan?.notes,
    macros: rawPlan?.macros,
    hydration: rawPlan?.hydration,
  };

  // Derive daily macro totals from meals when explicit totals aren't provided
  const totalMacros = planData.meals.reduce(
    (acc, m) => ({
      calories: acc.calories + (m.calories || 0),
      protein: acc.protein + (m.protein || 0),
      carbs: acc.carbs + (m.carbs || 0),
      fats: acc.fats + (m.fats || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fats: 0 }
  );

  const dailyCalories = dietPlan?.calories_target || totalMacros.calories || 0;
  const trainerName = dietPlan?.trainer_name || (dietPlan ? 'Assigned Trainer' : null);
  const templateName = dietPlan?.template_name || null;

  return (
    <AppLayout>
      <div className="space-y-6 pb-8">
        {/* ===== HERO ===== */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-success via-success to-success/80 p-6 sm:p-8 text-success-foreground shadow-lg shadow-success/20">
          <div className="absolute inset-0 opacity-20 pointer-events-none">
            <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/30 blur-3xl" />
            <div className="absolute -left-8 bottom-0 h-32 w-32 rounded-full bg-white/20 blur-2xl" />
          </div>
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/15 backdrop-blur px-3 py-1 text-xs font-medium">
                <Sparkles className="h-3.5 w-3.5" />
                {dietPlan ? 'Active Plan' : 'No active plan'}
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">My Diet</h1>
              <p className="text-sm sm:text-base text-success-foreground/85 max-w-lg">
                {dietPlan?.name || 'Your personalised nutrition guide, designed to match your goals.'}
              </p>
            </div>
            <Button asChild variant="secondary" size="lg" className="shrink-0 shadow-md">
              <Link to="/my-requests">Request New Plan</Link>
            </Button>
          </div>

          {dietPlan && (
            <div className="relative mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatPill icon={<Flame className="h-4 w-4" />} label="Daily kcal" value={dailyCalories ? `${dailyCalories}` : '—'} />
              <StatPill icon={<Beef className="h-4 w-4" />} label="Protein" value={totalMacros.protein ? `${totalMacros.protein}g` : planData?.macros?.protein || '—'} />
              <StatPill icon={<Wheat className="h-4 w-4" />} label="Carbs" value={totalMacros.carbs ? `${totalMacros.carbs}g` : planData?.macros?.carbs || '—'} />
              <StatPill icon={<Droplets className="h-4 w-4" />} label="Fats" value={totalMacros.fats ? `${totalMacros.fats}g` : planData?.macros?.fat || '—'} />
            </div>
          )}
        </div>

        {dietPlan ? (
          <>
            {/* ===== Plan meta strip ===== */}
            <Card className="rounded-2xl border-border/60 shadow-sm">
              <CardContent className="grid gap-4 p-5 sm:grid-cols-3">
                <MetaItem
                  icon={<Calendar className="h-4 w-4" />}
                  label="Start"
                  value={dietPlan.start_date ? format(new Date(dietPlan.start_date), 'dd MMM yyyy') : '—'}
                />
                <MetaItem
                  icon={<Clock className="h-4 w-4" />}
                  label="End"
                  value={dietPlan.end_date ? format(new Date(dietPlan.end_date), 'dd MMM yyyy') : 'Ongoing'}
                />
                <MetaItem
                  icon={<User className="h-4 w-4" />}
                  label="Trainer"
                  value={trainerName || 'Self-managed'}
                />
              </CardContent>
              <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
                {templateName && (
                  <Badge variant="secondary" className="gap-1.5">
                    <BookmarkCheck className="h-3 w-3" />
                    Created from template: <span className="font-semibold">{templateName}</span>
                  </Badge>
                )}
                <PlanDownloadButton
                  className="ml-auto"
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
              </div>
            </Card>

            {dietPlan.source_kind === 'pdf' && dietPlan.pdf_url ? (
              <Card className="rounded-2xl border-border/60 shadow-sm overflow-hidden">
                <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-success/10 text-success">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{dietPlan.pdf_filename || 'Diet Plan PDF'}</CardTitle>
                      <CardDescription className="text-xs">Tap download if the preview doesn't load</CardDescription>
                    </div>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <a href={dietPlan.pdf_url} target="_blank" rel="noopener noreferrer" download>
                      <Download className="h-4 w-4 mr-1.5" /> Download
                    </a>
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  <iframe
                    src={dietPlan.pdf_url}
                    title={dietPlan.pdf_filename || 'Diet Plan'}
                    className="w-full h-[80vh] border-0"
                  />
                </CardContent>
              </Card>
            ) : (
            <>

            {/* ===== Meal Timeline ===== */}
            {planData?.meals && planData.meals.length > 0 ? (
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold flex items-center gap-2">
                    <ChefHat className="h-5 w-5 text-success" />
                    Daily Meal Schedule
                  </h2>
                  <Badge variant="outline" className="text-xs">
                    {planData.meals.length} meals
                  </Badge>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {planData.meals.map((meal, idx) => {
                    const accent = accentForMeal(meal.name);
                    return (
                      <Card
                        key={idx}
                        className="group relative overflow-hidden rounded-2xl border-border/60 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
                      >
                        <div className={`absolute inset-y-0 left-0 w-1 ${accent.bg}`} />
                        <CardHeader className="pb-3 pl-5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <div className={`flex h-9 w-9 items-center justify-center rounded-full ${accent.bg} ${accent.text} ring-2 ${accent.ring}`}>
                                  <UtensilsCrossed className="h-4 w-4" />
                                </div>
                                <CardTitle className="text-base sm:text-lg leading-tight">
                                  {meal.name}
                                </CardTitle>
                              </div>
                            </div>
                            {meal.time && (
                              <Badge variant="outline" className="font-mono text-xs">
                                {meal.time}
                              </Badge>
                            )}
                          </div>
                        </CardHeader>
                        <CardContent className="pl-5 space-y-3">
                          {meal.items && meal.items.length > 0 && (
                            <ul className="space-y-1.5">
                              {meal.items.map((item, i) => {
                                const isCatalog = typeof item === 'object' && item !== null && (item as any).catalog_id;
                                return (
                                  <li key={i} className="flex gap-2 text-sm items-start">
                                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${accent.bg}`} />
                                    <span className="text-foreground/90 flex-1 min-w-0">{renderItem(item)}</span>
                                    {isCatalog ? (
                                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-success/40 text-success bg-success/5 shrink-0">
                                        Catalog
                                      </Badge>
                                    ) : (
                                      typeof item === 'object' && item !== null && (
                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground shrink-0">
                                          AI
                                        </Badge>
                                      )
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                          {(meal.calories || meal.protein || meal.carbs || meal.fats) && (
                            <div className="flex flex-wrap gap-1.5 pt-2 border-t border-border/60">
                              {meal.calories && (
                                <Badge variant="secondary" className="text-xs gap-1">
                                  <Flame className="h-3 w-3" /> {meal.calories} kcal
                                </Badge>
                              )}
                              {meal.protein && (
                                <Badge variant="secondary" className="text-xs gap-1">
                                  <Beef className="h-3 w-3" /> {meal.protein}g
                                </Badge>
                              )}
                              {meal.carbs && (
                                <Badge variant="secondary" className="text-xs gap-1">
                                  <Wheat className="h-3 w-3" /> {meal.carbs}g
                                </Badge>
                              )}
                              {meal.fats && (
                                <Badge variant="secondary" className="text-xs gap-1">
                                  <Droplets className="h-3 w-3" /> {meal.fats}g
                                </Badge>
                              )}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </section>
            ) : (
              <Card className="rounded-2xl border-dashed">
                <CardContent className="py-12 text-center">
                  <UtensilsCrossed className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Meal details are being prepared by your trainer.</p>
                </CardContent>
              </Card>
            )}

            {planData?.notes && (
              <Card className="rounded-2xl border-border/60 bg-muted/30">
                <CardHeader>
                  <CardTitle className="text-base">Trainer Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground whitespace-pre-line">{planData.notes}</p>
                </CardContent>
              </Card>
            )}
            </>
            )}
          </>
        ) : (
          <Card className="rounded-2xl border-dashed">
            <CardContent className="py-16 text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-success/10">
                <Apple className="h-8 w-8 text-success" />
              </div>
              <h3 className="text-xl font-semibold mb-2">No Active Diet Plan</h3>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                You don't have a personalised diet plan yet. Request one from your trainer to get started.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button asChild size="lg">
                  <Link to="/my-requests">Request Diet Plan</Link>
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
              <Sparkles className="h-4 w-4 text-success" />
              Nutrition Tips
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2.5 sm:grid-cols-2 text-sm text-muted-foreground">
              {[
                'Eat 5-6 small meals throughout the day',
                'Drink at least 8 glasses of water',
                'Include protein in every meal',
                'Limit processed foods and sugary drinks',
                'Eat your last meal 2-3 hours before sleep',
                'Prioritise whole foods over supplements',
              ].map((tip) => (
                <div key={tip} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
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

function StatPill({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/15 backdrop-blur px-3 py-2.5 ring-1 ring-white/20">
      <div className="flex items-center gap-1.5 text-xs font-medium text-success-foreground/80">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-lg sm:text-xl font-bold tracking-tight">{value}</div>
    </div>
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
