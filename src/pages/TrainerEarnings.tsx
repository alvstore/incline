import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useTrainerData } from '@/hooks/useMemberData';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { buildPayslipPdf, downloadBlob } from '@/utils/pdfBlob';
import { useBrandContext } from '@/lib/brand/useBrandContext';
import { slipStage, type OfficialSlip } from '@/lib/trainers/payslip';
import { track } from '@/lib/analytics';
import { installmentState, summarize, type EarningsInstallment, type InstallmentState } from '@/lib/trainers/earnings';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  Wallet, CheckCircle, Clock, AlertCircle, Download, Lock, CalendarClock, Dumbbell, Loader2, RefreshCw,
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';

const inr = (n: number) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const STATE_UI: Record<InstallmentState, { label: string; cls: string; icon: typeof CheckCircle }> = {
  paid: { label: 'Paid', cls: 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20', icon: CheckCircle },
  payable: { label: 'Payable', cls: 'bg-primary/10 text-primary border border-primary/20', icon: Wallet },
  on_hold: { label: 'On hold', cls: 'bg-amber-500/10 text-amber-500 border border-amber-500/20', icon: Lock },
  upcoming: { label: 'Upcoming', cls: 'bg-muted text-muted-foreground border border-border', icon: CalendarClock },
};

const STAGE_UI = {
  paid: { label: 'Paid', hint: 'Paid by management', cls: 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20' },
  approved: { label: 'Approved', hint: 'Approved, payment pending', cls: 'bg-primary/10 text-primary border border-primary/20' },
  draft: { label: 'Draft', hint: 'Being prepared by management — may still change', cls: 'bg-muted text-muted-foreground border border-border' },
  none: { label: '', hint: 'From the payroll prepared by management', cls: '' },
} as const;

interface Summary { installments: EarningsInstallment[]; trend: { month: string; paid: number; pending: number }[] }

export default function TrainerEarnings() {
  const { profile, user } = useAuth();
  const { trainer, isLoading: trainerLoading } = useTrainerData();
  const [selectedMonth, setSelectedMonth] = useState(0);

  const monthDate = subMonths(new Date(), selectedMonth);
  const monthStart = startOfMonth(monthDate).toISOString();
  const monthEnd = endOfMonth(monthDate).toISOString();
  const monthStartDate = format(startOfMonth(monthDate), 'yyyy-MM-dd');
  const monthKey = format(monthDate, 'yyyy-MM');

  // Single source of truth: the slip management prepared/paid. No client-side salary maths.
  const slipQuery = useQuery({
    queryKey: ['my-payslip', user?.id, monthKey],
    enabled: !!user?.id,
    queryFn: async (): Promise<OfficialSlip | null> => {
      const { data, error } = await supabase.rpc('my_payslip_for_month', { p_month: monthStartDate });
      if (error) throw error;
      const slip = (data as unknown as OfficialSlip) ?? null;
      track('trainer_payslip_viewed', { month: monthKey, stage: slipStage(slip) });
      return slip;
    },
  });
  const officialPayroll = slipQuery.data ?? null;
  const stage = slipStage(officialPayroll);

  const summary = useQuery({
    queryKey: ['trainer-earnings-summary', trainer?.id, monthStartDate],
    enabled: !!trainer,
    queryFn: async (): Promise<Summary> => {
      const { data, error } = await supabase.rpc('trainer_earnings_summary', { p_trainer_id: trainer!.id, p_month: monthStartDate });
      if (error) throw error;
      return data as unknown as Summary;
    },
  });

  const sessions = useQuery({
    queryKey: ['trainer-completed-sessions', trainer?.id, selectedMonth],
    enabled: !!trainer,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pt_sessions')
        .select('id, scheduled_at, duration_minutes, member_pt_package:member_pt_packages(member:members(member_code, user_id), package:pt_packages(name))')
        .eq('trainer_id', trainer!.id)
        .eq('status', 'completed')
        .gte('scheduled_at', monthStart)
        .lte('scheduled_at', monthEnd)
        .order('scheduled_at', { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as Array<{ id: string; scheduled_at: string; duration_minutes: number | null; member_pt_package: { member: { member_code: string | null; user_id: string | null } | null; package: { name: string } | null } | null }>;
      const ids = [...new Set(rows.map(r => r.member_pt_package?.member?.user_id).filter(Boolean) as string[])];
      const names: Record<string, string> = {};
      if (ids.length) {
        const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', ids);
        (profs ?? []).forEach(p => { names[p.id] = p.full_name ?? ''; });
      }
      return rows.map(r => ({
        id: r.id, at: r.scheduled_at, minutes: r.duration_minutes,
        name: (r.member_pt_package?.member?.user_id && names[r.member_pt_package.member.user_id]) || r.member_pt_package?.member?.member_code || 'Member',
        pkg: r.member_pt_package?.package?.name ?? 'PT',
      }));
    },
  });

  const { data: brand } = useBrandContext(trainer?.branch_id || null);

  const rows = summary.data?.installments ?? [];
  const totals = summarize(rows, monthStartDate);
  const monthRows = rows.filter(r => installmentState(r, monthStartDate) !== 'upcoming');
  const upcomingRows = rows.filter(r => installmentState(r, monthStartDate) === 'upcoming');

  const totalDaysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const att = (officialPayroll?.calc_attendance ?? {}) as Record<string, number>;
  const daysPresent = Number(att.payable_days ?? att.present ?? 0);
  const isOfficial = stage === 'paid';

  const handleDownloadOfficialPayslip = () => {
    if (!officialPayroll || !brand || !trainer) return;
    track('trainer_payslip_downloaded', { month: monthKey, stage });
    const blob = buildPayslipPdf({
      employee_name: profile?.full_name || 'Trainer',
      employee_code: trainer.trainer_code || trainer.id.slice(0, 8),
      designation: 'Personal Trainer',
      period_label: format(monthDate, 'MMMM yyyy'),
      period_start: monthStart.split('T')[0],
      period_end: monthEnd.split('T')[0],
      attendance: { present: Number(att.present || daysPresent), payable_days: Number(att.payable_days || daysPresent), total_days: totalDaysInMonth, monthly_salary: Number(officialPayroll.calc_base || 0) },
      earnings: { base: Number(officialPayroll.final_base || 0), pt_commission: Number(officialPayroll.final_pt_commission || 0) + Number(officialPayroll.final_bonus || 0), ot: Number(officialPayroll.final_ot || 0), bonus: 0 },
      deductions: { deductions: Number(officialPayroll.final_deductions || 0), advance: Number(officialPayroll.final_advance || 0), penalty: Number(officialPayroll.final_penalty || 0) },
      gross: Number(officialPayroll.final_gross || 0),
      net: Number(officialPayroll.final_net || 0),
    }, brand);
    downloadBlob(blob, `Official_Payslip_${monthKey}.pdf`);
  };

  if (trainerLoading) {
    return <AppLayout><div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></AppLayout>;
  }
  if (!trainer) {
    return (
      <AppLayout>
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
          <AlertCircle className="h-10 w-10 text-muted-foreground" />
          <h2 className="text-xl font-semibold">No trainer profile found</h2>
          <p className="text-muted-foreground">Your account is not linked to a trainer profile.</p>
        </div>
      </AppLayout>
    );
  }

  const trendData = (summary.data?.trend ?? []).map(t => ({ ...t, label: format(new Date(t.month), 'MMM') }));
  const sessionCount = sessions.data?.length ?? 0;

  return (
    <AppLayout>
      <div className="min-w-0 space-y-5">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">My earnings</h1>
            <p className="text-sm text-muted-foreground">Salary and PT commission for {format(monthDate, 'MMMM yyyy')}</p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:flex" role="group" aria-label="Choose month">
            {[0, 1, 2].map(o => (
              <Button key={o} size="sm" className="min-h-11 px-2 sm:px-3" variant={selectedMonth === o ? 'default' : 'outline'} aria-pressed={selectedMonth === o} onClick={() => setSelectedMonth(o)}>
                {format(subMonths(new Date(), o), 'MMM yyyy')}
              </Button>
            ))}
          </div>
        </header>

        {/* KPI row */}
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:gap-4 lg:grid-cols-12">
          <Kpi className="lg:col-span-3" label="Payable this month" value={inr(totals.payable + totals.paid)} hint={totals.paid > 0 ? `${inr(totals.paid)} already paid` : 'PT commission'} icon={Wallet} loading={summary.isLoading} />
          <Kpi className="lg:col-span-3" label="On hold" value={inr(totals.onHold)} hint="Released once the member clears dues" icon={Lock} loading={summary.isLoading} />
          <Kpi className="lg:col-span-3" label="Upcoming instalments" value={inr(totals.upcoming)} hint="Future months" icon={CalendarClock} loading={summary.isLoading} />
          <Kpi className="lg:col-span-3" label="Sessions delivered" value={String(sessionCount)} hint="Not paid per session" icon={Dumbbell} loading={sessions.isLoading} />
        </div>

        <div className="grid gap-4 lg:grid-cols-12">
          {/* Commission table */}
          <Card className="rounded-xl border border-border lg:col-span-8">
            <CardHeader>
              <CardTitle className="text-base">Commission by client</CardTitle>
              <CardDescription>Your share is calculated on the package price before GST, then split into monthly instalments.</CardDescription>
            </CardHeader>
            <CardContent>
              {summary.isLoading ? (
                <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
              ) : summary.isError ? (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <p className="text-sm text-destructive">Could not load your commission.</p>
                  <Button variant="outline" className="min-h-11" onClick={() => summary.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Try again</Button>
                </div>
              ) : monthRows.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                  <Wallet className="h-8 w-8 text-muted-foreground" aria-hidden />
                  <p className="text-sm text-muted-foreground">No PT commission for this month yet.</p>
                </div>
              ) : (
                <>
                <ul className="divide-y divide-border sm:hidden" aria-label={`PT commission instalments for ${format(monthDate, 'MMMM yyyy')}`}>
                  {monthRows.map(r => {
                    const st = installmentState(r, monthStartDate);
                    const s = STATE_UI[st];
                    const Icon = s.icon;
                    return (
                      <li key={r.installment_id} className="space-y-1 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">{r.member_name}</p>
                            <p className="truncate text-xs text-muted-foreground">{r.package_name ?? 'PT package'} · {r.installment_index} of {r.installment_count}</p>
                          </div>
                          <p className="shrink-0 font-semibold tabular-nums text-foreground">{inr(r.amount)}</p>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span>{r.sale_amount != null ? `Sale ${inr(r.sale_amount)}` : ''}{r.share_pct != null ? ` · ${r.share_pct}%` : ''}</span>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${s.cls}`}><Icon className="h-3 w-3" aria-hidden />{s.label}</span>
                        </div>
                        {st === 'on_hold' && <p className="text-xs text-muted-foreground">{(r.invoice_balance ?? 0) > 0 ? `Member owes ${inr(r.invoice_balance!)}` : r.blocked_reason ?? 'Awaiting payment'}</p>}
                      </li>
                    );
                  })}
                </ul>
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full text-sm">
                    <caption className="sr-only">PT commission instalments for {format(monthDate, 'MMMM yyyy')}</caption>
                    <thead className="sticky top-0 z-10 bg-card">
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th scope="col" className="py-2 pr-3 font-semibold">Client</th>
                        <th scope="col" className="py-2 pr-3 text-right font-semibold">Sale</th>
                        <th scope="col" className="py-2 pr-3 text-right font-semibold">Share</th>
                        <th scope="col" className="py-2 pr-3 text-right font-semibold">Instalment</th>
                        <th scope="col" className="py-2 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthRows.map(r => {
                        const s = STATE_UI[installmentState(r, monthStartDate)];
                        const Icon = s.icon;
                        const held = installmentState(r, monthStartDate) === 'on_hold';
                        return (
                          <tr key={r.installment_id} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                            <td className="py-3 pr-3">
                              <p className="font-medium text-foreground">{r.member_name}</p>
                              <p className="text-xs text-muted-foreground">{r.package_name ?? 'PT package'}</p>
                            </td>
                            <td className="py-3 pr-3 text-right tabular-nums">{r.sale_amount != null ? inr(r.sale_amount) : '—'}</td>
                            <td className="py-3 pr-3 text-right tabular-nums">
                              <p>{r.share_pct != null ? `${r.share_pct}%` : '—'}</p>
                              {(r.gst_deduction ?? 0) > 0 && <p className="text-xs text-muted-foreground">GST −{inr(r.gst_deduction!)}</p>}
                            </td>
                            <td className="py-3 pr-3 text-right tabular-nums">
                              <p className="font-semibold text-foreground">{inr(r.amount)}</p>
                              <p className="text-xs text-muted-foreground">{r.installment_index} of {r.installment_count}</p>
                            </td>
                            <td className="py-3">
                              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
                                <Icon className="h-3 w-3" aria-hidden />{s.label}
                              </span>
                              {held && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {(r.invoice_balance ?? 0) > 0 ? `Member owes ${inr(r.invoice_balance!)}` : r.blocked_reason ?? 'Awaiting payment'}
                                </p>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                </>
              )}
              {upcomingRows.length > 0 && (
                <p className="mt-4 text-xs text-muted-foreground">
                  {upcomingRows.length} future instalment{upcomingRows.length > 1 ? 's' : ''} worth {inr(totals.upcoming)} will appear in their payout month.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Salary card */}
          <Card className="order-first rounded-xl border border-border lg:order-none lg:col-span-4">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">Salary slip</CardTitle>
                {stage !== 'none' && (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_UI[stage].cls}`}>
                    {stage === 'paid' ? <CheckCircle className="h-3 w-3" aria-hidden /> : <Clock className="h-3 w-3" aria-hidden />}{STAGE_UI[stage].label}
                  </span>
                )}
              </div>
              <CardDescription>{STAGE_UI[stage].hint}{stage === 'paid' && officialPayroll?.payment_date ? ` on ${format(new Date(officialPayroll.payment_date), 'dd MMM yyyy')}` : ''}{stage === 'paid' && officialPayroll?.payment_method ? ` · ${officialPayroll.payment_method.replace('_', ' ')}` : ''}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {slipQuery.isLoading ? <Skeleton className="h-24 w-full" /> : slipQuery.isError ? (
                <div className="space-y-2"><p className="text-sm text-destructive">Could not load your salary slip.</p><Button variant="outline" className="min-h-11" onClick={() => slipQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Try again</Button></div>
              ) : !officialPayroll ? (
                <p className="flex items-center gap-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground"><Clock className="h-4 w-4 shrink-0" aria-hidden />Payroll for {format(monthDate, 'MMMM')} has not been prepared yet.</p>
              ) : (
                <>
                  <p className="text-3xl font-bold tabular-nums text-foreground">{inr(Number(officialPayroll.final_net))}</p>
                  <dl className="space-y-2 text-sm">
                    <Row k={daysPresent ? `Base (${daysPresent}/${totalDaysInMonth} days)` : 'Base salary'} v={inr(Number(officialPayroll.final_base))} />
                    <Row k="PT commission" v={inr(Number(officialPayroll.final_pt_commission) + Number(officialPayroll.final_bonus || 0))} />
                    {Number(officialPayroll.final_ot) > 0 && <Row k="Overtime" v={inr(Number(officialPayroll.final_ot))} />}
                    {Number(officialPayroll.final_deductions) + Number(officialPayroll.final_advance) + Number(officialPayroll.final_penalty) > 0 && (
                      <Row k="Deductions" v={`−${inr(Number(officialPayroll.final_deductions) + Number(officialPayroll.final_advance) + Number(officialPayroll.final_penalty))}`} />
                    )}
                  </dl>
                  <Button className="min-h-11 w-full" variant={isOfficial ? 'default' : 'outline'} onClick={handleDownloadOfficialPayslip}>
                    <Download className="mr-2 h-4 w-4" />{isOfficial ? 'Download payslip' : 'Download draft slip'}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          {/* Trend */}
          <Card className="rounded-xl border border-border lg:col-span-7">
            <CardHeader>
              <CardTitle className="text-base">Commission trend</CardTitle>
              <CardDescription>Paid and still-to-pay PT commission, last 6 months</CardDescription>
            </CardHeader>
            <CardContent className="h-48 sm:h-64">
              {summary.isLoading ? <Skeleton className="h-full w-full" /> : trendData.every(t => !t.paid && !t.pending) ? (
                <p className="py-16 text-center text-sm text-muted-foreground">No commission history yet.</p>
              ) : (
                <>
                  <span className="sr-only">{trendData.map(t => `${t.label}: paid ${inr(t.paid)}, pending ${inr(t.pending)}`).join('; ')}</span>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                      <YAxis tickLine={false} axisLine={false} fontSize={12} width={60} tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: number) => inr(v)} contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 12 }} />
                      <Bar dataKey="paid" name="Paid" stackId="a" fill="hsl(var(--primary))" />
                      <Bar dataKey="pending" name="To be paid" stackId="a" fill="hsl(var(--accent))" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </>
              )}
            </CardContent>
          </Card>

          {/* Sessions */}
          <Card className="rounded-xl border border-border lg:col-span-5">
            <CardHeader>
              <CardTitle className="text-base">Sessions delivered</CardTitle>
              <CardDescription>Your work log. Pay comes from package commission, not per session.</CardDescription>
            </CardHeader>
            <CardContent>
              {sessions.isLoading ? (
                <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : sessions.isError ? (
                <p className="text-sm text-destructive">Could not load sessions.</p>
              ) : sessionCount === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No completed sessions this month.</p>
              ) : (
                <ul className="max-h-64 divide-y divide-border overflow-y-auto">
                  {sessions.data!.map(s => (
                    <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{s.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{s.pkg}</p>
                      </div>
                      <p className="shrink-0 text-xs tabular-nums text-muted-foreground">{format(new Date(s.at), 'dd MMM · HH:mm')}{s.minutes ? ` · ${s.minutes} min` : ''}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}

function Kpi({ label, value, hint, icon: Icon, loading, className }: { label: string; value: string; hint: string; icon: typeof Wallet; loading?: boolean; className?: string }) {
  return (
    <Card className={`rounded-xl border border-border ${className ?? ''}`}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
          <Icon className="h-4 w-4 text-primary" aria-hidden />
        </div>
        {loading ? <Skeleton className="mt-2 h-8 w-24" /> : <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">{value}</p>}
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-2"><dt className="text-muted-foreground">{k}</dt><dd className="tabular-nums font-medium text-foreground">{v}</dd></div>;
}
