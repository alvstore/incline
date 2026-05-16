import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getPlanTemplate, updatePlanTemplate } from '@/services/fitnessService';
import type { DietPlanContent } from '@/types/fitnessPlan';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, UtensilsCrossed, Clock, AlertTriangle, ArrowLeftRight, Link as LinkIcon } from 'lucide-react';
import { toast } from 'sonner';
import { MemberSearchPicker, PickedMember } from '@/components/fitness/create/MemberSearchPicker';
import { newDraftId, saveDraft, loadDraft } from '@/lib/planDraft';
import { cn } from '@/lib/utils';
import { VideoAttachmentControl } from '@/components/fitness/VideoAttachmentControl';
import { MealSwapModal } from '@/components/fitness/MealSwapModal';
import { MealCatalogEntry, MealType } from '@/services/mealCatalogService';

interface MealItem {
  food: string;
  quantity: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
}
interface MealSlot {
  name: string;
  time: string;
  items: MealItem[];
  recipe_link?: string;
  prep_video_url?: string;
  prep_video_file_path?: string;
}

const SLOT_TO_MEAL_TYPE = (name: string): MealType | undefined => {
  const k = name.toLowerCase();
  if (k.includes('breakfast')) return 'breakfast';
  if (k.includes('lunch')) return 'lunch';
  if (k.includes('dinner')) return 'dinner';
  if (k.includes('snack') || k.includes('mid')) return 'snack';
  return undefined;
};

const DEFAULT_SLOTS: MealSlot[] = [
  { name: 'Breakfast', time: '07:30', items: [] },
  { name: 'Mid-Morning Snack', time: '10:30', items: [] },
  { name: 'Lunch', time: '13:00', items: [] },
  { name: 'Evening Snack', time: '16:30', items: [] },
  { name: 'Dinner', time: '20:00', items: [] },
];

const EMPTY_ITEM: MealItem = { food: '', quantity: '', calories: 0, protein: 0, carbs: 0, fats: 0 };

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
  const [member, setMember] = useState<PickedMember | null>(null);
  const [dietaryType, setDietaryType] = useState('');
  const [cuisine, setCuisine] = useState('');
  const [calTarget, setCalTarget] = useState(2000);
  const [proteinTarget, setProteinTarget] = useState(120);
  const [carbsTarget, setCarbsTarget] = useState(220);
  const [fatTarget, setFatTarget] = useState(60);
  const [slots, setSlots] = useState<MealSlot[]>(DEFAULT_SLOTS);
  const [swapSlotIdx, setSwapSlotIdx] = useState<number | null>(null);

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
    const content: any = d.content || {};
    const macroNum = (v: any) => parseInt(String(v ?? '').replace(/\D/g, ''), 10);
    if (content.macros?.protein) setProteinTarget(macroNum(content.macros.protein) || 120);
    if (content.macros?.carbs) setCarbsTarget(macroNum(content.macros.carbs) || 220);
    if (content.macros?.fat) setFatTarget(macroNum(content.macros.fat) || 60);

    let sourceSlots: any[] | null = null;
    if (Array.isArray(content.slots) && content.slots.length) {
      sourceSlots = content.slots;
    } else if (Array.isArray(content.meals) && content.meals.length) {
      const day0 = content.meals[0] || {};
      const KEYS: { key: string; name: string; time?: string }[] = [
        { key: 'breakfast', name: 'Breakfast', time: '07:30' },
        { key: 'snack1', name: 'Mid-Morning Snack', time: '10:30' },
        { key: 'lunch', name: 'Lunch', time: '13:00' },
        { key: 'snack2', name: 'Evening Snack', time: '16:30' },
        { key: 'dinner', name: 'Dinner', time: '20:00' },
      ];
      sourceSlots = KEYS.filter((k) => day0[k.key]).map((k) => {
        const e = day0[k.key];
        return {
          name: k.name,
          time: k.time,
          items: [{
            food: e?.meal || e?.name || e?.food || '',
            quantity: e?.quantity || '',
            calories: Number(e?.calories) || 0,
            protein: Number(e?.protein) || 0,
            carbs: Number(e?.carbs) || 0,
            fats: Number(e?.fats ?? e?.fat) || 0,
          }],
        };
      });
    }
    if (sourceSlots && sourceSlots.length) {
      setSlots(sourceSlots.map((s: any) => ({
        name: s.name || '',
        time: s.time || '',
        items: (s.items || []).map((i: any) => ({
          food: i.food || '',
          quantity: i.quantity || '',
          calories: Number(i.calories) || 0,
          protein: Number(i.protein) || 0,
          carbs: Number(i.carbs) || 0,
          fats: Number(i.fats) || 0,
        })),
        recipe_link: s.recipe_link,
        prep_video_url: s.prep_video_url,
        prep_video_file_path: s.prep_video_file_path,
      })));
    }
  }, [draftId]);

  useEffect(() => {
    if (!templateId) return;
    let cancelled = false;
    (async () => {
      try {
        const tpl = await getPlanTemplate(templateId);
        if (cancelled) return;
        if (!tpl) { toast.error('Template not found'); return; }
        if (tpl.type !== 'diet') {
          toast.error('That template is a workout plan — opening the workout builder instead');
          navigate(`/fitness/create/manual?type=workout&template=${templateId}${editMode ? '&edit=1' : ''}`, { replace: true });
          return;
        }
        setPlanName(tpl.name);
        setDescription(tpl.description || '');
        const content: any = tpl.content || {};
        if (content.dietaryType) setDietaryType(content.dietaryType);
        if (content.cuisine) setCuisine(content.cuisine);
        if (content.dailyCalories) setCalTarget(Number(content.dailyCalories) || 2000);
        const macroNum = (v: any) => parseInt(String(v ?? '').replace(/\D/g, ''), 10);
        if (content.macros?.protein) setProteinTarget(macroNum(content.macros.protein) || 120);
        if (content.macros?.carbs) setCarbsTarget(macroNum(content.macros.carbs) || 220);
        if (content.macros?.fat) setFatTarget(macroNum(content.macros.fat) || 60);
        if (Array.isArray(content.slots) && content.slots.length) {
          setSlots(content.slots.map((s: any) => ({
            name: s.name || '',
            time: s.time || '',
            items: (s.items || []).map((i: any) => ({
              food: i.food || '',
              quantity: i.quantity || '',
              calories: Number(i.calories) || 0,
              protein: Number(i.protein) || 0,
              carbs: Number(i.carbs) || 0,
              fats: Number(i.fats) || 0,
            })),
            recipe_link: s.recipe_link,
            prep_video_url: s.prep_video_url,
            prep_video_file_path: s.prep_video_file_path,
          })));
        }
        toast.success(`Loaded template: ${tpl.name}`);
      } catch (err: any) {
        toast.error(err?.message || 'Failed to load template');
      }
    })();
    return () => { cancelled = true; };
  }, [templateId, navigate, editMode]);

  const totals = useMemo(() => slots.reduce((acc, s) => {
    s.items.forEach(i => {
      acc.calories += Number(i.calories) || 0;
      acc.protein += Number(i.protein) || 0;
      acc.carbs += Number(i.carbs) || 0;
      acc.fats += Number(i.fats) || 0;
    });
    return acc;
  }, { calories: 0, protein: 0, carbs: 0, fats: 0 }), [slots]);

  const exceeds = (val: number, target: number) => target > 0 && val > target;

  const updateSlot = (idx: number, patch: Partial<MealSlot>) =>
    setSlots(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));

  const addItem = (idx: number) =>
    updateSlot(idx, { items: [...slots[idx].items, { ...EMPTY_ITEM }] });

  const updateItem = (sIdx: number, iIdx: number, field: keyof MealItem, value: any) =>
    updateSlot(sIdx, { items: slots[sIdx].items.map((it, i) => i === iIdx ? { ...it, [field]: value } : it) });

  const removeItem = (sIdx: number, iIdx: number) =>
    updateSlot(sIdx, { items: slots[sIdx].items.filter((_, i) => i !== iIdx) });

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
      }],
      recipe_link: anyEntry.recipe_link || slots[sIdx].recipe_link,
      prep_video_url: anyEntry.prep_video_url || slots[sIdx].prep_video_url,
    });
    setSwapSlotIdx(null);
    toast.success(`Swapped to ${entry.name}`);
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
    slots: slots.map(s => ({
      name: s.name,
      time: s.time,
      items: s.items.filter(i => i.food),
      recipe_link: s.recipe_link || undefined,
      prep_video_url: s.prep_video_url || undefined,
      prep_video_file_path: s.prep_video_file_path || undefined,
      totals: s.items.reduce((a, i) => ({
        calories: a.calories + (Number(i.calories) || 0),
        protein: a.protein + (Number(i.protein) || 0),
        carbs: a.carbs + (Number(i.carbs) || 0),
        fats: a.fats + (Number(i.fats) || 0),
      }), { calories: 0, protein: 0, carbs: 0, fats: 0 }),
    })),
    totals,
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const validateContent = (): string | null => {
    if (!planName.trim()) return 'Plan name is required';
    if (!dietaryType) return 'Dietary type is required';
    if (!cuisine) return 'Cuisine is required';
    const totalItems = slots.reduce((s, m) => s + m.items.filter(i => i.food).length, 0);
    if (totalItems === 0) return 'Add at least one meal item';
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

  const canSubmit = !!planName.trim() && !!dietaryType && !!cuisine
    && slots.reduce((s, m) => s + m.items.filter(i => i.food).length, 0) > 0;
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

        {slots.map((slot, sIdx) => (
          <Card key={sIdx}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <UtensilsCrossed className="h-4 w-4 text-accent" />
                  <Input
                    className="h-8 w-44"
                    value={slot.name}
                    onChange={(e) => updateSlot(sIdx, { name: e.target.value })}
                  />
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <Input
                    type="time"
                    className="h-8 w-28"
                    value={slot.time}
                    onChange={(e) => updateSlot(sIdx, { time: e.target.value })}
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
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeItem(sIdx, iIdx)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" className="w-full border-dashed" onClick={() => addItem(sIdx)}>
                <Plus className="h-4 w-4 mr-1" /> Add Item
              </Button>

              <div className="grid gap-2 pt-2 border-t">
                <div className="flex items-center gap-2">
                  <LinkIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    className="h-8 text-xs"
                    placeholder="Recipe link (optional)"
                    value={slot.recipe_link || ''}
                    onChange={(e) => updateSlot(sIdx, { recipe_link: e.target.value })}
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
            </CardContent>
          </Card>
        ))}

        <MealSwapModal
          open={swapSlotIdx !== null}
          onOpenChange={(o) => !o && setSwapSlotIdx(null)}
          context={swapSlotIdx === null ? null : {
            name: slots[swapSlotIdx].name,
            mealType: SLOT_TO_MEAL_TYPE(slots[swapSlotIdx].name),
            dietaryType,
            cuisine,
            calories: slots[swapSlotIdx].items.reduce((s, i) => s + (Number(i.calories) || 0), 0),
          }}
          onSelect={(entry) => swapSlotIdx !== null && applySwap(swapSlotIdx, entry)}
        />
      </div>

      <div className="space-y-4 lg:sticky lg:top-4 self-start">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Live Macros</CardTitle></CardHeader>
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
                Daily totals exceed one or more targets.
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
