import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, Package, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { safeBenefitEnum } from '@/lib/benefitEnums';

interface BenefitPackageRow {
  id: string;
  branch_id: string;
  name: string;
  description: string | null;
  benefit_type_id: string | null;
  quantity: number;
  price: number;
  validity_days: number;
  is_active: boolean;
  display_order: number;
  hsn_code?: string | null;
  tax_rate?: number | null;
  tax_inclusive?: boolean | null;
  gst_category?: 'goods' | 'services' | null;
}

const GST_RATES = [0, 5, 12, 18, 28];
const DEFAULT_GST_RATE = 5;

interface AddBenefitPackageDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId?: string;
  initial?: BenefitPackageRow | null;
}

export function AddBenefitPackageDrawer({ open, onOpenChange, branchId, initial }: AddBenefitPackageDrawerProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [benefitTypeId, setBenefitTypeId] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(5);
  const [price, setPrice] = useState<number>(0);
  const [validityDays, setValidityDays] = useState<number>(30);
  const [isActive, setIsActive] = useState(true);
  const [displayOrder, setDisplayOrder] = useState<number>(0);
  const [hsnCode, setHsnCode] = useState<string>('');
  const [taxRate, setTaxRate] = useState<number>(DEFAULT_GST_RATE);
  const [taxInclusive, setTaxInclusive] = useState<boolean>(true);
  const [gstCategory, setGstCategory] = useState<'goods' | 'services'>('services');
  const [safetyNotes, setSafetyNotes] = useState('');
  const [terms, setTerms] = useState('');

  const { data: benefitTypes = [] } = useQuery({
    queryKey: ['benefit-types-for-package', branchId],
    enabled: !!branchId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('benefit_types')
        .select('id, name, code, category, safety_notes, terms')
        .eq('branch_id', branchId!)
        .eq('is_active', true)
        .order('display_order');
      if (error) throw error;
      return data || [];
    },
  });

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name || '');
      setDescription(initial.description || '');
      setBenefitTypeId(initial.benefit_type_id || '');
      setQuantity(initial.quantity || 5);
      setPrice(Number(initial.price) || 0);
      setValidityDays(initial.validity_days || 30);
      setIsActive(initial.is_active);
      setDisplayOrder(initial.display_order || 0);
      setHsnCode(initial.hsn_code || '');
      setTaxRate(Number(initial.tax_rate ?? DEFAULT_GST_RATE));
      setTaxInclusive(initial.tax_inclusive ?? true);
      setGstCategory((initial.gst_category as 'goods' | 'services') || 'services');
    } else {
      setName('');
      setDescription('');
      setBenefitTypeId('');
      setQuantity(5);
      setPrice(0);
      setValidityDays(30);
      setIsActive(true);
      setDisplayOrder(0);
      setHsnCode('');
      setTaxRate(DEFAULT_GST_RATE);
      setTaxInclusive(true);
      setGstCategory('services');
      setSafetyNotes('');
      setTerms('');
    }
  }, [open, initial]);

  // Safety notes & terms live on the benefit type (shared across its packages).
  useEffect(() => {
    if (!open || !benefitTypeId) return;
    const selected = benefitTypes.find((b) => b.id === benefitTypeId) as
      | { safety_notes?: string | null; terms?: string | null }
      | undefined;
    setSafetyNotes(selected?.safety_notes || '');
    setTerms(selected?.terms || '');
  }, [open, benefitTypeId, benefitTypes]);

  const save = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error('Select a branch first');
      if (!name.trim()) throw new Error('Name is required');
      if (!benefitTypeId) throw new Error('Pick a benefit type');
      if (price < 0) throw new Error('Price cannot be negative');

      // benefit_types.code is free-form; map it onto a valid benefit_type enum value.
      const selected = benefitTypes.find((b) => b.id === benefitTypeId) as { code?: string } | undefined;
      const enumValue = safeBenefitEnum(selected?.code || '');

      const payload = {
        branch_id: branchId,
        name: name.trim(),
        description: description.trim() || null,
        benefit_type: enumValue,
        benefit_type_id: benefitTypeId,
        quantity,
        price,
        validity_days: validityDays,
        is_active: isActive,
        display_order: displayOrder,
        hsn_code: hsnCode.trim() || null,
        tax_rate: taxRate,
        tax_inclusive: taxInclusive,
        gst_category: gstCategory,
      };

      if (initial?.id) {
        const { error } = await (supabase as any).from('benefit_packages').update(payload).eq('id', initial.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from('benefit_packages').insert(payload);
        if (error) throw error;
      }

      // Persist safety/terms on the benefit type so members see them before buying or booking.
      const { error: typeError } = await (supabase as any)
        .from('benefit_types')
        .update({ safety_notes: safetyNotes.trim() || null, terms: terms.trim() || null })
        .eq('id', benefitTypeId);
      if (typeError) throw typeError;
    },
    onSuccess: () => {
      toast.success(initial ? 'Add-on package updated' : 'Add-on package created');
      queryClient.invalidateQueries({ queryKey: ['benefit-packages-admin'] });
      queryClient.invalidateQueries({ queryKey: ['addon-benefit-packages'] });
      queryClient.invalidateQueries({ queryKey: ['store-addons-benefit-packages'] });
      queryClient.invalidateQueries({ queryKey: ['benefit-types-for-package'] });
      queryClient.invalidateQueries({ queryKey: ['addon-benefit-type-safety'] });
      onOpenChange(false);
    },
    onError: (err: any) => toast.error(err.message || 'Save failed'),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            {initial ? 'Edit Add-On Package' : 'New Add-On Package'}
          </SheetTitle>
          <SheetDescription>
            Define a benefit credit pack members can purchase from the dashboard.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 mt-6">
          <div className="space-y-2">
            <Label htmlFor="pkg-name">Package Name</Label>
            <Input id="pkg-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 5 × Sauna Sessions" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pkg-description">Description</Label>
            <Textarea id="pkg-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="What the member gets. Line breaks are preserved on the member dashboard." />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pkg-benefit-type">Benefit Type</Label>
            <Select value={benefitTypeId} onValueChange={setBenefitTypeId}>
              <SelectTrigger id="pkg-benefit-type"><SelectValue placeholder="Select a benefit" /></SelectTrigger>
              <SelectContent>
                {benefitTypes.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="pkg-quantity">Credits / Sessions</Label>
              <Input id="pkg-quantity" type="number" min={1} value={quantity} onChange={(e) => setQuantity(parseInt(e.target.value || '0', 10))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pkg-price">Price (₹)</Label>
              <Input id="pkg-price" type="number" min={0} value={price} onChange={(e) => setPrice(parseFloat(e.target.value || '0'))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="pkg-validity">Validity (days)</Label>
              <Input id="pkg-validity" type="number" min={1} value={validityDays} onChange={(e) => setValidityDays(parseInt(e.target.value || '0', 10))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pkg-order">Display Order</Label>
              <Input id="pkg-order" type="number" min={0} value={displayOrder} onChange={(e) => setDisplayOrder(parseInt(e.target.value || '0', 10))} />
            </div>
          </div>

          {/* Safety & Terms — stored on the benefit type, shown to members before purchase */}
          <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-warning" />
              <div>
                <p className="text-sm font-semibold">Safety &amp; Terms</p>
                <p className="text-xs text-muted-foreground">
                  Shown to members before they buy or book {benefitTypeId ? 'this service' : 'the selected service'}.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pkg-safety">Precautions / Tips</Label>
              <Textarea
                id="pkg-safety"
                value={safetyNotes}
                onChange={(e) => setSafetyNotes(e.target.value)}
                rows={4}
                disabled={!benefitTypeId}
                placeholder={'One per line, e.g.\nAvoid if pregnant or with heart conditions.\nHydrate well before and after.\nMax 15 minutes per session.'}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pkg-terms">Terms &amp; Conditions</Label>
              <Textarea
                id="pkg-terms"
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                rows={3}
                disabled={!benefitTypeId}
                placeholder="Credits are non-refundable and expire at the end of the validity period."
              />
            </div>
          </div>

          {/* Tax & GST */}
          <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Tax &amp; GST</p>
                <p className="text-xs text-muted-foreground">Configure HSN/SAC and tax treatment for invoices.</p>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="pkg-tax-inclusive" className="text-xs">Inclusive</Label>
                <Switch id="pkg-tax-inclusive" checked={taxInclusive} onCheckedChange={setTaxInclusive} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="pkg-hsn">HSN / SAC Code</Label>
                <Input id="pkg-hsn" value={hsnCode} onChange={(e) => setHsnCode(e.target.value)} placeholder="e.g. 999723" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pkg-gst-rate">GST Rate (%)</Label>
                <Select value={String(taxRate)} onValueChange={(v) => setTaxRate(Number(v))}>
                  <SelectTrigger id="pkg-gst-rate"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {GST_RATES.map((r) => (
                      <SelectItem key={r} value={String(r)}>{r}%</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pkg-gst-category">Category</Label>
              <Select value={gstCategory} onValueChange={(v) => setGstCategory(v as 'goods' | 'services')}>
                <SelectTrigger id="pkg-gst-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="services">Services (SAC)</SelectItem>
                  <SelectItem value="goods">Goods (HSN)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Live tax preview */}
            {price > 0 && (
              <div className="rounded-lg bg-background border border-border/60 p-3 text-xs space-y-1">
                {(() => {
                  const rate = taxRate / 100;
                  const base = taxInclusive ? price / (1 + rate) : price;
                  const tax = taxInclusive ? price - base : price * rate;
                  const total = taxInclusive ? price : price + tax;
                  return (
                    <>
                      <div className="flex justify-between"><span className="text-muted-foreground">Base</span><span className="font-medium">₹{base.toFixed(2)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">CGST ({(taxRate/2).toFixed(1)}%)</span><span className="font-medium">₹{(tax/2).toFixed(2)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">SGST ({(taxRate/2).toFixed(1)}%)</span><span className="font-medium">₹{(tax/2).toFixed(2)}</span></div>
                      <div className="flex justify-between border-t border-border/60 pt-1 mt-1"><span className="font-semibold">Total {taxInclusive ? '(incl. GST)' : '(+ GST)'}</span><span className="font-bold">₹{total.toFixed(2)}</span></div>
                    </>
                  );
                })()}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/30 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Active</p>
              <p className="text-xs text-muted-foreground">Members can buy this package when active.</p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} aria-label="Package active" />
          </div>
        </div>

        <SheetFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {initial ? 'Save Changes' : 'Create Package'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
