import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { ImagePlus, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { uploadProductImage } from '@/services/productService';
import { variantName } from '@/lib/products/variantRules';

interface OptionRow {
  id?: string;
  option_value: string;
  swatch_color: string;
  sku: string;
  price: string;
  cost_price: string;
  image_url: string;
  is_sellable: boolean;
  variant_sort: number;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  parentId: string | null;
}

export function ManageOptionsDrawer({ open, onOpenChange, parentId }: Props) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<OptionRow[]>([]);
  const [optionType, setOptionType] = useState('');
  const [uploading, setUploading] = useState<number | null>(null);

  const q = useQuery({
    queryKey: ['product-options', parentId],
    enabled: open && !!parentId,
    queryFn: async () => {
      const { data: parent, error: pe } = await supabase.from('products').select('*').eq('id', parentId!).single();
      if (pe) throw pe;
      const { data: kids, error } = await supabase.from('products').select('*').eq('parent_product_id', parentId!).eq('is_active', true).order('variant_sort');
      if (error) throw error;
      return { parent, kids: kids ?? [] };
    },
  });

  useEffect(() => {
    if (!q.data) return;
    setOptionType(q.data.parent.option_type ?? '');
    setRows(q.data.kids.map((k) => ({
      id: k.id, option_value: k.option_value ?? '', swatch_color: k.swatch_color ?? '', sku: k.sku ?? '',
      price: String(k.price ?? ''), cost_price: k.cost_price != null ? String(k.cost_price) : '',
      image_url: k.image_url ?? '', is_sellable: !!k.is_sellable, variant_sort: k.variant_sort ?? 0,
    })));
  }, [q.data]);

  const update = (i: number, p: Partial<OptionRow>) => setRows((r) => r.map((x, idx) => (idx === i ? { ...x, ...p } : x)));

  const save = useMutation({
    mutationFn: async () => {
      if (!q.data) return;
      const names = rows.map((r) => r.option_value.trim().toLowerCase());
      if (names.some((n) => !n)) throw new Error('Every option needs a name');
      if (new Set(names).size !== names.length) throw new Error('Option names must be different');
      const skus = rows.map((r) => r.sku.trim().toLowerCase()).filter(Boolean);
      if (new Set(skus).size !== skus.length) throw new Error('SKUs must be different');
      if (rows.some((r) => r.is_sellable && !(Number(r.price) > 0))) throw new Error('Options sold at POS need a price above ₹0');
      const { parent } = q.data;
      const type = optionType.trim() || parent.option_type;
      for (const [i, r] of rows.entries()) {
        const fields = {
          name: variantName(parent.name, r.option_value.trim()),
          option_type: type, option_value: r.option_value.trim(), swatch_color: r.swatch_color || null,
          sku: r.sku.trim() || null, price: Number(r.price) || 0,
          cost_price: r.cost_price ? Number(r.cost_price) : null,
          image_url: r.image_url || parent.image_url, is_sellable: r.is_sellable, variant_sort: i,
        };
        if (r.id) {
          const { error } = await supabase.from('products').update(fields).eq('id', r.id);
          if (error) throw error;
        } else {
          const { id: _id, created_at: _c, updated_at: _u, is_variant_parent: _v, ...base } = parent as Record<string, unknown>;
          const { error } = await supabase.from('products').insert({ ...(base as object), ...fields, parent_product_id: parent.id, is_variant_parent: false } as never);
          if (error) throw error;
        }
      }
      const prices = rows.map((r) => Number(r.price)).filter((p) => p > 0);
      await supabase.from('products').update({ option_type: type, price: prices.length ? Math.min(...prices) : 0 }).eq('id', parent.id);
    },
    onSuccess: () => {
      toast.success('Options saved');
      qc.invalidateQueries({ queryKey: ['product-options'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['pos-products'] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addRow = () => setRows((r) => [...r, { option_value: '', swatch_color: '', sku: '', price: '', cost_price: '', image_url: '', is_sellable: false, variant_sort: r.length }]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border p-5">
          <SheetTitle>Manage options</SheetTitle>
          <SheetDescription>{q.data?.parent.name ?? 'Loading…'} — edit each option's name, colour, SKU, price and photo, or add a new one. Stock is changed with "Adjust stock" on each option row.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {q.isLoading ? <Skeleton className="h-40 w-full" /> : q.isError ? <p className="text-sm text-destructive">Couldn't load options.</p> : (
            <>
              <div className="space-y-2">
                <Label htmlFor="mo-type">Option type</Label>
                <Input id="mo-type" value={optionType} onChange={(e) => setOptionType(e.target.value)} placeholder="e.g. Flavour" />
              </div>
              <ol className="space-y-3">
                {rows.map((r, i) => (
                  <li key={r.id ?? `new-${i}`} className="space-y-3 rounded-xl border border-border bg-card p-3">
                    <div className="flex items-start gap-3">
                      <label className="relative flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-border bg-muted focus-within:ring-2 focus-within:ring-ring">
                        {uploading === i ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : r.image_url ? <img src={r.image_url} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="h-5 w-5 text-muted-foreground" aria-hidden />}
                        <input type="file" accept="image/*" className="sr-only" aria-label={`Photo for option ${i + 1}`}
                          onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setUploading(i); try { update(i, { image_url: await uploadProductImage(f) }); } catch (err) { toast.error(err instanceof Error ? err.message : 'Upload failed'); } finally { setUploading(null); } }} />
                      </label>
                      <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_auto]">
                        <div className="space-y-1">
                          <Label htmlFor={`mo-name-${i}`}>Option name</Label>
                          <Input id={`mo-name-${i}`} value={r.option_value} onChange={(e) => update(i, { option_value: e.target.value })} placeholder="e.g. Chocolate" />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`mo-col-${i}`}>Colour</Label>
                          <Input id={`mo-col-${i}`} type="color" className="h-10 w-14 p-1" value={r.swatch_color || '#888888'} onChange={(e) => update(i, { swatch_color: e.target.value })} />
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div className="space-y-1"><Label htmlFor={`mo-sku-${i}`}>SKU</Label><Input id={`mo-sku-${i}`} value={r.sku} onChange={(e) => update(i, { sku: e.target.value })} /></div>
                      <div className="space-y-1"><Label htmlFor={`mo-price-${i}`}>Price (₹)</Label><Input id={`mo-price-${i}`} type="number" min="0" value={r.price} onChange={(e) => update(i, { price: e.target.value })} /></div>
                      <div className="space-y-1"><Label htmlFor={`mo-cost-${i}`}>Cost (₹)</Label><Input id={`mo-cost-${i}`} type="number" min="0" value={r.cost_price} onChange={(e) => update(i, { cost_price: e.target.value })} /></div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch id={`mo-sell-${i}`} checked={r.is_sellable} onCheckedChange={(v) => update(i, { is_sellable: v })} />
                      <Label htmlFor={`mo-sell-${i}`} className="text-sm font-normal">Sell at POS</Label>
                    </div>
                  </li>
                ))}
              </ol>
              <Button type="button" variant="outline" onClick={addRow}><Plus className="mr-2 h-4 w-4" aria-hidden />Add option</Button>
              <p className="text-xs text-muted-foreground">To remove an option, delete its row from the product list. New options start with zero stock.</p>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !q.data}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}Save options
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
