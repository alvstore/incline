import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ArrowRight, Equal, Info, Layers, Loader2, Minus, Plus } from 'lucide-react';
import { adjustStock, setReorderLevel } from '@/services/inventoryService';
import { fetchBatches } from '@/services/batchService';
import { previewAdjustment, reasonsForMode, type StockMode, type StockReason } from '@/lib/products/productRules';

export interface AdjustStockProduct {
  id: string;
  name: string;
  requires_batch_tracking?: boolean | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: AdjustStockProduct | null;
  branchId: string | undefined;
  branchName?: string;
  /** Open the Add batch drawer (receiving new stock for batch-tracked products). */
  onAddBatch?: () => void;
}

const MODE_COPY: Record<StockMode, { label: string; help: string }> = {
  add: { label: 'Add', help: 'Increase stock by this many units' },
  remove: { label: 'Remove', help: 'Take this many units out of stock' },
  set: { label: 'Set count', help: 'Replace stock with what you physically counted' },
};

export function AdjustStockDrawer({ open, onOpenChange, product, branchId, branchName, onAddBatch }: Props) {
  const qc = useQueryClient();
  const batched = !!product?.requires_batch_tracking;
  const [mode, setMode] = useState<StockMode>('set');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState<StockReason>('count');
  const [notes, setNotes] = useState('');
  const [batchId, setBatchId] = useState<string>('');
  const [minQty, setMinQty] = useState('');

  const { data: inv, isLoading: invLoading } = useQuery({
    queryKey: ['inventory-row', product?.id, branchId],
    enabled: open && !!product && !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory')
        .select('id, quantity, min_quantity')
        .eq('product_id', product!.id)
        .eq('branch_id', branchId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: batches = [] } = useQuery({
    queryKey: ['product-batches', product?.id, branchId],
    enabled: open && batched && !!branchId,
    queryFn: () => fetchBatches(product!.id, branchId),
  });
  const usableBatches = batches.filter((b) => b.status !== 'recalled');

  useEffect(() => {
    if (!open) return;
    setMode(batched ? 'remove' : 'set');
    setReason(batched ? 'damaged' : 'count');
    setQty('');
    setNotes('');
    setBatchId('');
  }, [open, product?.id, batched]);

  useEffect(() => {
    if (open) setMinQty(inv ? String(inv.min_quantity ?? 5) : '5');
  }, [open, inv]);

  // Keep reason valid for the chosen mode.
  useEffect(() => {
    const allowed = reasonsForMode(mode);
    if (!allowed.some((r) => r.value === reason)) setReason(allowed[0].value);
  }, [mode, reason]);

  const selectedBatch = usableBatches.find((b) => b.id === batchId);
  const current = batched && selectedBatch ? selectedBatch.quantity_remaining : inv?.quantity ?? 0;
  const parsedQty = qty === '' ? NaN : Number(qty);
  const preview = qty === '' ? null : previewAdjustment(current, mode, parsedQty);
  const needsBatch = batched && mode !== 'remove' && !batchId;
  const minChanged = minQty !== '' && Number(minQty) !== (inv?.min_quantity ?? 5);

  const canSubmit = useMemo(() => {
    if (!branchId || !product) return false;
    if (qty === '' && minChanged) return Number(minQty) >= 0;
    if (!preview || 'error' in preview) return false;
    if (needsBatch) return false;
    return true;
  }, [branchId, product, qty, minChanged, minQty, preview, needsBatch]);

  const save = useMutation({
    mutationFn: async () => {
      if (!product || !branchId) throw new Error('Choose a branch first');
      if (minChanged) await setReorderLevel(product.id, branchId, Math.max(0, Math.floor(Number(minQty))));
      if (qty === '') return null;
      return adjustStock({
        productId: product.id,
        branchId,
        mode,
        quantity: parsedQty,
        reason,
        notes: notes.trim() || null,
        batchId: batched && batchId ? batchId : null,
      });
    },
    onSuccess: (res) => {
      toast.success(res ? `${product?.name}: stock now ${res.new_quantity}` : 'Reorder level saved');
      ['inventory', 'products', 'pos-products', 'pos-active-batches', 'stock-movements', 'product-batches', 'inventory-row', 'store-inventory-stats'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error('Could not update stock', { description: e.message }),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg flex flex-col p-0 gap-0">
        <SheetHeader className="p-6 pb-4 border-b border-border">
          <SheetTitle>Adjust stock</SheetTitle>
          <SheetDescription>
            {product?.name}
            {branchName ? ` · ${branchName}` : ''}
          </SheetDescription>
        </SheetHeader>

        <form
          id="adjust-stock-form"
          className="flex-1 overflow-y-auto p-6 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) save.mutate();
          }}
        >
          {!branchId && (
            <Alert variant="destructive">
              <AlertDescription>Pick a single branch in the header to adjust its stock.</AlertDescription>
            </Alert>
          )}

          <div className="rounded-xl border border-border bg-muted/40 p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {batched && selectedBatch ? `Batch ${selectedBatch.batch_number}` : 'In stock now'}
              </p>
              <p className="text-3xl font-bold tabular-nums">{invLoading ? '—' : current}</p>
            </div>
            {preview && !('error' in preview) && (
              <div className="flex items-center gap-3" aria-live="polite">
                <ArrowRight className="h-5 w-5 text-muted-foreground" aria-hidden />
                <div className="text-right">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">After</p>
                  <p className="text-3xl font-bold tabular-nums text-primary">{preview.next}</p>
                </div>
              </div>
            )}
          </div>

          {batched && (
            <Alert>
              <Layers className="h-4 w-4" aria-hidden />
              <AlertDescription className="space-y-2">
                <p>This product is tracked by batch. Receive new stock with Add batch; use this panel for counts, damage and expiry.</p>
                {onAddBatch && (
                  <Button type="button" size="sm" variant="outline" onClick={onAddBatch}>
                    <Plus className="h-4 w-4 mr-1" aria-hidden /> Add batch
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">What do you want to do?</legend>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Adjustment type">
              {(['add', 'remove', 'set'] as StockMode[]).map((m) => {
                const Icon = m === 'add' ? Plus : m === 'remove' ? Minus : Equal;
                return (
                  <Button
                    key={m}
                    type="button"
                    variant={mode === m ? 'default' : 'outline'}
                    aria-pressed={mode === m}
                    className="h-11"
                    onClick={() => setMode(m)}
                  >
                    <Icon className="h-4 w-4 mr-1" aria-hidden /> {MODE_COPY[m].label}
                  </Button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">{MODE_COPY[mode].help}</p>
          </fieldset>

          {batched && (
            <div className="space-y-2">
              <Label htmlFor="adj-batch">
                Batch {mode === 'remove' ? '(optional — oldest expiry first if left blank)' : '*'}
              </Label>
              <Select value={batchId || '__auto__'} onValueChange={(v) => setBatchId(v === '__auto__' ? '' : v)}>
                <SelectTrigger id="adj-batch"><SelectValue placeholder="Choose batch" /></SelectTrigger>
                <SelectContent>
                  {mode === 'remove' && <SelectItem value="__auto__">Oldest expiry first</SelectItem>}
                  {usableBatches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.batch_number} · {b.quantity_remaining} left{b.exp_date ? ` · exp ${b.exp_date}` : ''}
                      {b.status !== 'active' ? ` · ${b.status}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {usableBatches.length === 0 && (
                <p className="text-xs text-muted-foreground">No batches yet for this branch — use Add batch to receive stock.</p>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="adj-qty">{mode === 'set' ? 'Counted quantity' : 'Quantity'}</Label>
              <Input
                id="adj-qty"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                aria-invalid={!!preview && 'error' in preview}
                aria-describedby="adj-qty-hint"
              />
              <p id="adj-qty-hint" className={`text-xs ${preview && 'error' in preview ? 'text-destructive' : 'text-muted-foreground'}`}>
                {preview && 'error' in preview ? preview.error : 'Whole units only'}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="adj-reason">Reason</Label>
              <Select value={reason} onValueChange={(v) => setReason(v as StockReason)}>
                <SelectTrigger id="adj-reason"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {reasonsForMode(mode).map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="adj-notes">Note (optional)</Label>
            <Textarea id="adj-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Seal broken on 1 tub" />
          </div>

          <div className="space-y-2 rounded-xl border border-border p-4">
            <Label htmlFor="adj-min">Reorder level</Label>
            <Input id="adj-min" type="number" min={0} step={1} value={minQty} onChange={(e) => setMinQty(e.target.value)} aria-describedby="adj-min-hint" />
            <p id="adj-min-hint" className="text-xs text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3" aria-hidden /> Shown as Low stock at or below this number.
            </p>
          </div>
        </form>

        <div className="border-t border-border p-4 flex gap-3 bg-card">
          <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="adjust-stock-form" className="flex-1" disabled={!canSubmit || save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />}
            Save
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
