import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { CheckCircle2, ImagePlus, Loader2, PackageCheck } from 'lucide-react';
import { uploadProductImage } from '@/services/productService';
import { canActivateProduct } from '@/lib/purchases/parsePurchaseSheet';
import { track } from '@/lib/analytics';

interface Row { id: string; name: string; price: number; cost_price: number | null; image_url: string | null; hsn_code: string | null; tax_rate: number | null }

function ActivateCard({ p }: { p: Row }) {
  const qc = useQueryClient();
  const [price, setPrice] = useState(p.price > 0 ? String(p.price) : '');
  const [image, setImage] = useState(p.image_url);
  const [uploading, setUploading] = useState(false);
  const ready = canActivateProduct({ image_url: image, price: Number(price) });

  const save = useMutation({
    mutationFn: async (activate: boolean) => {
      const { error } = await supabase.from('products').update({ price: Number(price) || 0, image_url: image, ...(activate ? { is_sellable: true } : {}) }).eq('id', p.id);
      if (error) throw new Error(error.message);
      return activate;
    },
    onSuccess: (activated) => {
      toast.success(activated ? `${p.name} is now available for sale` : 'Saved');
      if (activated) track('product_activated', { source: 'purchase_import' });
      qc.invalidateQueries({ queryKey: ['products-to-activate'] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onFile = async (f?: File) => {
    if (!f) return;
    setUploading(true);
    try { setImage(await uploadProductImage(f)); } catch (e) { toast.error((e as Error).message); } finally { setUploading(false); }
  };
  const inputId = `img-${p.id}`;

  return (
    <Card className="rounded-xl border border-border">
      <CardContent className="p-5 space-y-3">
        <label htmlFor={inputId} className="block aspect-square rounded-lg border border-dashed border-border bg-muted/40 overflow-hidden cursor-pointer hover:bg-secondary transition-colors focus-within:ring-2 focus-within:ring-ring">
          {image ? <img src={image} alt={p.name} className="h-full w-full object-cover" /> : (
            <span className="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground text-sm">
              {uploading ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : <ImagePlus className="h-6 w-6" aria-hidden />}
              Add photo
            </span>
          )}
          <input id={inputId} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label={`Upload photo for ${p.name}`} onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <div>
          <p className="font-semibold leading-tight">{p.name}</p>
          <p className="text-xs text-muted-foreground">Cost ₹{p.cost_price ?? 0} · HSN {p.hsn_code || '—'} · GST {p.tax_rate ?? 0}%</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`price-${p.id}`}>Selling price (₹)</Label>
          <Input id={`price-${p.id}`} type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} aria-describedby={`hint-${p.id}`} />
          <p id={`hint-${p.id}`} className="text-xs text-muted-foreground">{ready ? 'Ready to activate' : 'Needs a photo and a selling price'}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled={save.isPending} onClick={() => save.mutate(false)}>Save</Button>
          <Button className="flex-1" disabled={!ready || save.isPending} onClick={() => save.mutate(true)}>
            <CheckCircle2 className="h-4 w-4 mr-1" aria-hidden />Activate
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ProductsToActivate() {
  const { data = [], isLoading, isError } = useQuery({
    queryKey: ['products-to-activate'],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('id, name, price, cost_price, image_url, hsn_code, tax_rate').eq('is_active', true).eq('is_sellable', false).order('name');
      if (error) throw error;
      return data as Row[];
    },
  });
  if (isLoading) return <div className="grid gap-4 grid-cols-12">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="col-span-12 sm:col-span-6 lg:col-span-3 h-80 rounded-xl" />)}</div>;
  if (isError) return <p className="text-destructive text-sm">Could not load products.</p>;
  if (!data.length) return (
    <Card className="rounded-xl border border-border"><CardContent className="p-10 text-center text-muted-foreground">
      <PackageCheck className="h-8 w-8 mx-auto mb-2" aria-hidden />Every product is live. New products from purchase bills will appear here.
    </CardContent></Card>
  );
  return (
    <div className="grid gap-4 grid-cols-12">
      {data.map((p) => <div key={p.id} className="col-span-12 sm:col-span-6 lg:col-span-3"><ActivateCard p={p} /></div>)}
    </div>
  );
}
