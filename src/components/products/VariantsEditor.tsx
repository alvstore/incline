import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ImagePlus, Loader2, Plus, Trash2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { uploadProductImage } from '@/services/productService';
import { OPTION_TYPE_PRESETS, emptyVariant, suggestSku, type VariantDraft } from '@/lib/products/variantRules';

interface Props {
  optionType: string;
  onOptionTypeChange: (v: string) => void;
  variants: VariantDraft[];
  onChange: (v: VariantDraft[]) => void;
  baseSku: string;
  showOpeningStock: boolean;
  sellable: boolean;
}

const CUSTOM = '__custom__';

export function VariantsEditor({ optionType, onOptionTypeChange, variants, onChange, baseSku, showOpeningStock, sellable }: Props) {
  const isPreset = (OPTION_TYPE_PRESETS as readonly string[]).includes(optionType);
  const [customMode, setCustomMode] = useState(!isPreset && !!optionType);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const fileRefs = useRef<Array<HTMLInputElement | null>>([]);

  const update = (i: number, patch: Partial<VariantDraft>) =>
    onChange(variants.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));

  const upload = async (i: number, file?: File) => {
    if (!file) return;
    setUploadingIdx(i);
    try {
      update(i, { image_url: await uploadProductImage(file) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploadingIdx(null);
    }
  };

  const typeLabel = optionType.trim() || 'Option';

  return (
    <fieldset className="space-y-4 rounded-xl border border-border bg-muted/40 p-4">
      <legend className="sr-only">Product options</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="option-type">Option type</Label>
          <Select
            value={customMode ? CUSTOM : optionType || undefined}
            onValueChange={(v) => {
              if (v === CUSTOM) { setCustomMode(true); onOptionTypeChange(''); }
              else { setCustomMode(false); onOptionTypeChange(v); }
            }}
          >
            <SelectTrigger id="option-type"><SelectValue placeholder="Choose…" /></SelectTrigger>
            <SelectContent>
              {OPTION_TYPE_PRESETS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              <SelectItem value={CUSTOM}>Custom…</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {customMode && (
          <div className="space-y-2">
            <Label htmlFor="option-type-custom">Custom option name</Label>
            <Input id="option-type-custom" value={optionType} onChange={(e) => onOptionTypeChange(e.target.value)} placeholder="e.g. Strength" />
          </div>
        )}
      </div>

      <ol className="space-y-3" aria-label={`${typeLabel} list`}>
        {variants.map((v, i) => {
          const n = i + 1;
          return (
            <li key={i} className="rounded-xl border border-border bg-card p-3 space-y-3">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => fileRefs.current[i]?.click()}
                  className="h-16 w-16 shrink-0 rounded-lg border border-dashed border-border bg-muted flex items-center justify-center overflow-hidden cursor-pointer hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={v.image_url ? `Change photo for ${v.value || `option ${n}`}` : `Add photo for ${v.value || `option ${n}`}`}
                >
                  {uploadingIdx === i ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
                    : v.image_url ? <img src={v.image_url} alt="" className="h-full w-full object-cover" />
                    : <ImagePlus className="h-5 w-5 text-muted-foreground" aria-hidden />}
                </button>
                <input ref={(el) => (fileRefs.current[i] = el)} type="file" accept="image/*" className="hidden" onChange={(e) => upload(i, e.target.files?.[0])} />
                <div className="flex-1 grid gap-2 sm:grid-cols-[1fr_auto]">
                  <div className="space-y-1">
                    <Label htmlFor={`v-value-${i}`} className="text-xs">{typeLabel} {n} *</Label>
                    <Input id={`v-value-${i}`} value={v.value} onChange={(e) => update(i, { value: e.target.value })} placeholder={i === 0 ? 'Chocolate' : i === 1 ? 'Vanilla' : 'Mango'} aria-required />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`v-swatch-${i}`} className="text-xs">Swatch</Label>
                    <Input id={`v-swatch-${i}`} type="color" className="h-10 w-14 p-1 cursor-pointer" value={v.swatch_color || '#888888'} onChange={(e) => update(i, { swatch_color: e.target.value })} />
                  </div>
                </div>
                <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" disabled={variants.length <= 2}
                  onClick={() => onChange(variants.filter((_, idx) => idx !== i))} aria-label={`Remove ${v.value || `option ${n}`}`}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
              <div className={`grid gap-2 ${showOpeningStock ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
                <div className="space-y-1">
                  <Label htmlFor={`v-sku-${i}`} className="text-xs">SKU</Label>
                  <div className="flex">
                    <Input id={`v-sku-${i}`} value={v.sku} onChange={(e) => update(i, { sku: e.target.value })} placeholder="SKU" className="rounded-r-none" />
                    <Button type="button" variant="outline" size="icon" className="rounded-l-none border-l-0 shrink-0" disabled={!v.value.trim()}
                      onClick={() => update(i, { sku: suggestSku(baseSku, v.value) })} aria-label={`Suggest SKU for ${v.value || `option ${n}`}`}>
                      <Wand2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`v-price-${i}`} className="text-xs">Price (₹){sellable ? ' *' : ''}</Label>
                  <Input id={`v-price-${i}`} type="number" min="0" step="0.01" value={v.price} onChange={(e) => update(i, { price: e.target.value })} placeholder="999" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`v-cost-${i}`} className="text-xs">Cost (₹)</Label>
                  <Input id={`v-cost-${i}`} type="number" min="0" step="0.01" value={v.cost_price} onChange={(e) => update(i, { cost_price: e.target.value })} placeholder="600" />
                </div>
                {showOpeningStock && (
                  <div className="space-y-1">
                    <Label htmlFor={`v-stock-${i}`} className="text-xs">Opening stock</Label>
                    <Input id={`v-stock-${i}`} type="number" min="0" step="1" value={v.opening_stock} onChange={(e) => update(i, { opening_stock: e.target.value })} placeholder="10" />
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...variants, emptyVariant()])}>
          <Plus className="h-4 w-4 mr-1" aria-hidden /> Add {typeLabel.toLowerCase()}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => {
          const first = variants[0];
          onChange(variants.map((v, i) => i === 0 ? v : { ...v, price: v.price || first.price, cost_price: v.cost_price || first.cost_price }));
        }}>Copy first price to empty rows</Button>
      </div>
      <p className="text-xs text-muted-foreground">Each option is stocked and sold separately. Options without a photo use the main product photo.</p>
    </fieldset>
  );
}
