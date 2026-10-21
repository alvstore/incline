import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, ImagePlus, Loader2, PackageCheck, Sparkles } from 'lucide-react';
import { uploadProductImage } from '@/services/productService';
import { canActivateProduct } from '@/lib/purchases/parsePurchaseSheet';
import { DEFAULT_PRODUCT_IMAGE, marginPercent } from '@/lib/products/productRules';
import { useBranchContext } from '@/contexts/BranchContext';
import { track } from '@/lib/analytics';

interface Row { id: string; name: string; price: number; cost_price: number | null; image_url: string | null; hsn_code: string | null; tax_rate: number | null }

function ActivateCard({ p }: { p: Row }) {
  const qc = useQueryClient();
  const [price, setPrice] = useState(p.price > 0 ? String(p.price) : '');
  const [image, setImage] = useState(p.image_url);
  const [uploading, setUploading] = useState(false);
  const priceNum = Number(price) || 0;
  const ready = canActivateProduct({ image_url: image, price: priceNum });
  const margin = marginPercent(priceNum, p.cost_price);
  const belowCost = priceNum > 0 && Number(p.cost_price ?? 0) > priceNum;

  const save = useMutation({
    mutationFn: async (activate: boolean) => {
      const { error } = await supabase
        .from('products')
        .update({ price: priceNum, image_url: image, ...(activate ? { is_sellable: true } : {}) })
        .eq('id', p.id);
      if (error) throw new Error(error.message);
      return activate;
    },
    onSuccess: (activated) => {
      toast.success(activated ? `${p.name} is now on sale at POS and in the member store` : 'Saved');
      if (activated) track('product_activated', { source: 'ready_to_sell' });
      ['products-to-activate', 'products', 'pos-products'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: Error) => toast.error('Could not save', { description: e.message }),
  });

  const onFile = async (f?: File) => {
    if (!f) return;
    setUploading(true);
    try { setImage(await uploadProductImage(f)); } catch (e) { toast.error((e as Error).message); } finally { setUploading(false); }
  };
  const inputId = `img-${p.id}`;
  const hint = !priceNum ? 'Enter a selling price above ₹0' : !image ? 'Add a photo or use the standard photo' : 'Ready to sell';

  return (
    <Card className="rounded-xl border border-border h-full">
      <CardContent className="p-5 space-y-3 flex flex-col h-full">
        <label
          htmlFor={inputId}
          className="relative block aspect-square rounded-lg border border-dashed border-border bg-muted/40 overflow-hidden cursor-pointer hover:bg-secondary transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
        >
          {image ? <img src={image} alt={p.name} className="h-full w-full object-cover" /> : (
            <span className="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground text-sm">
              {uploading ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : <ImagePlus className="h-6 w-6" aria-hidden />}
              Upload photo
            </span>
          )}
          <input id={inputId} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label={`Upload photo for ${p.name}`} onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        {!image && (
          <Button type="button" variant="outline" size="sm" onClick={() => setImage(DEFAULT_PRODUCT_IMAGE)}>
            <Sparkles className="h-4 w-4 mr-1" aria-hidden /> Use standard photo
          </Button>
        )}
        <div>
          <p className="font-semibold leading-tight">{p.name}</p>
          <p className="text-xs text-muted-foreground">
            Cost ₹{Number(p.cost_price ?? 0).toLocaleString('en-IN')} · HSN {p.hsn_code || '—'} · GST {p.tax_rate ?? 0}%
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`price-${p.id}`}>Selling price (₹)</Label>
          <Input id={`price-${p.id}`} type="number" min={0} step="0.01" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-describedby={`hint-${p.id}`} />
          <p id={`hint-${p.id}`} className={`text-xs flex items-center gap-1 ${belowCost ? 'text-amber-500' : ready ? 'text-emerald-500' : 'text-muted-foreground'}`}>
            {belowCost ? <AlertTriangle className="h-3 w-3" aria-hidden /> : ready ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : null}
            {belowCost ? 'Below cost — you would sell at a loss' : hint}
            {margin !== null && !belowCost ? ` · ${margin}% margin` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 mt-auto pt-1">
          <Button variant="outline" className="flex-1" disabled={save.isPending} onClick={() => save.mutate(false)}>Save</Button>
          <Button className="flex-1" disabled={!ready || save.isPending} onClick={() => save.mutate(true)} aria-describedby={`hint-${p.id}`}>
            {save.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4 mr-1" aria-hidden />}
            Put on sale
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ProductsToActivate() {
  const { branchFilter } = useBranchContext();
  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['products-to-activate', branchFilter],
    queryFn: async () => {
      let q = supabase.from('products').select('id, name, price, cost_price, image_url, hsn_code, tax_rate').eq('is_active', true).eq('is_sellable', false).eq('is_variant_parent', false).order('name');
      if (branchFilter) q = q.or(`branch_id.is.null,branch_id.eq.${branchFilter}`);
      const { data, error } = await q;
      if (error) throw error;
      return data as Row[];
    },
  });
  if (isLoading) return <div className="grid gap-4 grid-cols-12">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="col-span-12 sm:col-span-6 lg:col-span-3 h-96 rounded-xl" />)}</div>;
  if (isError) return (
    <Card className="rounded-xl border border-border"><CardContent className="p-8 text-center space-y-3">
      <p className="text-sm text-muted-foreground">Could not load products.</p>
      <Button variant="outline" size="sm" onClick={() => refetch()}>Try again</Button>
    </CardContent></Card>
  );
  if (!data.length) return (
    <Card className="rounded-xl border border-border"><CardContent className="p-10 text-center text-muted-foreground">
      <PackageCheck className="h-8 w-8 mx-auto mb-2" aria-hidden />Every product is on sale. New products from purchase bills will appear here.
    </CardContent></Card>
  );
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        These products are in stock but not on sale yet. Set a selling price, add a photo (or use the standard photo), then put them on sale.
      </p>
      <div className="grid gap-4 grid-cols-12">
        {data.map((p) => <div key={p.id} className="col-span-12 sm:col-span-6 lg:col-span-4 2xl:col-span-3"><ActivateCard p={p} /></div>)}
      </div>
    </div>
  );
}
