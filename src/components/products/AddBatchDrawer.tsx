import { useEffect, useRef, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { FileUp, Loader2, FileText, X } from 'lucide-react';
import { createBatch, fetchBatches, suggestBatchNumber, uploadLabReport } from '@/services/batchService';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  product: { id: string; name: string; sku?: string | null; branch_id?: string | null; default_shelf_life_days?: number | null; requires_lab_report?: boolean };
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const addDaysISO = (base: string, days: number) => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

export function AddBatchDrawer({ open, onOpenChange, product }: Props) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data, error } = await supabase.from('branches').select('id, name').eq('is_active', true);
      if (error) throw error;
      return data;
    },
  });

  const { data: existingBatches = [] } = useQuery({
    queryKey: ['product-batches', product.id],
    queryFn: () => fetchBatches(product.id),
    enabled: open,
  });

  const [form, setForm] = useState({
    branch_id: product.branch_id || '',
    batch_number: '',
    mfg_date: todayISO(),
    exp_date: '',
    quantity_received: '',
    cost_price: '',
    supplier: '',
    invoice_ref: '',
    notes: '',
  });
  const [labFile, setLabFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      branch_id: product.branch_id || (branches[0] as any)?.id || '',
      batch_number: suggestBatchNumber(product.sku, existingBatches.length),
      mfg_date: todayISO(),
      exp_date: product.default_shelf_life_days ? addDaysISO(todayISO(), product.default_shelf_life_days) : '',
      quantity_received: '',
      cost_price: '',
      supplier: '',
      invoice_ref: '',
      notes: '',
    });
    setLabFile(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product.id, existingBatches.length]);

  // Auto-recalc EXP if MFG changes and shelf life set
  useEffect(() => {
    if (product.default_shelf_life_days && form.mfg_date) {
      setForm((f) => ({ ...f, exp_date: addDaysISO(f.mfg_date, product.default_shelf_life_days!) }));
    }
     
  }, [form.mfg_date, product.default_shelf_life_days]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.branch_id) throw new Error('Branch is required');
      if (!form.batch_number.trim()) throw new Error('Batch number is required');
      const qty = Number(form.quantity_received);
      if (!qty || qty <= 0) throw new Error('Quantity must be greater than 0');
      if (product.requires_lab_report && !labFile) {
        throw new Error('Lab report (CoA) is required for this product');
      }

      let labUrl: string | null = null;
      let labName: string | null = null;
      if (labFile) {
        setUploading(true);
        try {
          const r = await uploadLabReport(product.id, form.batch_number, labFile);
          labUrl = r.path;
          labName = r.filename;
        } finally {
          setUploading(false);
        }
      }

      return createBatch({
        product_id: product.id,
        branch_id: form.branch_id,
        batch_number: form.batch_number.trim(),
        mfg_date: form.mfg_date || null,
        exp_date: form.exp_date || null,
        quantity_received: qty,
        cost_price: form.cost_price ? Number(form.cost_price) : null,
        supplier: form.supplier.trim() || null,
        invoice_ref: form.invoice_ref.trim() || null,
        notes: form.notes.trim() || null,
        lab_report_url: labUrl,
        lab_report_filename: labName,
      });
    },
    onSuccess: () => {
      toast.success('Batch added');
      qc.invalidateQueries({ queryKey: ['product-batches', product.id] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message || 'Failed to add batch'),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add Batch · {product.name}</SheetTitle>
          <SheetDescription>Record a new stock batch with manufacturing, expiry and lab report.</SheetDescription>
        </SheetHeader>

        <form
          className="space-y-4 mt-6"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label>Branch *</Label>
              <Select value={form.branch_id} onValueChange={(v) => setForm({ ...form, branch_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                <SelectContent>
                  {branches.map((b: any) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Batch Number *</Label>
              <Input
                value={form.batch_number}
                onChange={(e) => setForm({ ...form, batch_number: e.target.value })}
                placeholder="WHEY-260512-01"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Manufacturing Date</Label>
              <Input type="date" value={form.mfg_date} onChange={(e) => setForm({ ...form, mfg_date: e.target.value })} />
            </div>

            <div className="space-y-2">
              <Label>Expiry Date</Label>
              <Input type="date" value={form.exp_date} onChange={(e) => setForm({ ...form, exp_date: e.target.value })} />
            </div>

            <div className="space-y-2">
              <Label>Quantity Received *</Label>
              <Input
                type="number"
                min="1"
                value={form.quantity_received}
                onChange={(e) => setForm({ ...form, quantity_received: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Cost / Unit (₹)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.cost_price}
                onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Supplier</Label>
              <Input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} placeholder="MuscleBlaze India" />
            </div>

            <div className="space-y-2">
              <Label>Supplier Invoice #</Label>
              <Input value={form.invoice_ref} onChange={(e) => setForm({ ...form, invoice_ref: e.target.value })} placeholder="INV-1234" />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>
                Lab Test Report (CoA) {product.requires_lab_report && <span className="text-red-600">*</span>}
              </Label>
              <div
                className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-primary transition-colors"
                onClick={() => fileRef.current?.click()}
              >
                {labFile ? (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm">
                      <FileText className="h-5 w-5 text-indigo-600" />
                      <span className="truncate">{labFile.name}</span>
                      <span className="text-xs text-muted-foreground">({(labFile.size / 1024).toFixed(0)} KB)</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); setLabFile(null); }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 py-3">
                    <FileUp className="h-7 w-7 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Click to upload Certificate of Analysis</p>
                    <p className="text-xs text-muted-foreground">PDF, JPG, PNG up to 10 MB</p>
                  </div>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => setLabFile(e.target.files?.[0] || null)}
              />
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={save.isPending || uploading}>
              {(save.isPending || uploading) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {uploading ? 'Uploading…' : save.isPending ? 'Saving…' : 'Add Batch'}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
