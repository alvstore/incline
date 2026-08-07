import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useNavigate, useSearchParams } from 'react-router-dom';
import { getPlanTemplate, updatePlanTemplate } from '@/services/fitnessService';
import type { DietPlanContent } from '@/types/fitnessPlan';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Plus,
  Trash2,
  UtensilsCrossed,
  Clock,
  AlertTriangle,
  ArrowLeftRight,
  Link as LinkIcon,
  Copy,
  Paperclip,
  ChevronDown,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Calculator,
} from 'lucide-react';
import { toast } from 'sonner';
import { MemberSearchPicker, PickedMember } from '@/components/fitness/create/MemberSearchPicker';
import { DayRail } from '@/components/fitness/create/DayRail';

import { newDraftId, saveDraft, loadDraft } from '@/lib/planDraft';
import { cn } from '@/lib/utils';
import { VideoAttachmentControl } from '@/components/fitness/VideoAttachmentControl';
import { MealSwapModal } from '@/components/fitness/MealSwapModal';
import { MealCatalogEntry, MealType, fetchMealCatalog } from '@/services/mealCatalogService';
import {
  DEFAULT_SLOTS,
  EMPTY_ITEM,
  DietDay,
  DietItem,
  DietSlot,
  dayTotals,
  inferDietMeta,
  normalizeDietContent,
  serializeDietDays,
  slotTotals,
  weeklyAverageTotals,
} from '@/lib/fitness/dietContent';


const SLOT_TO_MEAL_TYPE = (name: string): MealType | undefined => {
  const k = name.toLowerCase();
  if (k.includes('pre') && k.includes('workout')) return 'pre_workout';
  if ((k.includes('post') || k.includes('after')) && k.includes('workout')) return 'post_workout';
  if (k.includes('breakfast')) return 'breakfast';
  if (k.includes('lunch')) return 'lunch';
  if (k.includes('dinner')) return 'dinner';
  if (k.includes('snack') || k.includes('mid') || k.includes('bedtime')) return 'snack';
  return undefined;
};

/** Extra meal slots a trainer can append to any day (beyond the 5 defaults). */
const SLOT_PRESETS: { name: string; time: string }[] = [
  { name: 'Pre-Workout', time: '06:00' },
  { name: 'Post-Workout', time: '09:00' },
  { name: 'Mid-Morning Snack', time: '10:30' },
  { name: 'Evening Snack', time: '16:30' },
  { name: 'Bedtime', time: '22:00' },
];

const singleDay = (): DietDay[] => [{ day: 'Daily', slots: DEFAULT_SLOTS.map((s) => ({ ...s, items: [] })) }];

interface Props {
  onMetaChange?: (meta: { canSubmit: boolean; submit: () => void; primaryLabel: string }) => void;
}

export default function ManualDietEditor({ onMetaChange }: Props) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const templateId = searchParams.get('template');
  const editMode = searchParams.get('edit') === '1' && !!templateId;
  const draftId = searchParams.get('draft');

  const [planName, setPlanName] = useState('');
  const [description, setDescription] = useState('');
  // Pre-selected on the create landing page and carried through the URL.
  const prefillMemberId = searchParams.get('memberId');
  const [member, setMember] = useState<PickedMember | null>(
    prefillMemberId
      ? {
          id: prefillMemberId,
          full_name: searchParams.get('memberName') || '',
          member_code: searchParams.get('memberCode') || '',
        }
      : null,
  );

  const [dietaryType, setDietaryType] = useState('');
  const [cuisine, setCuisine] = useState('');
  const [calTarget, setCalTarget] = useState(2000);
  const [proteinTarget, setProteinTarget] = useState(120);
  const [carbsTarget, setCarbsTarget] = useState(220);
  const [fatTarget, setFatTarget] = useState(60);

  const [days, setDays] = useState<DietDay[]>(singleDay);
  const [weekly, setWeekly] = useState(false);
  const [activeDay, setActiveDay] = useState(0);
  const [macroScope, setMacroScope] = useState<'day' | 'week'>('day');
  const [swapSlotIdx, setSwapSlotIdx] = useState<number | null>(null);
  const [openAttach, setOpenAttach] = useState<Record<number, boolean>>({});
  // 'loading' blocks saving so an unloaded template can never overwrite a good one.
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    templateId ? 'loading' : 'idle',
  );
  const hydratedRef = useRef(false);

  const macroNum = (v: unknown) => parseInt(String(v ?? '').replace(/\D/g, ''), 10);

  const hydrateFromContent = useCallback((content: any) => {
    if (content?.dietaryType) setDietaryType(content.dietaryType);
    if (content?.cuisine) setCuisine(content.cuisine);
    if (content?.dailyCalories) setCalTarget(Number(content.dailyCalories) || 2000);
    if (content?.macros?.protein) setProteinTarget(macroNum(content.macros.protein) || 120);
    if (content?.macros?.carbs) setCarbsTarget(macroNum(content.macros.carbs) || 220);
    if (content?.macros?.fat) setFatTarget(macroNum(content.macros.fat) || 60);

    const normalized = normalizeDietContent(content);
    if (normalized) {
      setDays(normalized.days);
      setWeekly(normalized.weekly);
      setActiveDay(0);
      setMacroScope(normalized.weekly ? 'week' : 'day');
      // Older content often lacks these — infer instead of leaving required selects blank.
      const inferred = inferDietMeta(normalized.days);
      if (!content?.dietaryType) setDietaryType(inferred.dietaryType);
      if (!content?.cuisine) setCuisine(inferred.cuisine);
      if (!content?.dailyCalories) {
        const avg = weeklyAverageTotals(normalized.days);
        if (avg.calories > 0) {
          setCalTarget(Math.round(avg.calories));
          if (!content?.macros?.protein) setProteinTarget(Math.round(avg.protein));
          if (!content?.macros?.carbs) setCarbsTarget(Math.round(avg.carbs));
          if (!content?.macros?.fat) setFatTarget(Math.round(avg.fats));
        }
      }
    }
    return !!normalized;
  }, []);

  useEffect(() => {
    if (!draftId) return;
    const d = loadDraft(draftId);
    if (!d) {
      toast.error('Draft not found — it may have expired this session');
      return;
    }
    setPlanName(d.name || '');
    setDescription(d.description || '');
    if (d.dietaryType) setDietaryType(d.dietaryType);
    if (d.cuisine) setCuisine(d.cuisine);
    if (d.caloriesTarget) setCalTarget(d.caloriesTarget);
    if (d.memberId) {
      setMember({ id: d.memberId, full_name: d.memberName || '', member_code: d.memberCode || '' } as PickedMember);
    }
    hydrateFromContent(d.content || {});
    hydratedRef.current = true;
  }, [draftId, hydrateFromContent]);

  useEffect(() => {
    if (!templateId) return;
    let cancelled = false;
    setLoadState('loading');
    (async () => {
      try {
        const tpl = await getPlanTemplate(templateId);
        if (cancelled) return;
        if (!tpl) {
          toast.error('Template not found');
          setLoadState('error');
          return;
        }
        if (tpl.type !== 'diet') {
          toast.error('That template is a workout plan — opening the workout builder instead');
          navigate(`/fitness/create/manual?type=workout&template=${templateId}${editMode ? '&edit=1' : ''}`, { replace: true });
          return;
        }
        setPlanName(tpl.name);
        setDescription(tpl.description || '');
        const ok = hydrateFromContent(tpl.content || {});
        setLoadState('ready');
        hydratedRef.current = true;
        toast.success(
          ok ? `Loaded template: ${tpl.name}` : `Loaded template: ${tpl.name} (no meals stored yet)`,
        );
      } catch (err: any) {
        if (cancelled) return;
        setLoadState('error');
        toast.error(err?.message || 'Failed to load template');
      }
    })();
    return () => { cancelled = true; };
  }, [templateId, navigate, editMode, hydrateFromContent]);

  const slots = days[activeDay]?.slots ?? [];

  const totals = useMemo(
    () => (macroScope === 'week' && weekly
      ? weeklyAverageTotals(days)
      : dayTotals(days[activeDay] || { day: '', slots: [] })),
    [days, activeDay, macroScope, weekly],
  );

  const exceeds = (val: number, target: number) => target > 0 && val > target;

  const updateDaySlots = (updater: (prev: DietSlot[]) => DietSlot[]) =>
    setDays((prev) => prev.map((d, i) => (i === activeDay ? { ...d, slots: updater(d.slots) } : d)));

  const updateSlot = (idx: number, patch: Partial<DietSlot>) =>
    updateDaySlots((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));

  /** Append a meal slot (preset or custom) to the active day, kept in time order. */
  const addSlot = (preset?: { name: string; time: string }) => {
    const next: DietSlot = {
      name: preset?.name || `Meal ${(days[activeDay]?.slots.length ?? 0) + 1}`,
      time: preset?.time || '12:00',
      items: [],
    };
    // Smart insert: drop the new meal at the first position whose time is
    // later, so a 06:00 Pre-Workout lands at the top instead of the bottom.
    updateDaySlots((prev) => {
      const at = prev.findIndex((s) => (s.time || '') > (next.time || ''));
      const out = [...prev];
      out.splice(at === -1 ? out.length : at, 0, next);
      return out;
    });

    toast.success(`${next.name} added`);
  };

  const removeSlot = (idx: number) => {
    const name = days[activeDay]?.slots[idx]?.name || 'Meal';
    updateDaySlots((prev) => prev.filter((_, i) => i !== idx));
    setOpenAttach({});
    toast.success(`${name} removed`);
  };

  /** Manual ordering — meals keep the trainer's order, not the clock's. */
  const reorderSlot = (from: number, to: number) => {
    if (from === to || to < 0) return;
    updateDaySlots((prev) => {
      if (to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setOpenAttach({});
  };

  const sortSlotsByTime = () => {
    updateDaySlots((prev) => [...prev].sort((a, b) => (a.time || '').localeCompare(b.time || '')));
    toast.success('Meals sorted by time');
  };


  /** Copy the active day's slot layout (names/times, no items) to every other day. */
  const applySlotLayoutToAllDays = () => {
    const source = days[activeDay];
    if (!source) return;
    setDays((prev) =>
      prev.map((d, i) => {
        if (i === activeDay) return d;
        const byName = new Map(d.slots.map((s) => [s.name.toLowerCase(), s]));
        return {
          ...d,
          slots: source.slots.map(
            (s) => byName.get(s.name.toLowerCase()) ?? { name: s.name, time: s.time, items: [] },
          ),
        };
      }),
    );
    toast.success('Meal structure applied to all days');
  };

  const addItem = (idx: number) =>
    updateDaySlots((prev) => prev.map((s, i) => (i === idx ? { ...s, items: [...s.items, { ...EMPTY_ITEM }] } : s)));

  const updateItem = (sIdx: number, iIdx: number, field: keyof DietItem, value: any) =>
    updateDaySlots((prev) =>
      prev.map((s, i) =>
        i === sIdx ? { ...s, items: s.items.map((it, j) => (j === iIdx ? { ...it, [field]: value } : it)) } : s,
      ),
    );

  const removeItem = (sIdx: number, iIdx: number) =>
    updateDaySlots((prev) =>
      prev.map((s, i) => (i === sIdx ? { ...s, items: s.items.filter((_, j) => j !== iIdx) } : s)),
    );

  // ---- Live macro calculator -------------------------------------------
  // Whole catalog (small, cached) so typed food names resolve to real macros.
  const { data: catalogAll = [] } = useQuery({
    queryKey: ['meal-catalog', 'macro-lookup'],
    queryFn: () => fetchMealCatalog({}),
    staleTime: 5 * 60 * 1000,
  });

  const catalogByName = useMemo(() => {
    const map = new Map<string, MealCatalogEntry>();
    for (const e of catalogAll) map.set(e.name.trim().toLowerCase(), e);
    return map;
  }, [catalogAll]);

  const macrosFromCatalog = (item: DietItem): DietItem | null => {
    const hit = catalogByName.get((item.food || '').trim().toLowerCase());
    if (!hit) return null;
    return {
      ...item,
      calories: hit.calories,
      protein: hit.protein,
      carbs: hit.carbs,
      fats: hit.fats,
      catalog_id: hit.id,
    };
  };

  /** Fill macros for one item when its typed name matches a catalog meal. */
  const autofillItem = (sIdx: number, iIdx: number) => {
    const item = days[activeDay]?.slots[sIdx]?.items[iIdx];
    if (!item?.food) return;
    if ((item.calories || 0) > 0 || (item.protein || 0) > 0) return;
    const filled = macrosFromCatalog(item);
    if (!filled) return;
    updateDaySlots((prev) =>
      prev.map((s, i) =>
        i === sIdx ? { ...s, items: s.items.map((it, j) => (j === iIdx ? filled : it)) } : s,
      ),
    );
  };

  /** Recalculate every item on the active day from the catalog. */
  const recalcDayMacros = () => {
    let matched = 0;
    updateDaySlots((prev) =>
      prev.map((s) => ({
        ...s,
        items: s.items.map((it) => {
          const filled = macrosFromCatalog(it);
          if (filled) matched += 1;
          return filled ?? it;
        }),
      })),
    );
    if (matched) toast.success(`Recalculated ${matched} item${matched > 1 ? 's' : ''}`);
    else toast.info('No catalog matches found');
  };

  const [dragIdx, setDragIdx] = useState<number | null>(null);


  const applySwap = (sIdx: number, entry: MealCatalogEntry) => {
    const anyEntry = entry as any;
    updateSlot(sIdx, {
      items: [{
        food: entry.name,
        quantity: entry.default_quantity || '1 serving',
        calories: entry.calories,
        protein: entry.protein,
        carbs: entry.carbs,
        fats: entry.fats,
        catalog_id: entry.id,
      }],
      recipe_link: anyEntry.recipe_link || slots[sIdx].recipe_link,
      prep_video_url: anyEntry.prep_video_url || slots[sIdx].prep_video_url,
    });
    setSwapSlotIdx(null);
    toast.success(`Swapped to ${entry.name}`);
  };

  const copyDayTo = (targets: number[]) => {
    const source = days[activeDay];
    if (!source) return;
    setDays((prev) =>
      prev.map((d, i) =>
        targets.includes(i)
          ? { ...d, slots: source.slots.map((s) => ({ ...s, items: s.items.map((it) => ({ ...it })) })) }
          : d,
      ),
    );
    toast.success(targets.length > 1 ? 'Copied to all other days' : 'Day copied');
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const buildContent = (): DietPlanContent => ({
    name: planName,
    type: 'diet',
    description,
    dailyCalories: calTarget,
    dietaryType,
    cuisine,
    macros: { protein: `${proteinTarget}g`, carbs: `${carbsTarget}g`, fat: `${fatTarget}g` },
    ...serializeDietDays(days, weekly),
    totals: dayTotals(days[0] || { day: '', slots: [] }),
  } as DietPlanContent);

  const filledItems = useMemo(
    () => days.reduce((n, d) => n + d.slots.reduce((m, s) => m + s.items.filter((i) => i.food).length, 0), 0),
    [days],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const validateContent = (): string | null => {
    if (loadState === 'loading') return 'Still loading the saved plan — please wait';
    if (loadState === 'error') return 'The saved plan could not be loaded — reload before saving';
    if (!planName.trim()) return 'Plan name is required';
    if (!dietaryType) return 'Dietary type is required';
    if (!cuisine) return 'Cuisine is required';
    if (filledItems === 0) return 'Add at least one meal item';
    return null;
  };

  const handleSaveTemplate = useCallback(async () => {
    const err = validateContent();
    if (err) { toast.error(err); return; }
    if (!templateId) return;
    try {
      await updatePlanTemplate(templateId, {
        name: planName.trim(),
        description: description.trim() || null,
        content: buildContent(),
      });
      queryClient.invalidateQueries({ queryKey: ['fitness-templates'] });
      queryClient.invalidateQueries({ queryKey: ['fitness-template-usage'] });
      toast.success('Template updated');
      navigate('/fitness/templates');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update template');
    }
  }, [planName, description, templateId, navigate, queryClient, validateContent, buildContent]);

  const handlePreview = useCallback(() => {
    const err = validateContent();
    if (err) { toast.error(err); return; }

    if (draftId) {
      const existing = loadDraft(draftId);
      saveDraft({
        ...(existing || {} as any),
        id: draftId,
        source: existing?.source || 'manual-diet',
        templateId: existing?.templateId || templateId || undefined,
        type: 'diet',
        name: planName,
        description,
        caloriesTarget: calTarget,
        memberId: existing?.memberId || member?.id,
        memberName: existing?.memberName || member?.full_name,
        memberCode: existing?.memberCode || member?.member_code,
        memberProfile: existing?.memberProfile,
        dietaryType,
        cuisine,
        content: buildContent(),
        createdAt: existing?.createdAt || new Date().toISOString(),
      });
      navigate(`/fitness/preview/${draftId}`);
      return;
    }

    const id = newDraftId();
    saveDraft({
      id,
      source: 'manual-diet',
      templateId: templateId || undefined,
      type: 'diet',
      name: planName,
      description,
      caloriesTarget: calTarget,
      memberId: member?.id,
      memberName: member?.full_name,
      memberCode: member?.member_code,
      dietaryType,
      cuisine,
      content: buildContent(),
      createdAt: new Date().toISOString(),
    });
    navigate(`/fitness/preview/${id}`);
  }, [planName, description, calTarget, dietaryType, cuisine, member, draftId, templateId, navigate, validateContent, buildContent]);

  const canSubmit =
    loadState !== 'loading' && loadState !== 'error'
    && !!planName.trim() && !!dietaryType && !!cuisine && filledItems > 0;
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

  if (loadState === 'loading') {
    return (
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-3">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
        <div className="space-y-4 lg:col-span-6">
          <Skeleton className="h-56 rounded-2xl" />
          <Skeleton className="h-56 rounded-2xl" />
        </div>
        <div className="space-y-4 lg:col-span-3">
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      </div>

    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      {/* Left: plan details, targets, day rail */}
      <div className="space-y-4 lg:col-span-3">
        <Card className="rounded-2xl border-0 shadow-md shadow-muted-foreground/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Plan Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="dt-name">Plan Name *</Label>
              <Input id="dt-name" value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="e.g. Cutting diet — phase 1" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dt-desc">Description</Label>
              <Input id="dt-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short summary" />
            </div>
            <div className="space-y-1.5">
              <Label>Dietary Type *</Label>
              <Select value={dietaryType} onValueChange={setDietaryType}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="vegetarian">Vegetarian</SelectItem>
                  <SelectItem value="vegan">Vegan</SelectItem>
                  <SelectItem value="non_vegetarian">Non-Vegetarian</SelectItem>
                  <SelectItem value="eggetarian">Eggetarian</SelectItem>
                  <SelectItem value="pescatarian">Pescatarian</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Cuisine *</Label>
              <Select value={cuisine} onValueChange={setCuisine}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="indian">Indian</SelectItem>
                  <SelectItem value="continental">Continental</SelectItem>
                  <SelectItem value="mediterranean">Mediterranean</SelectItem>
                  <SelectItem value="asian">Asian</SelectItem>
                  <SelectItem value="mixed">Mixed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-0 shadow-md shadow-muted-foreground/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Daily Targets
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="t-cal">Calories</Label>
                <Input id="t-cal" type="number" value={calTarget} onChange={(e) => setCalTarget(parseInt(e.target.value) || 0)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="t-pro">Protein (g)</Label>
                <Input id="t-pro" type="number" value={proteinTarget} onChange={(e) => setProteinTarget(parseInt(e.target.value) || 0)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="t-carb">Carbs (g)</Label>
                <Input id="t-carb" type="number" value={carbsTarget} onChange={(e) => setCarbsTarget(parseInt(e.target.value) || 0)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="t-fat">Fats (g)</Label>
                <Input id="t-fat" type="number" value={fatTarget} onChange={(e) => setFatTarget(parseInt(e.target.value) || 0)} />
              </div>
            </div>
          </CardContent>
        </Card>

        {weekly && days.length > 1 && (
          <Card className="rounded-2xl border-0 shadow-md shadow-muted-foreground/10">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {days.length}-day plan
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DayRail
                ariaLabel="Select plan day"
                activeIndex={activeDay}
                onSelect={setActiveDay}
                days={days.map((d) => {
                  const t = dayTotals(d);
                  return {
                    label: d.day,
                    meta: `${Math.round(t.calories)} kcal · ${Math.round(t.protein)}g P`,
                    muted: t.calories === 0,
                  };
                })}
                action={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-9 w-full cursor-pointer gap-1">
                        <Copy className="h-3.5 w-3.5" /> Copy this day
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => copyDayTo(days.map((_, i) => i).filter((i) => i !== activeDay))}
                      >
                        Copy to all other days
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {days.map((d, i) =>
                        i === activeDay ? null : (
                          <DropdownMenuItem key={d.day + i} onClick={() => copyDayTo([i])}>
                            Copy to {d.day}
                          </DropdownMenuItem>
                        ),
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Middle: meal slots for the active day */}
      <div className="space-y-4 lg:col-span-6">
        {weekly && days.length > 1 && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="rounded-full bg-primary/10 text-primary">
              {days[activeDay]?.day}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {Math.round(dayTotals(days[activeDay] || { day: '', slots: [] }).calories)} kcal planned
            </span>
          </div>
        )}

        {slots.map((slot, sIdx) => {
          const attachOpen = !!openAttach[sIdx] || !!slot.recipe_link || !!slot.prep_video_url || !!slot.prep_video_file_path;
          const st = slotTotals(slot);
          return (
            <Card
              key={sIdx}
              onDragOver={(e) => {
                if (dragIdx !== null) e.preventDefault();
              }}
              onDrop={() => {
                if (dragIdx !== null) reorderSlot(dragIdx, sIdx);
                setDragIdx(null);
              }}
              className={cn(
                'rounded-2xl border-0 shadow-md shadow-muted-foreground/10 transition-shadow duration-200 hover:shadow-lg',
                dragIdx === sIdx && 'opacity-60 ring-2 ring-primary',
              )}
            >
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span
                      draggable
                      onDragStart={() => setDragIdx(sIdx)}
                      onDragEnd={() => setDragIdx(null)}
                      role="button"
                      tabIndex={0}
                      aria-label={`Drag to reorder ${slot.name}`}
                      className="flex h-8 w-8 cursor-grab items-center justify-center rounded-full text-muted-foreground hover:bg-muted active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <GripVertical className="h-4 w-4" />
                    </span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 text-accent">
                      <UtensilsCrossed className="h-4 w-4" />
                    </span>
                    <Input
                      className="h-9 w-44"
                      value={slot.name}
                      onChange={(e) => updateSlot(sIdx, { name: e.target.value })}
                      aria-label="Meal slot name"
                    />
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-5 w-7 cursor-pointer"
                        disabled={sIdx === 0}
                        onClick={() => reorderSlot(sIdx, sIdx - 1)}
                        aria-label={`Move ${slot.name} up`}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-5 w-7 cursor-pointer"
                        disabled={sIdx === slots.length - 1}
                        onClick={() => reorderSlot(sIdx, sIdx + 1)}
                        aria-label={`Move ${slot.name} down`}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <Input
                      type="time"
                      className="h-9 w-28"
                      value={slot.time}
                      onChange={(e) => updateSlot(sIdx, { time: e.target.value })}
                      aria-label="Meal time"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 cursor-pointer gap-1"
                      onClick={() => {
                        if (!dietaryType || !cuisine) {
                          toast.error('Set dietary type & cuisine first');
                          return;
                        }
                        setSwapSlotIdx(sIdx);
                      }}
                    >
                      <ArrowLeftRight className="h-3.5 w-3.5" /> Swap
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 cursor-pointer text-destructive"
                      onClick={() => removeSlot(sIdx)}
                      aria-label={`Remove ${slot.name} slot`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {/* Live per-meal subtotal */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <Badge variant="secondary" className="rounded-full font-medium">
                    {Math.round(st.calories)} kcal
                  </Badge>
                  <Badge variant="outline" className="rounded-full">P {Math.round(st.protein)}g</Badge>
                  <Badge variant="outline" className="rounded-full">C {Math.round(st.carbs)}g</Badge>
                  <Badge variant="outline" className="rounded-full">F {Math.round(st.fats)}g</Badge>
                </div>
              </CardHeader>

              <CardContent className="space-y-2">
                {slot.items.length === 0 && (
                  <p className="rounded-xl border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                    No items yet — add one or swap in a catalog meal.
                  </p>
                )}
                {slot.items.map((item, iIdx) => (
                  <div key={iIdx} className="grid grid-cols-12 items-end gap-2 rounded-xl border bg-muted/30 p-2">
                    <div className="col-span-12 sm:col-span-4">
                      <Label className="text-xs">Food</Label>
                      <Input value={item.food} onChange={(e) => updateItem(sIdx, iIdx, 'food', e.target.value)} placeholder="Oats" />
                    </div>
                    <div className="col-span-6 sm:col-span-2">
                      <Label className="text-xs">Qty</Label>
                      <Input value={item.quantity} onChange={(e) => updateItem(sIdx, iIdx, 'quantity', e.target.value)} placeholder="100g" />
                    </div>
                    <div className="col-span-3 sm:col-span-1">
                      <Label className="text-xs">Cal</Label>
                      <Input type="number" value={item.calories} onChange={(e) => updateItem(sIdx, iIdx, 'calories', parseFloat(e.target.value) || 0)} />
                    </div>
                    <div className="col-span-3 sm:col-span-1">
                      <Label className="text-xs">P</Label>
                      <Input type="number" value={item.protein} onChange={(e) => updateItem(sIdx, iIdx, 'protein', parseFloat(e.target.value) || 0)} />
                    </div>
                    <div className="col-span-3 sm:col-span-1">
                      <Label className="text-xs">C</Label>
                      <Input type="number" value={item.carbs} onChange={(e) => updateItem(sIdx, iIdx, 'carbs', parseFloat(e.target.value) || 0)} />
                    </div>
                    <div className="col-span-3 sm:col-span-1">
                      <Label className="text-xs">F</Label>
                      <Input type="number" value={item.fats} onChange={(e) => updateItem(sIdx, iIdx, 'fats', parseFloat(e.target.value) || 0)} />
                    </div>
                    <div className="col-span-12 flex justify-end sm:col-span-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 cursor-pointer text-destructive"
                        onClick={() => removeItem(sIdx, iIdx)}
                        aria-label="Remove item"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="h-9 flex-1 cursor-pointer border-dashed" onClick={() => addItem(sIdx)}>
                    <Plus className="mr-1 h-4 w-4" /> Add Item
                  </Button>
                  {!attachOpen && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9 cursor-pointer gap-1 text-muted-foreground"
                      onClick={() => setOpenAttach((p) => ({ ...p, [sIdx]: true }))}
                    >
                      <Paperclip className="h-3.5 w-3.5" /> Attach recipe / video
                    </Button>
                  )}
                </div>

                {attachOpen && (
                  <div className="grid gap-2 border-t pt-2">
                    <div className="flex items-center gap-2">
                      <LinkIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        className="h-9 text-xs"
                        placeholder="Recipe link (optional)"
                        value={slot.recipe_link || ''}
                        onChange={(e) => updateSlot(sIdx, { recipe_link: e.target.value })}
                        aria-label="Recipe link"
                      />
                    </div>
                    <VideoAttachmentControl
                      folder="meals"
                      label="Prep video (URL or upload)"
                      value={{ video_url: slot.prep_video_url, video_file_path: slot.prep_video_file_path }}
                      onChange={(next) => updateSlot(sIdx, {
                        prep_video_url: next.video_url,
                        prep_video_file_path: next.video_file_path,
                      })}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        {/* Add a meal slot — presets cover pre/post-workout and other extras */}
        <Card className="rounded-2xl border-0 bg-muted/30 shadow-none">
          <CardContent className="flex flex-wrap items-center gap-2 p-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Add meal
            </span>
            {SLOT_PRESETS.map((p) => {
              const exists = slots.some((s) => s.name.toLowerCase() === p.name.toLowerCase());
              return (
                <Button
                  key={p.name}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={exists}
                  className="h-8 cursor-pointer rounded-full border-dashed"
                  onClick={() => addSlot(p)}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  {p.name}
                </Button>
              );
            })}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 cursor-pointer rounded-full"
              onClick={() => addSlot()}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Custom meal
            </Button>
            {weekly && days.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto h-8 cursor-pointer gap-1 rounded-full text-muted-foreground"
                onClick={applySlotLayoutToAllDays}
              >
                <Copy className="h-3.5 w-3.5" /> Use this structure all week
              </Button>
            )}
          </CardContent>
        </Card>


        <MealSwapModal
          open={swapSlotIdx !== null}
          onOpenChange={(o) => !o && setSwapSlotIdx(null)}
          context={swapSlotIdx === null || !slots[swapSlotIdx] ? null : {
            name: slots[swapSlotIdx].name,
            mealType: SLOT_TO_MEAL_TYPE(slots[swapSlotIdx].name),
            dietaryType,
            cuisine,
            calories: slots[swapSlotIdx].items.reduce((s, i) => s + (Number(i.calories) || 0), 0),
          }}
          onSelect={(entry) => swapSlotIdx !== null && applySwap(swapSlotIdx, entry)}
        />
      </div>

      {/* Right: live macros + assignment */}
      <div className="space-y-4 self-start lg:col-span-3 lg:sticky lg:top-40">
        <Card className="rounded-2xl border-0 shadow-md shadow-muted-foreground/10">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Live Macros</CardTitle>
              {weekly && days.length > 1 && (
                <div className="flex rounded-lg bg-muted p-0.5">
                  {(['day', 'week'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setMacroScope(s)}
                      className={cn(
                        'cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium transition-colors duration-200',
                        macroScope === s ? 'bg-background shadow-sm' : 'text-muted-foreground',
                      )}
                    >
                      {s === 'day' ? 'This day' : 'Weekly avg'}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {weekly && days.length > 1 && (
              <Badge variant="secondary" className="mt-1 w-fit text-[10px]">
                {macroScope === 'day' ? days[activeDay]?.day : `Average of ${days.length} days`}
              </Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { label: 'Calories', val: totals.calories, target: calTarget, unit: '' },
              { label: 'Protein', val: totals.protein, target: proteinTarget, unit: 'g' },
              { label: 'Carbs', val: totals.carbs, target: carbsTarget, unit: 'g' },
              { label: 'Fats', val: totals.fats, target: fatTarget, unit: 'g' },
            ].map(row => {
              const pct = row.target > 0 ? Math.min(100, Math.round((row.val / row.target) * 100)) : 0;
              const over = exceeds(row.val, row.target);
              return (
                <div
                  key={row.label}
                  className={cn(
                    'rounded-xl border p-2.5',
                    over && 'border-destructive/50 bg-destructive/5',
                  )}
                >
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">{row.label}</p>
                      <p className={cn('text-lg font-bold leading-tight', over && 'text-destructive')}>
                        {Math.round(row.val)}{row.unit}
                      </p>
                    </div>
                    <p className="text-right text-xs text-muted-foreground">
                      target<br />
                      <span className="font-medium text-foreground">{row.target}{row.unit}</span>
                    </p>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn('h-full rounded-full transition-all duration-300', over ? 'bg-destructive' : 'bg-primary')}
                      style={{ width: `${over ? 100 : pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {(exceeds(totals.calories, calTarget) || exceeds(totals.protein, proteinTarget) || exceeds(totals.carbs, carbsTarget) || exceeds(totals.fats, fatTarget)) && (
              <div className="flex items-start gap-2 rounded-xl bg-destructive/10 p-2 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Totals exceed one or more targets.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-0 shadow-md shadow-muted-foreground/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Optional: Pre-Assign Member
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MemberSearchPicker value={member} onChange={setMember} label="Member" />
            <p className="mt-2 text-xs text-muted-foreground">You can also assign on the next step.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

