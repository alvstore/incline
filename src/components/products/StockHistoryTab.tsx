import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { ArrowDownRight, ArrowUpRight, History, RefreshCw } from 'lucide-react';
import { fetchStockMovements } from '@/services/inventoryService';
import { MOVEMENT_LABELS, movementSign } from '@/lib/products/productRules';
import { useActorNames } from '@/hooks/useActorNames';

const fmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

export function StockHistoryTab({ branchId }: { branchId: string | undefined }) {
  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['stock-movements', branchId],
    queryFn: () => fetchStockMovements(branchId, undefined, 150),
  });
  const actorIds = Array.from(new Set(data.map((m) => m.created_by).filter((x): x is string => !!x)));
  const names = useActorNames(actorIds);

  return (
    <Card className="rounded-xl border border-border">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-lg flex items-center gap-2">
          <History className="h-5 w-5 text-muted-foreground" aria-hidden />
          Stock history
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={() => refetch()} aria-label="Refresh stock history">
          <RefreshCw className="h-4 w-4" aria-hidden />
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : isError ? (
          <div className="text-center py-10 space-y-3">
            <p className="text-sm text-muted-foreground">Could not load stock history.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Try again</Button>
          </div>
        ) : data.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <History className="h-10 w-10 mx-auto mb-3 opacity-40" aria-hidden />
            <p className="font-medium text-foreground">No stock movements yet</p>
            <p className="text-sm">Sales, received batches and adjustments will be listed here.</p>
          </div>
        ) : (
          <div className="rounded-md border border-border max-h-[640px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead scope="col">When</TableHead>
                  <TableHead scope="col">Product</TableHead>
                  <TableHead scope="col">Movement</TableHead>
                  <TableHead scope="col" className="text-right">Units</TableHead>
                  <TableHead scope="col">Details</TableHead>
                  <TableHead scope="col">By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((m) => {
                  const sign = movementSign(m.movement_type);
                  return (
                    <TableRow key={m.id} className="hover:bg-muted/50 transition-colors duration-150">
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {m.created_at ? fmt.format(new Date(m.created_at)) : '—'}
                      </TableCell>
                      <TableCell className="font-medium">{m.products?.name ?? 'Product'}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1 text-sm">
                          {sign > 0 ? (
                            <ArrowUpRight className="h-4 w-4 text-emerald-500" aria-hidden />
                          ) : (
                            <ArrowDownRight className="h-4 w-4 text-destructive" aria-hidden />
                          )}
                          {MOVEMENT_LABELS[m.movement_type] ?? m.movement_type}
                        </span>
                      </TableCell>
                      <TableCell className={`text-right font-semibold tabular-nums ${sign > 0 ? 'text-emerald-500' : 'text-destructive'}`}>
                        {sign > 0 ? '+' : '−'}{m.quantity}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[280px] truncate" title={m.notes ?? ''}>
                        {m.notes || '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {m.created_by ? names.nameOf(m.created_by) ?? 'Staff' : 'System'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
