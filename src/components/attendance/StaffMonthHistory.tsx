/**
 * StaffMonthHistory — block-accurate monthly attendance summary per staff member.
 * Uses staff_month_summary so half days (1 of 2 rostered blocks) and payable
 * hours reflect the roster instead of raw punch spans.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { AlertTriangle, History, Layers, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Database } from '@/integrations/supabase/types';

type MonthRow = Database['public']['Functions']['staff_month_summary']['Returns'][number];
type PayrollRow = Database['public']['Functions']['compute_payroll']['Returns'][number];

function initials(name?: string | null) {
  return (name || '?').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

const STATUS_BADGE: Record<string, string> = {
  present: 'bg-emerald-100 text-emerald-700',
  half_day: 'bg-amber-100 text-amber-700',
  absent: 'bg-red-100 text-red-700',
  leave: 'bg-blue-100 text-blue-700',
  weekly_off: 'bg-slate-100 text-slate-600',
  holiday: 'bg-violet-100 text-violet-700',
  scheduled: 'bg-slate-100 text-slate-600',
};

export function StaffMonthHistory({ branchId }: { branchId: string | undefined }) {
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [detail, setDetail] = useState<MonthRow | null>(null);

  const { data: rows = [], isLoading, isError } = useQuery({
    queryKey: ['staff-month-summary', branchId, month],
    enabled: !!branchId,
    queryFn: async (): Promise<MonthRow[]> => {
      const { data, error } = await supabase.rpc('staff_month_summary', {
        p_branch_id: branchId!,
        p_month: `${month}-01`,
      });
      if (error) throw error;
      return (data || []) as MonthRow[];
    },
  });

  const { data: days = [], isLoading: daysLoading } = useQuery({
    queryKey: ['staff-month-days', detail?.user_id, month],
    enabled: !!detail?.user_id,
    queryFn: async (): Promise<PayrollRow[]> => {
      const [y, m] = month.split('-').map(Number);
      const end = format(new Date(y, m, 0), 'yyyy-MM-dd');
      const { data, error } = await supabase.rpc('compute_payroll', {
        p_user_id: detail!.user_id!,
        p_period_start: `${month}-01`,
        p_period_end: end,
      });
      if (error) throw error;
      return (data || []) as PayrollRow[];
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="staff-history-month" className="text-xs text-muted-foreground">Month</Label>
          <Input
            id="staff-history-month" type="month" value={month}
            onChange={(e) => setMonth(e.target.value)} className="h-9 w-[170px]"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}
        </div>
      ) : isError ? (
        <div className="py-12 text-center text-muted-foreground">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 opacity-50" />
          Could not load the monthly attendance summary.
        </div>
      ) : rows.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <History className="mx-auto mb-3 h-8 w-8 opacity-50" />
          No staff attendance for this month.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {rows.map((s) => (
            <Card key={s.user_id} className="rounded-2xl border-0 shadow-lg shadow-muted/40 transition-all duration-200 hover:shadow-xl">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={s.avatar_url || undefined} />
                    <AvatarFallback className="bg-accent/10 text-sm font-semibold text-accent">{initials(s.full_name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">{s.full_name || 'Unknown'}</p>
                    <p className="truncate text-xs text-muted-foreground">{s.staff_code} · <span className="capitalize">{s.staff_kind}</span></p>
                  </div>
                  <Badge className="rounded-full border-0 bg-primary/10 text-primary">
                    {Number(s.payable_days ?? 0).toFixed(1)} paid days
                  </Badge>
                </div>

                <div className="mt-3 grid grid-cols-4 gap-2">
                  <div className="rounded-lg bg-success/10 p-2 text-center">
                    <p className="text-lg font-bold text-success">{s.present_days}</p>
                    <p className="text-xs text-muted-foreground">Full</p>
                  </div>
                  <div className="rounded-lg bg-warning/10 p-2 text-center">
                    <p className="text-lg font-bold text-warning">{s.half_days}</p>
                    <p className="text-xs text-muted-foreground">Half</p>
                  </div>
                  <div className="rounded-lg bg-destructive/10 p-2 text-center">
                    <p className="text-lg font-bold text-destructive">{s.absent_days}</p>
                    <p className="text-xs text-muted-foreground">Absent</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-2 text-center">
                    <p className="text-lg font-bold text-foreground">{Math.round(Number(s.hours ?? 0) * 10) / 10}h</p>
                    <p className="text-xs text-muted-foreground">Hours</p>
                  </div>
                </div>

                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Layers className="h-3.5 w-3.5" />
                  {s.blocks_attended}/{s.blocks_rostered} shift blocks attended
                  {Number(s.late_count ?? 0) > 0 && <span className="text-warning">· {s.late_count} late</span>}
                </p>

                <Button
                  variant="outline" size="sm"
                  className="mt-3 w-full cursor-pointer gap-1.5"
                  onClick={() => setDetail(s)}
                >
                  Day-by-day <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{detail?.full_name} — {format(new Date(`${month}-01`), 'MMMM yyyy')}</SheetTitle>
            <SheetDescription>
              Day-by-day attendance with the shift blocks rostered and attended, and the payable fraction used by payroll.
            </SheetDescription>
          </SheetHeader>
          <div className="py-4">
            {daysLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Blocks</TableHead>
                    <TableHead>Hours</TableHead>
                    <TableHead>Pay</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {days.map((d) => (
                    <TableRow key={String(d.work_date)}>
                      <TableCell className="text-sm">{format(new Date(String(d.work_date)), 'd MMM (EEE)')}</TableCell>
                      <TableCell>
                        <Badge className={`rounded-full border-0 text-[11px] capitalize ${STATUS_BADGE[String(d.status)] || 'bg-slate-100 text-slate-600'}`}>
                          {String(d.status).replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{d.blocks_attended}/{d.blocks_rostered}</TableCell>
                      <TableCell className="text-sm">
                        {Number(d.hours_worked ?? 0).toFixed(1)}h
                        {d.hours_source === 'rostered' && <span className="ml-1 text-[10px] text-muted-foreground">(roster)</span>}
                      </TableCell>
                      <TableCell className="text-sm">{Number(d.payable_fraction ?? 0).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                  {days.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No days to show</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
