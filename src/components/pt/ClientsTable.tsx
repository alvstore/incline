import { useMemo, useState } from 'react';
import { format, differenceInDays } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Search,
  Users,
  MoreHorizontal,
  CalendarPlus,
  RefreshCw,
  XCircle,
  ArrowUpDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { avatarColor, initialsOf, type PTMemberPackageRow } from './ptTypes';

type SortKey = 'member' | 'progress' | 'expiry';

interface Props {
  rows: PTMemberPackageRow[];
  loading?: boolean;
  renewingId: string | null;
  renewPending: boolean;
  canCancelInvoice: boolean;
  onSchedule: () => void;
  onRenew: (pkg: PTMemberPackageRow) => void;
  onCancelInvoice: (pkg: PTMemberPackageRow) => void;
}

const PAGE_SIZE = 10;

/** Progress as a share of sessions used, or of elapsed duration for monthly plans. */
function progressOf(pkg: PTMemberPackageRow) {
  const total = Number(pkg.sessions_total || 0);
  if (total > 0) {
    const used = total - Number(pkg.sessions_remaining || 0);
    return {
      pct: Math.min(100, Math.round((used / total) * 100)),
      label: `${used}/${total} sessions`,
    };
  }
  const start = new Date(pkg.start_date || pkg.created_at || pkg.expiry_date);
  const end = new Date(pkg.expiry_date);
  const totalDays = Math.max(1, differenceInDays(end, start));
  const elapsed = Math.max(0, differenceInDays(new Date(), start));
  const daysLeft = Math.max(0, differenceInDays(end, new Date()));
  return {
    pct: Math.min(100, Math.round((elapsed / totalDays) * 100)),
    label: `${elapsed}d / ${totalDays}d · ${daysLeft}d left`,
  };
}

function ProgressRing({ pct }: { pct: number }) {
  const tone = pct >= 90 ? 'text-destructive' : pct >= 75 ? 'text-warning' : 'text-success';
  const r = 14;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 36 36" className="h-9 w-9 shrink-0 -rotate-90" role="img" aria-label={`${pct}% used`}>
      <circle cx="18" cy="18" r={r} className="stroke-muted" strokeWidth="4" fill="none" />
      <circle
        cx="18"
        cy="18"
        r={r}
        className={cn('stroke-current transition-all duration-300', tone)}
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
        strokeDasharray={c}
        strokeDashoffset={c - (c * pct) / 100}
      />
    </svg>
  );
}

export function ClientsTable({
  rows,
  loading,
  renewingId,
  renewPending,
  canCancelInvoice,
  onSchedule,
  onRenew,
  onCancelInvoice,
}: Props) {
  const [term, setTerm] = useState('');
  const [sort, setSort] = useState<SortKey>('expiry');
  const [asc, setAsc] = useState(true);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    const base = q
      ? rows.filter((r) =>
          [r.member_name, r.member_code, r.trainer_name, r.package_name]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(q),
        )
      : rows;

    const dir = asc ? 1 : -1;
    return [...base].sort((a, b) => {
      if (sort === 'member') return dir * (a.member_name || '').localeCompare(b.member_name || '');
      if (sort === 'progress') return dir * (progressOf(a).pct - progressOf(b).pct);
      return dir * (new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime());
    });
  }, [rows, term, sort, asc]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  function toggleSort(key: SortKey) {
    if (sort === key) setAsc((v) => !v);
    else {
      setSort(key);
      setAsc(true);
    }
    setPage(0);
  }

  if (loading) {
    return (
      <Card className="rounded-2xl border-0 bg-card p-5 shadow-lg shadow-slate-200/50">
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      </Card>
    );
  }

  if (!rows.length) {
    return (
      <Card className="rounded-2xl border-0 bg-card shadow-lg shadow-slate-200/50">
        <CardContent className="flex flex-col items-center py-16 text-center">
          <span
            className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-success"
            aria-hidden
          >
            <Users className="h-6 w-6" />
          </span>
          <p className="text-base font-semibold text-foreground">No active PT clients</p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            Once members purchase a package they will appear here for scheduling.
          </p>
          <Button onClick={onSchedule} className="mt-5 gap-2">
            <CalendarPlus className="h-4 w-4" aria-hidden />
            Schedule session
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden rounded-2xl border-0 bg-card shadow-lg shadow-slate-200/50">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <div className="relative min-w-[220px] flex-1">
          <Label htmlFor="pt-client-search" className="sr-only">
            Search clients
          </Label>
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="pt-client-search"
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setPage(0);
            }}
            placeholder="Search member, code, trainer or package…"
            className="pl-10"
          />
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          Showing {visible.length} of {filtered.length}
        </span>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <TableHead>
              <SortButton label="Member" active={sort === 'member'} onClick={() => toggleSort('member')} />
            </TableHead>
            <TableHead>Package</TableHead>
            <TableHead>Trainer</TableHead>
            <TableHead>
              <SortButton
                label="Progress"
                active={sort === 'progress'}
                onClick={() => toggleSort('progress')}
              />
            </TableHead>
            <TableHead>
              <SortButton label="Expires" active={sort === 'expiry'} onClick={() => toggleSort('expiry')} />
            </TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((pkg) => {
            const p = progressOf(pkg);
            const daysLeft = differenceInDays(new Date(pkg.expiry_date), new Date());
            return (
              <TableRow key={pkg.id} className="transition-colors duration-150 hover:bg-muted/50">
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold',
                        avatarColor(pkg.member_name),
                      )}
                      aria-hidden
                    >
                      {initialsOf(pkg.member_name)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-foreground">
                        {pkg.member_name || '—'}
                      </span>
                      {pkg.member_code && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {pkg.member_code}
                        </span>
                      )}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-foreground">{pkg.package_name}</TableCell>
                <TableCell className="text-foreground">{pkg.trainer_name || '—'}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <ProgressRing pct={p.pct} />
                    <span className="text-xs text-muted-foreground">{p.label}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="text-foreground">{format(new Date(pkg.expiry_date), 'PP')}</span>
                    <Badge
                      className={cn(
                        'mt-1 w-fit rounded-full px-2 py-0 text-[10px] font-medium',
                        daysLeft <= 0
                          ? 'bg-destructive/10 text-destructive hover:bg-destructive/10'
                          : daysLeft <= 7
                            ? 'bg-warning/10 text-warning hover:bg-warning/10'
                            : 'bg-muted text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {daysLeft <= 0 ? 'Expired' : `${daysLeft}d left`}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    className={cn(
                      'rounded-full px-2.5 py-0.5 text-xs font-medium',
                      pkg.status === 'active'
                        ? 'bg-success/10 text-success hover:bg-success/10'
                        : 'bg-muted text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {pkg.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Actions for ${pkg.member_name || 'client'}`}
                        className="h-11 w-11 cursor-pointer rounded-lg"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-xl">
                      <DropdownMenuItem onClick={onSchedule} className="cursor-pointer gap-2">
                        <CalendarPlus className="h-4 w-4" aria-hidden />
                        Schedule session
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={renewPending && renewingId === pkg.id}
                        onClick={() => onRenew(pkg)}
                        className="cursor-pointer gap-2"
                      >
                        <RefreshCw className="h-4 w-4" aria-hidden />
                        {renewPending && renewingId === pkg.id ? 'Renewing…' : 'Renew package'}
                      </DropdownMenuItem>
                      {canCancelInvoice && pkg.invoice_id && (
                        <DropdownMenuItem
                          onClick={() => onCancelInvoice(pkg)}
                          className="cursor-pointer gap-2 text-destructive focus:text-destructive"
                        >
                          <XCircle className="h-4 w-4" aria-hidden />
                          Cancel invoice
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-2 border-t border-border p-3">
          <span className="text-xs text-muted-foreground tabular-nums">
            Page {safePage + 1} of {pageCount}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function SortButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex cursor-pointer items-center gap-1 rounded text-xs font-semibold uppercase tracking-wider focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      {label}
      <ArrowUpDown className="h-3 w-3" aria-hidden />
    </button>
  );
}
