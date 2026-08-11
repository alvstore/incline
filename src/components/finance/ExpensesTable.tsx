import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Receipt, Pencil, FileText, ExternalLink } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { supabase } from '@/integrations/supabase/client';
import { useActorNames } from '@/hooks/useActorNames';
import { EXPENSE_TYPE_LABEL, type ExpenseRow } from '@/services/expenseService';

interface ExpensesTableProps {
  branchId?: string | null;
  search: string;
  dateRange?: { from: Date; to: Date };
  methodFilter: string;
  statusFilter: string;
  canEdit: boolean;
  onEdit: (expense: ExpenseRow) => void;
}

const STATUS_BADGE: Record<string, string> = {
  approved: 'bg-success/10 text-success',
  pending: 'bg-warning/10 text-warning',
  rejected: 'bg-destructive/10 text-destructive',
};

export function ExpensesTable({ branchId, search, dateRange, methodFilter, statusFilter, canEdit, onEdit }: ExpensesTableProps) {
  const { data: expenses = [], isLoading, isError } = useQuery({
    queryKey: ['expenses-console', branchId],
    queryFn: async () => {
      let query = supabase
        .from('expenses')
        .select('*, category:expense_categories(name)')
        .order('expense_date', { ascending: false })
        .limit(300);
      if (branchId) query = query.eq('branch_id', branchId);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as ExpenseRow[];
    },
  });

  const staffIds = useMemo(
    () => Array.from(new Set(expenses.flatMap((e) => [e.employee_user_id, e.submitted_by]).filter(Boolean) as string[])),
    [expenses],
  );
  const { nameOf } = useActorNames(staffIds);

  const rows = useMemo(() => {
    return expenses.filter((e) => {
      if (search) {
        const s = search.toLowerCase();
        const hay = [e.description, e.vendor, e.bill_number, e.category?.name, nameOf(e.employee_user_id)]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(s)) return false;
      }
      if (methodFilter !== 'all' && e.payment_method !== methodFilter) return false;
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (dateRange?.from && dateRange?.to) {
        const d = new Date(e.expense_date);
        if (d < dateRange.from || d > dateRange.to) return false;
      }
      return true;
    });
  }, [expenses, search, methodFilter, statusFilter, dateRange, nameOf]);

  const total = rows.reduce((sum, e) => sum + Number(e.amount || 0), 0);

  return (
    <Card className="rounded-2xl border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span>Expenses ({rows.length})</span>
          <span className="text-sm font-semibold text-destructive">₹{total.toLocaleString('en-IN')}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <TableSkeleton rows={8} columns={canEdit ? 8 : 7} />
        ) : isError ? (
          <p className="py-10 text-center text-sm text-destructive">Could not load expenses. Please retry.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Receipt</TableHead>
                {canEdit && <TableHead>Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id} className="hover:bg-muted/40 transition-colors">
                  <TableCell className="whitespace-nowrap">{format(new Date(e.expense_date), 'dd MMM yyyy')}</TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{e.description}</span>
                      <span className="text-xs text-muted-foreground">
                        {[
                          e.expense_type === 'salary_advance' ? nameOf(e.employee_user_id) || 'Staff' : e.vendor,
                          e.category?.name,
                          e.bill_number ? `Bill ${e.bill_number}` : null,
                        ].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="rounded-full text-xs">
                      {EXPENSE_TYPE_LABEL[e.expense_type] || 'General'}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-semibold text-destructive">₹{Number(e.amount).toLocaleString('en-IN')}</TableCell>
                  <TableCell className="text-xs capitalize">
                    {e.payment_method ? e.payment_method.replace('_', ' ') : '—'}
                    {e.payment_reference && <p className="text-muted-foreground">{e.payment_reference}</p>}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Badge className={STATUS_BADGE[e.status] || 'bg-muted text-muted-foreground'}>{e.status}</Badge>
                      {e.expense_type === 'vendor_bill' && !e.is_paid && (
                        <Badge className="bg-warning/10 text-warning text-[10px]">Unpaid</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {e.receipt_url ? (
                      <a href={e.receipt_url} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary text-xs hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                        <FileText className="h-3.5 w-3.5" /> View <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => onEdit(e)} aria-label={`Edit expense ${e.description}`}>
                        <Pencil className="h-4 w-4 mr-1" /> Edit
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canEdit ? 8 : 7} className="text-center py-16 text-muted-foreground">
                    <div className="flex flex-col items-center gap-3">
                      <div className="h-16 w-16 rounded-full bg-muted/80 flex items-center justify-center">
                        <Receipt className="h-8 w-8 opacity-40" />
                      </div>
                      <div>
                        <p className="font-medium text-foreground/70">No expenses found</p>
                        <p className="text-sm mt-1">Record money going out with the Add Expense action.</p>
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
