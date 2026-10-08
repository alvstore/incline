import { useMemo, useState, type KeyboardEvent } from 'react';
import { format, differenceInDays } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Search, Users, MoreHorizontal, CalendarPlus, RefreshCw, XCircle, ArrowUpDown, IndianRupee,
  ArrowRightLeft, UserRound, AlertTriangle, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { avatarColor, initialsOf, type PTMemberPackageRow } from './ptTypes';

type SortKey = 'member' | 'progress' | 'expiry';
export type ClientFilter = 'all' | 'needs_trainer' | 'payment_due' | 'expiring' | 'low_sessions' | 'expired';

interface Props {
  rows: PTMemberPackageRow[];
  loading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  renewingId: string | null;
  renewPending: boolean;
  canCancelInvoice: boolean;
  canManage: boolean;
  onSchedule: (pkg?: PTMemberPackageRow) => void;
  onRenew: (pkg: PTMemberPackageRow) => void;
  onCancelInvoice: (pkg: PTMemberPackageRow) => void;
  onCollect: (pkg: PTMemberPackageRow) => void;
  onTransfer: (pkgs: PTMemberPackageRow[]) => void;
  onView: (pkg: PTMemberPackageRow) => void;
}

const PAGE_SIZE = 10;
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

function progressOf(pkg: PTMemberPackageRow) {
  const total = Number(pkg.sessions_total || 0);
  if (total > 0) {
    const used = total - Number(pkg.sessions_remaining || 0);
    return { pct: Math.min(100, Math.round((used / total) * 100)), label: `${used}/${total} sessions` };
  }
  const start = new Date(pkg.start_date || pkg.created_at || pkg.expiry_date);
  const end = new Date(pkg.expiry_date);
  const totalDays = Math.max(1, differenceInDays(end, start));
  const elapsed = Math.max(0, differenceInDays(new Date(), start));
  const daysLeft = Math.max(0, differenceInDays(end, new Date()));
  return { pct: Math.min(100, Math.round((elapsed / totalDays) * 100)), label: `${elapsed}d / ${totalDays}d · ${daysLeft}d left` };
}

const isExpired = (p: PTMemberPackageRow) => p.status === 'expired';
const daysLeftOf = (p: PTMemberPackageRow) => differenceInDays(new Date(p.expiry_date), new Date());
const matchers: Record<ClientFilter, (p: PTMemberPackageRow) => boolean> = {
  all: (p) => !isExpired(p),
  needs_trainer: (p) => !isExpired(p) && p.trainer_active === false,
  payment_due: (p) => !isExpired(p) && (p.due ?? 0) > 0,
  expiring: (p) => !isExpired(p) && daysLeftOf(p) <= 7,
  low_sessions: (p) => !isExpired(p) && Number(p.sessions_total || 0) > 0 && Number(p.sessions_remaining || 0) <= 2,
  expired: isExpired,
};
const FILTERS: { key: ClientFilter; label: string; warn?: boolean }[] = [
  { key: 'all', label: 'All active' },
  { key: 'needs_trainer', label: 'Needs trainer', warn: true },
  { key: 'payment_due', label: 'Payment due', warn: true },
  { key: 'expiring', label: 'Expiring ≤7d' },
  { key: 'low_sessions', label: 'Low sessions' },
  { key: 'expired', label: 'Expired (30d)' },
];

type Primary = { label: string; icon: typeof CalendarPlus; run: () => void; tone?: 'warn' };

function ProgressRing({ pct }: { pct: number }) {
  const tone = pct >= 90 ? 'text-destructive' : pct >= 75 ? 'text-warning' : 'text-success';
  const r = 14;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 36 36" className="h-9 w-9 shrink-0 -rotate-90" role="img" aria-label={`${pct}% used`}>
      <circle cx="18" cy="18" r={r} className="stroke-muted" strokeWidth="4" fill="none" />
      <circle cx="18" cy="18" r={r} className={cn('stroke-current transition-all duration-300', tone)} strokeWidth="4"
        strokeLinecap="round" fill="none" strokeDasharray={c} strokeDashoffset={c - (c * pct) / 100} />
    </svg>
  );
}

function PaymentBadge({ pkg }: { pkg: PTMemberPackageRow }) {
  const due = pkg.due ?? 0;
  if (!pkg.invoice_id) return <Badge variant="outline" className="border-border bg-muted text-muted-foreground">No bill</Badge>;
  if (due <= 0) return <Badge variant="outline" className="border-emerald-500/20 bg-emerald-500/10 text-emerald-600">Paid</Badge>;
  const partial = (pkg.invoice_paid ?? 0) > 0;
  return (
    <Badge variant="outline" className={partial ? 'border-amber-500/20 bg-amber-500/10 text-amber-600' : 'border-destructive/20 bg-destructive/10 text-destructive'}>
      {partial ? 'Part-paid' : 'Unpaid'} · {inr(due)} due
    </Badge>
  );
}

export function ClientsTable(props: Props) {
  const { rows, loading, isError, onRetry, renewingId, renewPending, canCancelInvoice, canManage,
    onSchedule, onRenew, onCancelInvoice, onCollect, onTransfer, onView } = props;
  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState<ClientFilter>('all');
  const [sort, setSort] = useState<SortKey>('expiry');
  const [asc, setAsc] = useState(true);
  const [page, setPage] = useState(0);

  const counts = useMemo(() => {
    const c = {} as Record<ClientFilter, number>;
    FILTERS.forEach((f) => { c[f.key] = rows.filter(matchers[f.key]).length; });
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    const base = rows.filter(matchers[filter]).filter((r) => !q || [r.member_name, r.member_code, r.trainer_name, r.package_name]
      .filter(Boolean).join(' ').toLowerCase().includes(q));
    const dir = asc ? 1 : -1;
    return base.sort((a, b) => {
      if (sort === 'member') return dir * (a.member_name || '').localeCompare(b.member_name || '');
      if (sort === 'progress') return dir * (progressOf(a).pct - progressOf(b).pct);
      return dir * (new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime());
    });
  }, [rows, filter, term, sort, asc]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  function toggleSort(key: SortKey) {
    if (sort === key) setAsc((v) => !v);
    else { setSort(key); setAsc(true); }
    setPage(0);
  }

  function primaryOf(pkg: PTMemberPackageRow): Primary {
    if (pkg.trainer_active === false && canManage) return { label: 'Change trainer', icon: ArrowRightLeft, run: () => onTransfer([pkg]), tone: 'warn' };
    if ((pkg.due ?? 0) > 0) return { label: 'Collect', icon: IndianRupee, run: () => onCollect(pkg), tone: 'warn' };
    if (isExpired(pkg) || daysLeftOf(pkg) <= 7 || (Number(pkg.sessions_total || 0) > 0 && Number(pkg.sessions_remaining || 0) <= 2))
      return { label: 'Renew', icon: RefreshCw, run: () => onRenew(pkg) };
    return { label: 'Schedule', icon: CalendarPlus, run: () => onSchedule(pkg) };
  }

  function RowMenu({ pkg }: { pkg: PTMemberPackageRow }) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={`More actions for ${pkg.member_name ?? 'client'}`} onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          {!isExpired(pkg) && <DropdownMenuItem onClick={() => onSchedule(pkg)}><CalendarPlus className="mr-2 h-4 w-4" />Schedule session</DropdownMenuItem>}
          {canManage && !isExpired(pkg) && <DropdownMenuItem onClick={() => onTransfer([pkg])}><ArrowRightLeft className="mr-2 h-4 w-4" />Change trainer</DropdownMenuItem>}
          {(pkg.due ?? 0) > 0 && <DropdownMenuItem onClick={() => onCollect(pkg)}><IndianRupee className="mr-2 h-4 w-4" />Collect payment</DropdownMenuItem>}
          <DropdownMenuItem disabled={renewPending} onClick={() => onRenew(pkg)}><RefreshCw className="mr-2 h-4 w-4" />Renew</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onView(pkg)}><UserRound className="mr-2 h-4 w-4" />View member</DropdownMenuItem>
          {canCancelInvoice && pkg.invoice_id && (pkg.due ?? 0) > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onCancelInvoice(pkg)}>
                <XCircle className="mr-2 h-4 w-4" />Cancel invoice
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  function PrimaryButton({ pkg }: { pkg: PTMemberPackageRow }) {
    const a = primaryOf(pkg);
    const busy = a.label === 'Renew' && renewingId === pkg.id;
    return (
      <Button size="sm" variant={a.tone === 'warn' ? 'default' : 'outline'} className="min-h-11 gap-1.5"
        disabled={busy} onClick={(e) => { e.stopPropagation(); a.run(); }}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <a.icon className="h-4 w-4" aria-hidden />}{a.label}
      </Button>
    );
  }

  const rowKey = (pkg: PTMemberPackageRow) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' && e.target === e.currentTarget) onView(pkg);
  };

  const TrainerCell = ({ pkg }: { pkg: PTMemberPackageRow }) => (
    <span className="flex items-center gap-1.5 text-sm">
      {pkg.trainer_name || '—'}
      {pkg.trainer_active === false && (
        <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-[10px] text-destructive">Inactive</Badge>
      )}
    </span>
  );

  const Expiry = ({ pkg }: { pkg: PTMemberPackageRow }) => {
    const d = daysLeftOf(pkg);
    return (
      <div className="text-sm">
        <p className="tabular-nums">{format(new Date(pkg.expiry_date), 'dd MMM yyyy')}</p>
        <p className={cn('text-xs', d < 0 ? 'text-destructive' : d <= 7 ? 'text-warning' : 'text-muted-foreground')}>
          {d < 0 ? `${Math.abs(d)}d ago` : `${d}d left`}
        </p>
      </div>
    );
  };

  const MemberCell = ({ pkg }: { pkg: PTMemberPackageRow }) => (
    <div className="flex items-center gap-2">
      <Avatar className="h-8 w-8">
        {pkg.member_avatar_url && <AvatarImage src={pkg.member_avatar_url} alt={pkg.member_name || 'Member'} />}
        <AvatarFallback className={cn('text-xs font-semibold', avatarColor(pkg.member_name))}>{initialsOf(pkg.member_name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{pkg.member_name || 'Member'}</p>
        <p className="text-xs text-muted-foreground">{pkg.member_code}</p>
      </div>
    </div>
  );

  const shell = 'overflow-hidden rounded-2xl border-0 bg-card shadow-lg shadow-slate-200/50';

  if (loading) {
    return (
      <Card className={cn(shell, 'p-5')}>
        <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}</div>
      </Card>
    );
  }
  if (isError) {
    return (
      <Card className={shell}>
        <CardContent className="flex flex-col items-center py-14 text-center">
          <AlertTriangle className="mb-3 h-6 w-6 text-destructive" aria-hidden />
          <p className="font-semibold">Could not load PT clients</p>
          {onRetry && <Button variant="outline" className="mt-4 min-h-11" onClick={onRetry}>Retry</Button>}
        </CardContent>
      </Card>
    );
  }

  const needsTrainerRows = rows.filter(matchers.needs_trainer);

  return (
    <Card className={shell}>
      <div className="space-y-3 p-4">
        <div role="tablist" aria-label="Filter clients" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            const alert = f.warn && counts[f.key] > 0;
            return (
              <button key={f.key} role="tab" aria-selected={active} type="button"
                onClick={() => { setFilter(f.key); setPage(0); }}
                className={cn(
                  'inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active ? 'border-primary bg-primary text-primary-foreground'
                    : alert ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20'
                      : 'border-border bg-card text-foreground hover:bg-secondary',
                )}>
                {f.label}
                <span className={cn('rounded-full px-1.5 text-xs tabular-nums', active ? 'bg-primary-foreground/20' : 'bg-muted')}>{counts[f.key]}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input aria-label="Search clients" value={term} onChange={(e) => { setTerm(e.target.value); setPage(0); }}
              placeholder="Search member, code, trainer or package…" className="min-h-11 pl-10" />
          </div>
          {filter === 'needs_trainer' && canManage && needsTrainerRows.length > 0 && (
            <Button className="min-h-11 gap-1.5" onClick={() => onTransfer(needsTrainerRows)}>
              <ArrowRightLeft className="h-4 w-4" />Transfer all {needsTrainerRows.length} to…
            </Button>
          )}
          <span className="text-xs tabular-nums text-muted-foreground">Showing {visible.length} of {filtered.length}</span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <CardContent className="flex flex-col items-center py-14 text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success" aria-hidden><Users className="h-5 w-5" /></span>
          <p className="font-semibold">{filter === 'all' ? 'No active PT clients' : 'Nothing here — all clear'}</p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            {filter === 'all' ? 'Once members purchase a package they will appear here.' : 'No clients match this filter right now.'}
          </p>
        </CardContent>
      ) : (
        <>
          {/* Desktop */}
          <div className="hidden max-h-[640px] overflow-auto md:block">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead scope="col"><SortButton label="Member" active={sort === 'member'} onClick={() => toggleSort('member')} /></TableHead>
                  <TableHead scope="col">Package</TableHead>
                  <TableHead scope="col">Trainer</TableHead>
                  <TableHead scope="col"><SortButton label="Progress" active={sort === 'progress'} onClick={() => toggleSort('progress')} /></TableHead>
                  <TableHead scope="col"><SortButton label="Expires" active={sort === 'expiry'} onClick={() => toggleSort('expiry')} /></TableHead>
                  <TableHead scope="col">Payment</TableHead>
                  <TableHead scope="col" className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((pkg) => {
                  const p = progressOf(pkg);
                  return (
                    <TableRow key={pkg.id} tabIndex={0} onClick={() => onView(pkg)} onKeyDown={rowKey(pkg)}
                      className="cursor-pointer transition-colors duration-150 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                      <TableCell><MemberCell pkg={pkg} /></TableCell>
                      <TableCell className="text-sm">{pkg.package_name || '—'}{isExpired(pkg) && <Badge variant="outline" className="ml-2 border-border bg-muted text-[10px] text-muted-foreground">Expired</Badge>}</TableCell>
                      <TableCell><TrainerCell pkg={pkg} /></TableCell>
                      <TableCell><div className="flex items-center gap-2"><ProgressRing pct={p.pct} /><span className="text-xs text-muted-foreground">{p.label}</span></div></TableCell>
                      <TableCell><Expiry pkg={pkg} /></TableCell>
                      <TableCell><PaymentBadge pkg={pkg} /></TableCell>
                      <TableCell className="text-right"><div className="flex items-center justify-end gap-1"><PrimaryButton pkg={pkg} /><RowMenu pkg={pkg} /></div></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile */}
          <ul className="space-y-3 p-4 pt-0 md:hidden">
            {visible.map((pkg) => {
              const p = progressOf(pkg);
              return (
                <li key={pkg.id} className="rounded-2xl border border-border p-4" onClick={() => onView(pkg)}>
                  <div className="flex items-start justify-between gap-2"><MemberCell pkg={pkg} /><RowMenu pkg={pkg} /></div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div><p className="text-xs text-muted-foreground">Package</p>{pkg.package_name || '—'}</div>
                    <div><p className="text-xs text-muted-foreground">Trainer</p><TrainerCell pkg={pkg} /></div>
                    <div className="flex items-center gap-2"><ProgressRing pct={p.pct} /><span className="text-xs text-muted-foreground">{p.label}</span></div>
                    <Expiry pkg={pkg} />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2"><PaymentBadge pkg={pkg} /><PrimaryButton pkg={pkg} /></div>
                </li>
              );
            })}
          </ul>

          <div className="flex items-center justify-between border-t border-border p-3 text-sm">
            <span className="text-muted-foreground">Page {safePage + 1} of {pageCount}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="min-h-11" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Previous</Button>
              <Button variant="outline" size="sm" className="min-h-11" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>Next</Button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

function SortButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('inline-flex min-h-11 items-center gap-1 text-xs font-semibold uppercase tracking-wide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded', active ? 'text-foreground' : 'text-muted-foreground')}>
      {label}<ArrowUpDown className="h-3 w-3" aria-hidden />
    </button>
  );
}
