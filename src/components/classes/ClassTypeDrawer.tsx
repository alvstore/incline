import { useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Gift, IndianRupee, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { ClassBannerUpload } from '@/components/classes/ClassBannerUpload';
import { useBenefitTypes } from '@/hooks/useBenefitTypes';
import { useCreateClassType, useUpdateClassType } from '@/hooks/useClassTypes';
import { CLASS_CATEGORIES } from '@/lib/classes/schedule';
import type { ClassTypeRow } from '@/types/classEngine';

type ChargeMode = 'free' | 'benefit' | 'paid';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string;
  classType?: ClassTypeRow | null;
  /** Fired after a successful create so the parent can jump straight to "Add schedule rule". */
  onCreated?: (row: ClassTypeRow) => void;
}

interface FormState {
  name: string;
  category: string;
  description: string;
  image_url: string | null;
  default_venue: string;
  benefit_type_id: string;
  requires_benefit: boolean;
  price: number;
  gst_rate: number;
  is_gst_inclusive: boolean;
  is_active: boolean;
}

const EMPTY: FormState = {
  name: '',
  category: 'other',
  description: '',
  image_url: null,
  default_venue: '',
  benefit_type_id: '',
  requires_benefit: true,
  price: 0,
  gst_rate: 18,
  is_gst_inclusive: true,
  is_active: true,
};

function modeFor(row: ClassTypeRow): ChargeMode {
  if (row.is_paid) return 'paid';
  if (row.benefit_type_id) return 'benefit';
  return 'free';
}

/**
 * Parent "class type" — the thing members see (Pilates, Yoga…). Holds the
 * premium image, description and how booking is charged. Schedule rules
 * (morning / evening batches) live underneath it.
 */
export function ClassTypeDrawer({ open, onOpenChange, branchId, classType, onCreated }: Props) {
  const isEdit = !!classType;
  const [form, setForm] = useState<FormState>(EMPTY);
  const [mode, setMode] = useState<ChargeMode>('free');
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const { data: benefitTypes = [] } = useBenefitTypes(branchId);
  const createType = useCreateClassType();
  const updateType = useUpdateClassType();
  const busy = createType.isPending || updateType.isPending;

  useEffect(() => {
    if (!open) return;
    if (classType) {
      setForm({
        name: classType.name,
        category: classType.category ?? 'other',
        description: classType.description ?? '',
        image_url: classType.image_url,
        default_venue: classType.default_venue ?? '',
        benefit_type_id: classType.benefit_type_id ?? '',
        requires_benefit: classType.requires_benefit,
        price: Number(classType.price ?? 0),
        gst_rate: Number(classType.gst_rate ?? 18),
        is_gst_inclusive: classType.is_gst_inclusive,
        is_active: classType.is_active,
      });
      setMode(modeFor(classType));
    } else {
      setForm(EMPTY);
      setMode('free');
    }
    setErrors({});
  }, [open, classType]);

  // Class-style benefits (group classes, yoga, crossfit…) float to the top; everything else stays selectable.
  const benefitOptions = useMemo(() => {
    const isClassy = (code: string | null) => /class|yoga|crossfit|pilates|zumba|dance/i.test(code ?? '');
    return [...benefitTypes].sort((a, b) => Number(isClassy(b.code)) - Number(isClassy(a.code)));
  }, [benefitTypes]);

  const validate = (): boolean => {
    const next: Partial<Record<keyof FormState, string>> = {};
    if (form.name.trim().length < 2) next.name = 'Give the class a name (at least 2 characters).';
    if (form.name.trim().length > 80) next.name = 'Keep the name under 80 characters.';
    if (mode === 'benefit' && !form.benefit_type_id) next.benefit_type_id = 'Pick the plan benefit this class draws from.';
    if (mode === 'paid' && (!Number.isFinite(form.price) || form.price <= 0)) next.price = 'Enter a price above ₹0.';
    if (mode === 'paid' && (form.gst_rate < 0 || form.gst_rate > 100)) next.gst_rate = 'GST must be between 0 and 100%.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    const payload = {
      branch_id: branchId,
      name: form.name.trim(),
      category: form.category || 'other',
      description: form.description.trim() || null,
      image_url: form.image_url,
      default_venue: form.default_venue.trim() || null,
      benefit_type_id: mode === 'benefit' ? form.benefit_type_id : null,
      requires_benefit: mode === 'benefit' ? form.requires_benefit : false,
      is_paid: mode === 'paid',
      price: mode === 'paid' ? form.price : 0,
      gst_rate: mode === 'paid' ? form.gst_rate : 0,
      is_gst_inclusive: mode === 'paid' ? form.is_gst_inclusive : true,
      is_active: form.is_active,
    };
    try {
      if (isEdit && classType) {
        await updateType.mutateAsync({ id: classType.id, updates: payload });
        toast.success(`${payload.name} updated`, { description: 'Upcoming sessions now carry the new details.' });
        onOpenChange(false);
      } else {
        const row = await createType.mutateAsync(payload);
        toast.success(`${row.name} created`, { description: 'Now add a morning or evening schedule rule.' });
        onOpenChange(false);
        onCreated?.(row);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      if (/class_types_branch_name_key|duplicate key/i.test(msg)) {
        setErrors({ name: 'A class with this name already exists at this branch.' });
      } else {
        toast.error(isEdit ? 'Could not update class' : 'Could not create class', { description: msg });
      }
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-6 py-5 text-left">
          <SheetTitle>{isEdit ? 'Edit class' : 'New class'}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? 'Changes flow to every upcoming session that has not been hand-edited.'
              : 'Create the class once. Morning and evening batches are added as schedule rules underneath it.'}
          </SheetDescription>
        </SheetHeader>

        <form id="class-type-form" onSubmit={handleSubmit} className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <ClassBannerUpload value={form.image_url} onChange={(url) => setForm({ ...form, image_url: url })} label="Class image" />

          <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
            <div className="space-y-2">
              <Label htmlFor="ct-name">Class name <span className="text-destructive">*</span></Label>
              <Input
                id="ct-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Pilates, Power Yoga, Zumba…"
                aria-invalid={!!errors.name}
                maxLength={80}
              />
              {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="ct-category">Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger id="ct-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CLASS_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ct-description">Description</Label>
            <Textarea
              id="ct-description"
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What members can expect — intensity, who it suits, what to bring."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ct-venue">Default studio / venue</Label>
            <Input
              id="ct-venue"
              value={form.default_venue}
              onChange={(e) => setForm({ ...form, default_venue: e.target.value })}
              placeholder="Studio 1, Rooftop deck…"
            />
            <p className="text-xs text-muted-foreground">Each schedule rule can override this.</p>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">How booking is charged</p>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as ChargeMode)} className="grid gap-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
                <RadioGroupItem value="free" className="mt-0.5" aria-label="Free for everyone" />
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium"><Sparkles className="h-3.5 w-3.5" /> Free for everyone</div>
                  <p className="text-xs text-muted-foreground">Any active member can book — no quota, no charge.</p>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
                <RadioGroupItem value="benefit" className="mt-0.5" aria-label="Included in plan benefit" />
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium"><Gift className="h-3.5 w-3.5" /> Included in plan benefit</div>
                  <p className="text-xs text-muted-foreground">Each booking uses one class credit from the member's plan.</p>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
                <RadioGroupItem value="paid" className="mt-0.5" aria-label="Paid workshop" />
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium"><IndianRupee className="h-3.5 w-3.5" /> Paid class</div>
                  <p className="text-xs text-muted-foreground">An invoice is raised automatically when a member books.</p>
                </div>
              </label>
            </RadioGroup>
          </div>

          {mode === 'benefit' && (
            <div className="space-y-3 rounded-xl border p-4">
              <div className="space-y-2">
                <Label htmlFor="ct-benefit">Linked benefit <span className="text-destructive">*</span></Label>
                <Select value={form.benefit_type_id} onValueChange={(v) => setForm({ ...form, benefit_type_id: v })}>
                  <SelectTrigger id="ct-benefit" aria-invalid={!!errors.benefit_type_id}><SelectValue placeholder="Select a benefit" /></SelectTrigger>
                  <SelectContent>
                    {benefitOptions.map((bt) => <SelectItem key={bt.id} value={bt.id}>{bt.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {errors.benefit_type_id && <p className="text-xs text-destructive">{errors.benefit_type_id}</p>}
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="ct-requires" className="text-sm">Only members whose plan includes it</Label>
                  <p className="text-xs text-muted-foreground">Off: members without the benefit can still book for free.</p>
                </div>
                <Switch id="ct-requires" checked={form.requires_benefit} onCheckedChange={(v) => setForm({ ...form, requires_benefit: v })} />
              </div>
            </div>
          )}

          {mode === 'paid' && (
            <div className="space-y-3 rounded-xl border p-4">
              <div className="space-y-2">
                <Label htmlFor="ct-price">Price (₹) <span className="text-destructive">*</span></Label>
                <Input id="ct-price" type="number" min={0} step="1" value={form.price} aria-invalid={!!errors.price}
                  onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} />
                {errors.price && <p className="text-xs text-destructive">{errors.price}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="ct-gst">GST rate (%)</Label>
                  <Input id="ct-gst" type="number" min={0} max={100} value={form.gst_rate} aria-invalid={!!errors.gst_rate}
                    onChange={(e) => setForm({ ...form, gst_rate: Number(e.target.value) })} />
                  {errors.gst_rate && <p className="text-xs text-destructive">{errors.gst_rate}</p>}
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Switch checked={form.is_gst_inclusive} onCheckedChange={(v) => setForm({ ...form, is_gst_inclusive: v })} aria-label="Price includes GST" />
                    Price includes GST
                  </label>
                </div>
              </div>
            </div>
          )}

          {isEdit && (
            <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
              <div>
                <Label htmlFor="ct-active" className="text-sm">Class is active</Label>
                <p className="text-xs text-muted-foreground">Turning it off pauses every rule and removes unbooked future sessions.</p>
              </div>
              <Switch id="ct-active" checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
            </div>
          )}
        </form>

        <SheetFooter className="flex-row justify-end gap-2 border-t px-6 py-4">
          <Button type="button" variant="outline" className="cursor-pointer" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button type="submit" form="class-type-form" className="cursor-pointer" disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? 'Save changes' : 'Create class'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
