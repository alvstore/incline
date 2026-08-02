import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getPlanTemplate } from '@/services/fitnessService';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Sparkles, Dumbbell, UtensilsCrossed, User, Users } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { CreateFlowLayout } from '@/components/fitness/create/CreateFlowLayout';
import { MemberSearchPicker, PickedMember } from '@/components/fitness/create/MemberSearchPicker';
import { MemberProfileCard, MemberProfileOverrides } from '@/components/fitness/create/MemberProfileCard';
import { useGenerateFitnessPlan } from '@/hooks/usePTPackages';
import { newDraftId, saveDraft } from '@/lib/planDraft';
import { fetchMealCatalog } from '@/services/mealCatalogService';
import { fetchOperationalEquipmentLite } from '@/services/equipmentService';
import { fetchMemberAssignments } from '@/services/fitnessService';
import { useQuery } from '@tanstack/react-query';
import { useBranchContext } from '@/contexts/BranchContext';
import { Badge } from '@/components/ui/badge';
import { Wrench, History } from 'lucide-react';
import { GenerationProgress } from '@/components/fitness/create/GenerationProgress';

export default function CreateAIPage() {
  const navigate = useNavigate();
  const generate = useGenerateFitnessPlan();
  const [searchParams] = useSearchParams();
  const templateId = searchParams.get('template');

  const [type, setType] = useState<'workout' | 'diet'>('workout');
  const [mode, setMode] = useState<'member' | 'audience'>('member');
  const [member, setMember] = useState<PickedMember | null>(null);
  const [profile, setProfile] = useState<MemberProfileOverrides>({});
  const [planName, setPlanName] = useState('');
  const [goal, setGoal] = useState('');
  const [durationWeeks, setDurationWeeks] = useState(4);
  const [daysPerWeek, setDaysPerWeek] = useState<number>(4);
  const [rotationIntervalDays, setRotationIntervalDays] = useState<number>(0);
  const [caloriesTarget, setCaloriesTarget] = useState('');
  const [proteinTarget, setProteinTarget] = useState('');
  const [carbsTarget, setCarbsTarget] = useState('');
  const [fatTarget, setFatTarget] = useState('');
  const [specialNotes, setSpecialNotes] = useState('');
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);


  // Audience fields (only used when mode === 'audience')
  const [audAgeMin, setAudAgeMin] = useState<string>('18');
  const [audAgeMax, setAudAgeMax] = useState<string>('45');
  const [audGender, setAudGender] = useState<'any' | 'male' | 'female'>('any');
  const [audExperience, setAudExperience] = useState<string[]>(['beginner']);
  const [audWeightMin, setAudWeightMin] = useState<string>('');
  const [audWeightMax, setAudWeightMax] = useState<string>('');
  // Days/week is now shared between member + audience modes (see `daysPerWeek`).
  const [audDietaryType, setAudDietaryType] = useState<string>('');
  const [audCuisine, setAudCuisine] = useState<string>('');
  const [audEquipmentHint, setAudEquipmentHint] = useState<string>('');

  const { effectiveBranchId } = useBranchContext();

  // Pull catalog meals matching the selected diet/cuisine so we can pass them
  // to the AI as the gym's preferred food list. Cached because the catalog
  // doesn't change often within a session.
  const dietaryPrefForAI = mode === 'audience' ? audDietaryType : profile.dietary_preference;
  const cuisineForAI = mode === 'audience' ? audCuisine : profile.cuisine;

  const { data: catalogMeals = [] } = useQuery({
    queryKey: ['meal-catalog-ai', dietaryPrefForAI, cuisineForAI, effectiveBranchId],
    queryFn: () =>
      fetchMealCatalog({
        dietaryType: dietaryPrefForAI || null,
        cuisine: cuisineForAI || null,
        branchId: effectiveBranchId ?? null,
      }),
    enabled: type === 'diet' && !!dietaryPrefForAI && !!cuisineForAI,
  });

  // Branch operational equipment — drives workout AI to use real machines.
  const { data: branchEquipment = [] } = useQuery({
    queryKey: ['branch-equipment-lite', effectiveBranchId],
    queryFn: () => fetchOperationalEquipmentLite(effectiveBranchId ?? null),
    enabled: type === 'workout' && !!effectiveBranchId,
    staleTime: 5 * 60 * 1000,
  });

  // Last plan summary for this member (so AI can progress, not repeat).
  const { data: lastPlans = [] } = useQuery({
    queryKey: ['member-last-plans', member?.id, type],
    queryFn: async () => {
      if (!member?.id) return [];
      const all = await fetchMemberAssignments(effectiveBranchId ?? null);
      return all.filter((p) => p.member_id === member.id && p.plan_type === type).slice(0, 1);
    },
    enabled: !!member?.id,
  });
  const lastPlan = lastPlans[0];

  function buildPreviousPlanContext(): string | undefined {
    if (!lastPlan) return undefined;
    const parts = [
      `Previous ${lastPlan.plan_type} plan: "${lastPlan.plan_name}"`,
      lastPlan.valid_from && `Started ${lastPlan.valid_from}`,
      lastPlan.valid_until && `Valid until ${lastPlan.valid_until}`,
      lastPlan.description && `Notes: ${lastPlan.description}`,
    ].filter(Boolean);
    return parts.join(' · ');
  }

  useEffect(() => {
    if (!templateId) return;
    let cancelled = false;
    (async () => {
      try {
        const tpl = await getPlanTemplate(templateId);
        if (cancelled) return;
        if (!tpl) { toast.error('Template not found'); return; }
        setType(tpl.type);
        setPlanName(tpl.name);
        if (tpl.goal) setGoal(tpl.goal);
        const content: any = tpl.content || {};
        if (content.dailyCalories) setCaloriesTarget(String(content.dailyCalories));
        const macroNum = (v: any) => parseInt(String(v ?? '').replace(/\D/g, ''), 10);
        if (content.macros?.protein) setProteinTarget(String(macroNum(content.macros.protein) || ''));
        if (content.macros?.carbs) setCarbsTarget(String(macroNum(content.macros.carbs) || ''));
        if (content.macros?.fat) setFatTarget(String(macroNum(content.macros.fat) || ''));
        if (tpl.description) setSpecialNotes(tpl.description);
        setProfile(prev => ({
          ...prev,
          fitness_level: tpl.difficulty || prev.fitness_level,
          fitness_goals: tpl.goal || prev.fitness_goals,
          dietary_preference: content.dietaryType || prev.dietary_preference,
          cuisine: content.cuisine || prev.cuisine,
        }));
        toast.success(`Loaded template: ${tpl.name}`);
      } catch (err: any) {
        toast.error(err?.message || 'Failed to load template');
      }
    })();
    return () => { cancelled = true; };
  }, [templateId]);

  const dietRequirementsMet = type !== 'diet'
    || (mode === 'member' ? (!!profile.dietary_preference && !!profile.cuisine) : (!!audDietaryType && !!audCuisine));

  const audienceRequirementsMet = mode !== 'audience' || (
    !!audAgeMin && !!audAgeMax && !!audGender && audExperience.length > 0
  );

  const ageBandMid = (() => {
    const lo = parseInt(audAgeMin) || 0;
    const hi = parseInt(audAgeMax) || 0;
    if (!lo && !hi) return undefined;
    return Math.round((lo + hi) / 2) || undefined;
  })();

  const handleGenerate = async () => {
    if (!planName.trim()) { toast.error('Please enter a plan name'); return; }
    if (mode === 'member' && !member) { toast.error('Please select a member'); return; }
    if (mode === 'audience' && !audienceRequirementsMet) {
      toast.error('Please complete the audience: age range, gender, experience');
      return;
    }
    if (type === 'diet' && !dietRequirementsMet) {
      toast.error(mode === 'member'
        ? 'Please select dietary type and cuisine in the member profile'
        : 'Please select dietary type and cuisine for the audience');
      return;
    }

    setGenError(null);
    setProgressMsg('running');
    const controller = new AbortController();
    abortRef.current = controller;
    // No client-side timeout: generation runs as a background job on the
    // server and we follow its progress, so the browser can never abort it.

    try {
      const memberInfo = mode === 'member' ? {
          name: planName,
          age: profile.age ? parseInt(profile.age) : undefined,
          gender: profile.gender,
          height: profile.height ? parseFloat(profile.height) : undefined,
          weight: profile.weight ? parseFloat(profile.weight) : undefined,
          fitnessGoals: [goal, profile.fitness_goals].filter(Boolean).join('; ') || undefined,
          healthConditions: profile.health_conditions || undefined,
          experience: profile.fitness_level || 'intermediate',
          preferences: [
            type === 'diet' && profile.dietary_preference && `diet: ${profile.dietary_preference}`,
            type === 'diet' && profile.cuisine && `cuisine: ${profile.cuisine}`,
            type === 'diet' && profile.allergies && `allergies: ${profile.allergies}`,
            profile.equipment && `equipment: ${profile.equipment}`,
            type === 'workout' && profile.workout_activities && profile.workout_activities.length > 0
              && `include activities: ${profile.workout_activities.join(', ')} (structure each session warm-up → main → cool-down)`,
            specialNotes,
          ].filter(Boolean).join('; ') || undefined,
        } : {
          // Synthetic "audience profile" — no real member, just band metadata.
          name: planName,
          age: ageBandMid,
          gender: audGender === 'any' ? undefined : audGender,
          weight: audWeightMin && audWeightMax
            ? Math.round((parseFloat(audWeightMin) + parseFloat(audWeightMax)) / 2)
            : undefined,
          fitnessGoals: goal || undefined,
          experience: audExperience[0] || 'beginner',
          preferences: [
            `Common (no-PT) plan targeting ${audAgeMin}-${audAgeMax}y, gender: ${audGender}, experience: ${audExperience.join('/')}`,
            type === 'workout' && daysPerWeek && `${daysPerWeek} days/week`,
            audWeightMin && audWeightMax && `weight band ${audWeightMin}-${audWeightMax}kg`,
            type === 'diet' && audDietaryType && `diet: ${audDietaryType}`,
            type === 'diet' && audCuisine && `cuisine: ${audCuisine}`,
            type === 'workout' && audEquipmentHint && `equipment: ${audEquipmentHint}`,
            specialNotes,
          ].filter(Boolean).join('; ') || undefined,
        };

      const plan = await generate.mutateAsync({
        type,
        memberInfo,
        options: {
          durationWeeks,
          daysPerWeek: type === 'workout' ? daysPerWeek : undefined,
          rotationIntervalDays: type === 'workout' ? rotationIntervalDays : undefined,
          caloriesTarget: caloriesTarget ? parseInt(caloriesTarget) : undefined,
          availableMeals: type === 'diet'
            ? catalogMeals.slice(0, 80).map((m) => ({
                id: m.id,
                name: m.name,
                meal_type: m.meal_type,
                calories: m.calories,
                protein: m.protein,
                carbs: m.carbs,
                fats: m.fats,
                default_quantity: m.default_quantity,
              }))
            : undefined,
          availableEquipment: type === 'workout' ? branchEquipment.slice(0, 100) : undefined,
          previousPlanContext: mode === 'member' ? buildPreviousPlanContext() : undefined,
          signal: controller.signal,
          onStage: (stage: string) => setProgressMsg(stage),
        },
      });

      // Guard: never let a truncated/partial week reach Preview or Save.
      if (type === 'workout') {
        const week1Days: any[] = (plan as any)?.weeks?.[0]?.days ?? [];
        const trainingDays = week1Days.filter(
          (d) => Array.isArray(d?.exercises) && d.exercises.length > 0,
        );
        if (daysPerWeek && trainingDays.length !== daysPerWeek) {
          throw new Error(
            `AI returned only ${trainingDays.length} of ${daysPerWeek} training days — reduce weeks/rotation and generate again.`,
          );
        }
        const thin = trainingDays.find((d) => d.exercises.length < 4);
        if (thin) {
          throw new Error(
            `AI returned only ${thin.exercises.length} exercise(s) on ${thin.day} — generate again.`,
          );
        }
      }

      const matchSummary = (plan as any)?.catalogMatchSummary;

      if (type === 'diet' && matchSummary?.total) {
        const { matched, total } = matchSummary;
        if (matched < total) {
          toast.message(`AI used catalog for ${matched}/${total} meals — review the rest before assigning`);
        }
      }

      setProgressMsg(null);
      abortRef.current = null;

      const id = newDraftId();
      saveDraft({
        id,
        source: 'ai',
        templateId: templateId || undefined,
        type,
        name: plan.name || planName,
        description: plan.description,
        goal: plan.goal || goal,
        difficulty: plan.difficulty || (mode === 'member' ? profile.fitness_level : audExperience[0]),
        caloriesTarget: caloriesTarget ? parseInt(caloriesTarget) : plan.dailyCalories,
        memberId: mode === 'member' ? member!.id : undefined,
        memberName: mode === 'member' ? member!.full_name : undefined,
        memberCode: mode === 'member' ? member!.member_code : undefined,
        memberProfile: mode === 'member' ? profile : undefined,
        dietaryType: mode === 'member' ? profile.dietary_preference : audDietaryType,
        cuisine: mode === 'member' ? profile.cuisine : audCuisine,
        isCommon: mode === 'audience',
        audience: mode === 'audience' ? {
          target_age_min: parseInt(audAgeMin) || null,
          target_age_max: parseInt(audAgeMax) || null,
          target_gender: audGender,
          target_experience: audExperience,
          target_weight_min_kg: audWeightMin ? parseFloat(audWeightMin) : null,
          target_weight_max_kg: audWeightMax ? parseFloat(audWeightMax) : null,
          target_goal: goal || null,
          duration_weeks: durationWeeks,
          days_per_week: daysPerWeek || null,
        } : undefined,
        daysPerWeek: type === 'workout' ? daysPerWeek : undefined,
        rotationIntervalDays: type === 'workout' ? rotationIntervalDays : undefined,
        content: plan,
        createdAt: new Date().toISOString(),
      });

      toast.success('Plan generated!');
      navigate(`/fitness/preview/${id}`);
    } catch (err: any) {
      setProgressMsg(null);
      abortRef.current = null;
      const aborted = err?.name === 'AbortError' || /abort/i.test(err?.message || '');
      const msg = aborted
        ? 'Generation cancelled or timed out. Try a shorter plan (fewer weeks or no rotation).'
        : err?.message || 'Failed to generate plan';
      setGenError(msg);
      toast.error(msg);
    }
  };

  const cancelGeneration = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };


  return (
    <CreateFlowLayout
      title="AI Plan Generation"
      subtitle={mode === 'audience' ? 'Generate a Common (no-PT) plan for an audience segment' : 'Personalized programs powered by member metrics'}
      step="build"
      buildLabel="Generate"
      backTo="/fitness/create"
    >
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Plan Setup</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Tabs value={type} onValueChange={(v) => setType(v as any)}>
                  <TabsList className="grid grid-cols-2 w-full sm:w-fit">
                    <TabsTrigger value="workout" className="gap-1.5">
                      <Dumbbell className="h-4 w-4" /> Workout
                    </TabsTrigger>
                    <TabsTrigger value="diet" className="gap-1.5">
                      <UtensilsCrossed className="h-4 w-4" /> Diet
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
                  <TabsList className="grid grid-cols-2 w-full sm:w-fit">
                    <TabsTrigger value="member" className="gap-1.5">
                      <User className="h-4 w-4" /> Member-specific
                    </TabsTrigger>
                    <TabsTrigger value="audience" className="gap-1.5">
                      <Users className="h-4 w-4" /> Common (no PT)
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {mode === 'member' ? (
                <MemberSearchPicker value={member} onChange={(m) => { setMember(m); setProfile({}); }} required />
              ) : (
                <Card className="border-dashed bg-muted/30">
                  <CardContent className="p-4 space-y-4">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Users className="h-4 w-4 text-primary" />
                      Audience targeting
                      <Badge variant="outline" className="ml-1 text-[10px]">Required</Badge>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-2">
                        <Label>Age min *</Label>
                        <Input type="number" min={10} max={90} value={audAgeMin} onChange={(e) => setAudAgeMin(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>Age max *</Label>
                        <Input type="number" min={10} max={90} value={audAgeMax} onChange={(e) => setAudAgeMax(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>Gender *</Label>
                        <Select value={audGender} onValueChange={(v) => setAudGender(v as any)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="any">Any</SelectItem>
                            <SelectItem value="male">Male</SelectItem>
                            <SelectItem value="female">Female</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Experience *</Label>
                      <div className="flex flex-wrap gap-3">
                        {(['beginner', 'intermediate', 'advanced'] as const).map((lvl) => (
                          <label key={lvl} className="flex items-center gap-2 text-sm cursor-pointer">
                            <Checkbox
                              checked={audExperience.includes(lvl)}
                              onCheckedChange={(c) => {
                                setAudExperience((prev) => c
                                  ? Array.from(new Set([...prev, lvl]))
                                  : prev.filter((x) => x !== lvl));
                              }}
                            />
                            <span className="capitalize">{lvl}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-2">
                        <Label>Weight min (kg)</Label>
                        <Input type="number" placeholder="optional" value={audWeightMin} onChange={(e) => setAudWeightMin(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>Weight max (kg)</Label>
                        <Input type="number" placeholder="optional" value={audWeightMax} onChange={(e) => setAudWeightMax(e.target.value)} />
                      </div>
                      {/* Days/week now lives in the main "Schedule & Rotation" row below — single source of truth. */}
                    </div>

                    {type === 'diet' && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Dietary type *</Label>
                          <Select value={audDietaryType} onValueChange={setAudDietaryType}>
                            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="vegetarian">Vegetarian</SelectItem>
                              <SelectItem value="vegan">Vegan</SelectItem>
                              <SelectItem value="non_vegetarian">Non-Vegetarian</SelectItem>
                              <SelectItem value="eggetarian">Eggetarian</SelectItem>
                              <SelectItem value="jain">Jain</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Cuisine *</Label>
                          <Select value={audCuisine} onValueChange={setAudCuisine}>
                            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="indian">Indian</SelectItem>
                              <SelectItem value="south_indian">South Indian</SelectItem>
                              <SelectItem value="north_indian">North Indian</SelectItem>
                              <SelectItem value="continental">Continental</SelectItem>
                              <SelectItem value="mediterranean">Mediterranean</SelectItem>
                              <SelectItem value="asian">Asian</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}

                    {type === 'workout' && (
                      <div className="space-y-2">
                        <Label>Equipment hint</Label>
                        <Input
                          placeholder="e.g. dumbbells + bench (or leave blank to use branch equipment)"
                          value={audEquipmentHint}
                          onChange={(e) => setAudEquipmentHint(e.target.value)}
                        />
                      </div>
                    )}

                    <p className="text-xs text-muted-foreground">
                      This generates a reusable Common Plan. Save it as a template from the preview screen so the right
                      members are auto-matched on their dashboard.
                    </p>
                  </CardContent>
                </Card>
              )}

              <div className="space-y-2">
                <Label>Plan Name *</Label>
                <Input
                  placeholder={type === 'workout' ? 'e.g. 4-week strength block' : 'e.g. Cutting diet — phase 1'}
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                />
              </div>

              <div className={type === 'workout' ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-4' : 'grid gap-3 sm:grid-cols-2'}>
                <div className="space-y-2">
                  <Label>Primary Goal</Label>
                  <Select value={goal} onValueChange={setGoal}>
                    <SelectTrigger><SelectValue placeholder="Select a goal" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Weight Loss">Weight Loss</SelectItem>
                      <SelectItem value="Muscle Gain">Muscle Gain</SelectItem>
                      <SelectItem value="General Fitness">General Fitness</SelectItem>
                      <SelectItem value="Endurance">Endurance</SelectItem>
                      <SelectItem value="Flexibility">Flexibility</SelectItem>
                      <SelectItem value="Recomposition">Recomposition</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {type === 'workout' ? (
                  <>
                    <div className="space-y-2">
                      <Label>Days / week</Label>
                      <Input
                        type="number"
                        min={1}
                        max={7}
                        value={daysPerWeek}
                        onChange={(e) => setDaysPerWeek(Math.max(1, Math.min(7, parseInt(e.target.value) || 4)))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Duration (weeks)</Label>
                      <Input
                        type="number"
                        min={1}
                        max={24}
                        value={durationWeeks}
                        onChange={(e) => setDurationWeeks(parseInt(e.target.value) || 4)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Rotate plan every</Label>
                      <Select
                        value={String(rotationIntervalDays)}
                        onValueChange={(v) => setRotationIntervalDays(parseInt(v) || 0)}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">Off (no rotation)</SelectItem>
                          <SelectItem value="7">7 days</SelectItem>
                          <SelectItem value="10">10 days</SelectItem>
                          <SelectItem value="14">14 days</SelectItem>
                          <SelectItem value="21">21 days</SelectItem>
                          <SelectItem value="30">30 days</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    <Label>Daily Calorie Target</Label>
                    <Input
                      type="number"
                      placeholder="e.g. 2000"
                      value={caloriesTarget}
                      onChange={(e) => setCaloriesTarget(e.target.value)}
                    />
                  </div>
                )}
              </div>

              {type === 'workout' && rotationIntervalDays > 0 && (
                <p className="text-xs text-muted-foreground -mt-1 ml-0.5">
                  AI will generate multiple exercise variants and rotate them every {rotationIntervalDays} days so members never repeat the exact same session back-to-back.
                </p>
              )}

              {type === 'diet' && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Protein (g)</Label>
                    <Input type="number" value={proteinTarget} onChange={(e) => setProteinTarget(e.target.value)} placeholder="e.g. 150" />
                  </div>
                  <div className="space-y-2">
                    <Label>Carbs (g)</Label>
                    <Input type="number" value={carbsTarget} onChange={(e) => setCarbsTarget(e.target.value)} placeholder="e.g. 200" />
                  </div>
                  <div className="space-y-2">
                    <Label>Fats (g)</Label>
                    <Input type="number" value={fatTarget} onChange={(e) => setFatTarget(e.target.value)} placeholder="e.g. 65" />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>Special Notes</Label>
                <Textarea
                  rows={3}
                  placeholder="Anything else the AI should know — schedule, time available, equipment, recent injuries…"
                  value={specialNotes}
                  onChange={(e) => setSpecialNotes(e.target.value)}
                />
              </div>

              <Button
                onClick={handleGenerate}
                disabled={(mode === 'member' && !member) || !audienceRequirementsMet || generate.isPending || !dietRequirementsMet || !planName.trim()}
                className="w-full"
                size="lg"
              >
                {generate.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…</>
                ) : (
                  <><Sparkles className="mr-2 h-4 w-4" /> Generate Plan</>
                )}
              </Button>

              {progressMsg && generate.isPending && (
                <GenerationProgress
                  type={type}
                  stage={progressMsg && progressMsg !== 'running' ? progressMsg : undefined}
                  onCancel={cancelGeneration}
                />
              )}

              {genError && !generate.isPending && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                  <p className="text-sm text-destructive">{genError}</p>
                  {durationWeeks > 2 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => { setDurationWeeks(2); setGenError(null); }}
                    >
                      Try a 2-week plan instead
                    </Button>
                  )}
                </div>
              )}


              {type === 'diet' && !dietRequirementsMet && member && (
                <p className="text-xs text-warning">
                  Diet plans require both <strong>dietary preference</strong> and <strong>cuisine</strong>. Set them
                  via "Edit profile data for this plan" on the right.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {mode === 'audience' ? (
            <Card>
              <CardContent className="py-4 px-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Users className="h-4 w-4 text-primary" /> Audience summary
                </div>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li>Age: <span className="text-foreground font-medium">{audAgeMin || '—'}–{audAgeMax || '—'}y</span></li>
                  <li>Gender: <span className="text-foreground font-medium capitalize">{audGender}</span></li>
                  <li>Experience: <span className="text-foreground font-medium">{audExperience.join(', ') || '—'}</span></li>
                  {(audWeightMin || audWeightMax) && (
                    <li>Weight band: <span className="text-foreground font-medium">{audWeightMin || '—'}–{audWeightMax || '—'} kg</span></li>
                  )}
                  {goal && <li>Goal: <span className="text-foreground font-medium">{goal}</span></li>}
                  {type === 'workout' && <li>Days/week: <span className="text-foreground font-medium">{daysPerWeek || '—'}</span>{rotationIntervalDays > 0 && <> · Rotates every <span className="text-foreground font-medium">{rotationIntervalDays}d</span></>}</li>}
                </ul>
                <p className="text-[11px] text-muted-foreground pt-2 border-t">
                  After previewing, click <strong>Save as template</strong> to publish it as a Common Plan and auto-match
                  qualifying members.
                </p>
              </CardContent>
            </Card>
          ) : member ? (
            <>
              <MemberProfileCard memberId={member.id} value={profile} onChange={setProfile} planType={type} />

              {type === 'workout' && (
                <Card>
                  <CardContent className="py-3 px-4 flex items-start gap-2.5">
                    <Wrench className="h-4 w-4 mt-0.5 text-primary" />
                    <div className="flex-1 text-xs">
                      <div className="font-medium text-foreground">
                        Branch equipment ({branchEquipment.length} machines)
                      </div>
                      <p className="text-muted-foreground mt-0.5">
                        AI will prefer these machines when prescribing exercises.
                      </p>
                      {branchEquipment.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {branchEquipment.slice(0, 8).map((e) => (
                            <Badge key={e.name} variant="secondary" className="text-[10px]">
                              {e.name}
                            </Badge>
                          ))}
                          {branchEquipment.length > 8 && (
                            <Badge variant="outline" className="text-[10px]">
                              +{branchEquipment.length - 8} more
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {lastPlan && (
                <Card>
                  <CardContent className="py-3 px-4 flex items-start gap-2.5">
                    <History className="h-4 w-4 mt-0.5 text-primary" />
                    <div className="flex-1 text-xs">
                      <div className="font-medium text-foreground">Previous plan</div>
                      <p className="text-muted-foreground mt-0.5 truncate">
                        {lastPlan.plan_name} · {lastPlan.valid_from || '—'} → {lastPlan.valid_until || '—'}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        AI will use this as context to progress (not repeat) the program.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card className="border-dashed">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Select a member to load their profile and metrics here.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </CreateFlowLayout>
  );
}
