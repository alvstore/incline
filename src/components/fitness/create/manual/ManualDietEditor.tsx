import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
} from 'lucide-react';
import { toast } from 'sonner';
import { MemberSearchPicker, PickedMember } from '@/components/fitness/create/MemberSearchPicker';
import { newDraftId, saveDraft, loadDraft } from '@/lib/planDraft';
import { cn } from '@/lib/utils';
import { VideoAttachmentControl } from '@/components/fitness/VideoAttachmentControl';
import { MealSwapModal } from '@/components/fitness/MealSwapModal';
import { MealCatalogEntry, MealType } from '@/services/mealCatalogService';
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
  weeklyAverageTotals,
} from '@/lib/fitness/dietContent';

const SLOT_TO_MEAL_TYPE = (name: string): MealType | undefined => {
  const k = name.toLowerCase();
  if (k.includes('breakfast')) return 'breakfast';
  if (k.includes('lunch')) return 'lunch';
  if (k.includes('dinner')) return 'dinner';
  if (k.includes('snack') || k.includes('mid')) return 'snack';
  return undefined;
};

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
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-12 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Plan Details</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Plan Name *</Label>
                <Input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="e.g. Cutting diet — phase 1" />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short summary" />
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
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Daily Targets</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Calories</Label>
                <Input type="number" value={calTarget} onChange={(e) => setCalTarget(parseInt(e.target.value) || 0)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Protein (g)</Label>
                <Input type="number" value={proteinTarget} onChange={(e) => setProteinTarget(parseInt(e.target.value) || 0)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Carbs (g)</Label>
                <Input type="number" value={carbsTarget} onChange={(e) => setCarbsTarget(parseInt(e.target.value) || 0)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Fats (g)</Label>
                <Input type="number" value={fatTarget} onChange={(e) => setFatTarget(parseInt(e.target.value) || 0)} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Day rail — weekly plans keep all their days */}
        {weekly && days.length > 1 && (
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {days.length}-day plan
                </p>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 gap-1">
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
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {days.map((d, i) => {
                  const t = dayTotals(d);
                  const active = i === activeDay;
                  return (
                    <button
                      key={d.day + i}
                      type="button"
                      onClick={() => setActiveDay(i)}
                      className={cn(
                        'shrink-0 rounded-xl border px-3 py-2 text-left transition-all duration-200 cursor-pointer',
                        'focus:outline-none focus:ring-2 focus:ring-primary min-w-[104px]',
                        active ? 'border-primary bg-primary/10' : 'hover:bg-muted/60',
                      )}
                      aria-pressed={active}
                    >
                      <p className={cn('text-sm font-semibold', active && 'text-primary')}>{d.day}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {Math.round(t.calories)} kcal · {Math.round(t.protein)}g P
                      </p>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {slots.map((slot, sIdx) => {
          const attachOpen = !!openAttach[sIdx] || !!slot.recipe_link || !!slot.prep_video_url || !!slot.prep_video_file_path;
          return (
            <Card key={sIdx}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <UtensilsCrossed className="h-4 w-4 text-accent" />
                    <Input
                      className="h-8 w-44"
                      value={slot.name}
                      onChange={(e) => updateSlot(sIdx, { name: e.target.value })}
                      aria-label="Meal slot name"
                    />
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <Input
                      type="time"
                      className="h-8 w-28"
                      value={slot.time}
                      onChange={(e) => updateSlot(sIdx, { time: e.target.value })}
                      aria-label="Meal time"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1"
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
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {slot.items.length === 0 && (
                  <p className="text-xs text-muted-foreground px-1">No items yet — add one or swap in a catalog meal.</p>
                )}
                {slot.items.map((item, iIdx) => (
                  <div key={iIdx} className="grid grid-cols-12 gap-2 items-end p-2 bg-muted/30 rounded-md">
                    <div className="col-span-12 sm:col-span-3">
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
                    <div className="col-span-12 sm:col-span-3 flex justify-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => removeItem(sIdx, iIdx)}
                        aria-label="Remove item"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="flex-1 border-dashed" onClick={() => addItem(sIdx)}>
                    <Plus className="h-4 w-4 mr-1" /> Add Item
                  </Button>
                  {!attachOpen && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 text-muted-foreground"
                      onClick={() => setOpenAttach((p) => ({ ...p, [sIdx]: true }))}
                    >
                      <Paperclip className="h-3.5 w-3.5" /> Attach recipe / video
                    </Button>
                  )}
                </div>

                {attachOpen && (
                  <div className="grid gap-2 pt-2 border-t">
                    <div className="flex items-center gap-2">
                      <LinkIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        className="h-8 text-xs"
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

      <div className="space-y-4 lg:sticky lg:top-24 self-start">
        <Card>
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
                        'px-2 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer',
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
              <Badge variant="secondary" className="w-fit text-[10px] mt-1">
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
            ].map(row => (
              <div key={row.label} className={cn(
                'flex items-center justify-between rounded-md border p-2',
                exceeds(row.val, row.target) && 'border-destructive/50 bg-destructive/5'
              )}>
                <div>
                  <p className="text-xs text-muted-foreground">{row.label}</p>
                  <p className={cn('text-lg font-bold', exceeds(row.val, row.target) && 'text-destructive')}>
                    {Math.round(row.val)}{row.unit}
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  target<br />
                  <span className="font-medium text-foreground">{row.target}{row.unit}</span>
                </div>
              </div>
            ))}
            {(exceeds(totals.calories, calTarget) || exceeds(totals.protein, proteinTarget) || exceeds(totals.carbs, carbsTarget) || exceeds(totals.fats, fatTarget)) && (
              <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 text-destructive text-xs">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                Totals exceed one or more targets.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Optional: Pre-Assign Member</CardTitle>
          </CardHeader>
          <CardContent>
            <MemberSearchPicker value={member} onChange={setMember} label="Member" />
            <p className="text-xs text-muted-foreground mt-2">You can also assign on the next step.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
