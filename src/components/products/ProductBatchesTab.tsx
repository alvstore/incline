import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Plus, FileText, MoreVertical, AlertTriangle, ShieldCheck, Loader2 } from 'lucide-react';
import { fetchBatches, signLabReport, setBatchStatus, type ProductBatch, type BatchStatus } from '@/services/batchService';
import { AddBatchDrawer } from './AddBatchDrawer';
import { toast } from 'sonner';
import { format, differenceInDays, parseISO } from 'date-fns';

interface Props {
  product: any;
}

const statusBadge = (s: BatchStatus) => {
  const map: Record<BatchStatus, string> = {
    active: 'bg-success/15 text-success',
    depleted: 'bg-muted text-muted-foreground',
    expired: 'bg-destructive/15 text-destructive',
    recalled: 'bg-destructive/15 text-destructive',
    quarantined: 'bg-warning/15 text-warning',
  };
  return <Badge className={`${map[s]} rounded-full font-medium`}>{s}</Badge>;
};

export function ProductBatchesTab({ product }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['product-batches', product.id],
    queryFn: () => fetchBatches(product.id),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: BatchStatus }) => setBatchStatus(id, status),
    onSuccess: () => {
      toast.success('Batch updated');
      qc.invalidateQueries({ queryKey: ['product-batches', product.id] });
    },
    onError: (e: any) => toast.error(e.message || 'Failed to update'),
  });

  const openLab = async (path: string) => {
    const url = await signLabReport(path);
    if (!url) {
      toast.error('Could not open lab report');
      return;
    }
    window.open(url, '_blank', 'noopener');
  };

  const expiryChip = (b: ProductBatch) => {
    if (!b.exp_date) return <span className="text-muted-foreground">—</span>;
    const days = differenceInDays(parseISO(b.exp_date), new Date());
    const date = format(parseISO(b.exp_date), 'dd MMM yyyy');
    if (days < 0) return <span className="text-destructive font-medium">{date} · expired</span>;
    if (days <= 30) return <span className="text-warning font-medium">{date} · {days}d left</span>;
    return <span className="text-foreground">{date}</span>;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">Batches</h3>
          <p className="text-xs text-muted-foreground">FEFO — earliest expiry sells first.</p>
        </div>
        <Button onClick={() => setOpen(true)} size="sm">
          <Plus className="h-4 w-4 mr-2" /> Add Batch
        </Button>
      </div>

      <Card className="rounded-2xl shadow-lg shadow/50 overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading batches…
          </div>
        ) : batches.length === 0 ? (
          <div className="p-10 text-center">
            <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No batches yet. Add the first batch to start tracking expiry & CoA.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Batch #</TableHead>
                <TableHead>MFG</TableHead>
                <TableHead>EXP</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>CoA</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((b) => (
                <TableRow key={b.id} className="hover:bg-muted">
                  <TableCell className="font-medium text-foreground">
                    {b.batch_number}
                    {b.supplier && <div className="text-xs text-muted-foreground">{b.supplier}</div>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {b.mfg_date ? format(parseISO(b.mfg_date), 'dd MMM yyyy') : '—'}
                  </TableCell>
                  <TableCell>{expiryChip(b)}</TableCell>
                  <TableCell className="text-right font-medium">
                    {b.quantity_remaining}
                    <span className="text-xs text-muted-foreground"> / {b.quantity_received}</span>
                  </TableCell>
                  <TableCell>{statusBadge(b.status)}</TableCell>
                  <TableCell>
                    {b.lab_report_url ? (
                      <button
                        onClick={() => openLab(b.lab_report_url!)}
                        className="inline-flex items-center gap-1 text-primary hover:underline text-sm"
                      >
                        <FileText className="h-4 w-4" />
                        {b.lab_verified ? <ShieldCheck className="h-4 w-4 text-success" /> : null}
                        View
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not uploaded</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm"><MoreVertical className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {b.status !== 'recalled' && (
                          <DropdownMenuItem onClick={() => statusMut.mutate({ id: b.id, status: 'recalled' })}>
                            Mark Recalled
                          </DropdownMenuItem>
                        )}
                        {b.status !== 'quarantined' && (
                          <DropdownMenuItem onClick={() => statusMut.mutate({ id: b.id, status: 'quarantined' })}>
                            Quarantine
                          </DropdownMenuItem>
                        )}
                        {b.status !== 'active' && (
                          <DropdownMenuItem onClick={() => statusMut.mutate({ id: b.id, status: 'active' })}>
                            Reactivate
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <AddBatchDrawer open={open} onOpenChange={setOpen} product={product} />
    </div>
  );
}
