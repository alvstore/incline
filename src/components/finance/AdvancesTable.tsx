import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { HandCoins } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { supabase } from '@/integrations/supabase/client';
import { useActorNames } from '@/hooks/useActorNames';
import type { SalaryAdvanceRow } from '@/services/expenseService';

interface AdvancesTableProps {
  branchId?: string | null;
  search: string;
}

export function AdvancesTable({ branchId, search }: AdvancesTableProps) {
  const { data: advances = [], isLoading, isError } = useQuery({
    queryKey: ['salary-advances', branchId],
    queryFn: async () => {
      let query = supabase
        .from('salary_advances' as never)
        .select('*')
        .order('paid_on', { ascending: false })
        .limit(200);
      if (branchId) query = (query as any).eq('branch_id', branchId);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as SalaryAdvanceRow[];
    },
  });

  const { nameOf } = useActorNames(advances.map((a) => a.user_id));

  const rows = useMemo(() => {
    if (!search) return advances;
    const s = search.toLowerCase();
    return advances.filter((a) =>
      [nameOf(a.user_id), a.reason, a.payment_reference].filter(Boolean).join(' ').toLowerCase().includes(s),
    );
  }, [advances, search, nameOf]);

  const outstanding = rows.reduce((sum, a) => sum + Number(a.outstanding || 0), 0);

  return (
    <Card className="rounded-2xl border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span>Salary Advances ({rows.length})</span>
          <span className="text-sm font-semibold text-warning">₹{outstanding.toLocaleString('en-IN')} outstanding</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <TableSkeleton rows={6} columns={6} />
        ) : isError ? (
          <p className="py-10 text-center text-sm text-destructive">Could not load advances. Please retry.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Staff</TableHead>
                <TableHead>Paid on</TableHead>
                <TableHead>Advance</TableHead>
                <TableHead>Recovered</TableHead>
                <TableHead>Outstanding</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => {
                const recovered = Number(a.amount) - Number(a.outstanding);
                const pct = Number(a.amount) > 0 ? Math.round((recovered / Number(a.amount)) * 100) : 0;
                return (
                  <TableRow key={a.id} className="hover:bg-muted/40 transition-colors">
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{nameOf(a.user_id) || 'Staff member'}</span>
                        <span className="text-xs text-muted-foreground">{a.reason || '—'}</span>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{format(new Date(a.paid_on), 'dd MMM yyyy')}</TableCell>
                    <TableCell className="font-semibold">₹{Number(a.amount).toLocaleString('en-IN')}</TableCell>
                    <TableCell className="min-w-[140px]">
                      <Progress value={pct} className="h-1.5" />
                      <span className="text-xs text-muted-foreground">₹{recovered.toLocaleString('en-IN')} ({pct}%)</span>
                    </TableCell>
                    <TableCell className="font-semibold text-warning">₹{Number(a.outstanding).toLocaleString('en-IN')}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 items-start">
                        <Badge className={a.status === 'recovered' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}>
                          {a.status}
                        </Badge>
                        {a.auto_recover && a.status !== 'recovered' && (
                          <span className="text-[10px] text-muted-foreground">auto-deducts next payroll</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-16 text-muted-foreground">
                    <div className="flex flex-col items-center gap-3">
                      <div className="h-16 w-16 rounded-full bg-muted/80 flex items-center justify-center">
                        <HandCoins className="h-8 w-8 opacity-40" />
                      </div>
                      <div>
                        <p className="font-medium text-foreground/70">No salary advances</p>
                        <p className="text-sm mt-1">Use Pay Advance to record one — it deducts from the next payroll run.</p>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
