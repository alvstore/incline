import { Search, X, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type MemberStatusKey =
  | 'active'
  | 'scheduled'
  | 'frozen'
  | 'pending_plan'
  | 'inactive'
  | 'expiring_soon'
  | 'has_dues';

export const MEMBER_STATUS_CHIPS: { value: MemberStatusKey; label: string; className: string }[] = [
  { value: 'active', label: 'Active', className: 'bg-success/10 text-success border-success/30' },
  { value: 'scheduled', label: 'Scheduled', className: 'bg-indigo-100 text-indigo-700 border-indigo-300 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30' },
  { value: 'frozen', label: 'Frozen', className: 'bg-info/10 text-info border-info/30' },
  { value: 'pending_plan', label: 'Pending Plan', className: 'bg-warning/15 text-warning border-warning/30' },
  { value: 'inactive', label: 'Inactive', className: 'bg-muted text-muted-foreground border-border' },
  { value: 'expiring_soon', label: 'Expiring ≤7d', className: 'bg-destructive/10 text-destructive border-destructive/30' },
  { value: 'has_dues', label: 'Has Dues', className: 'bg-destructive/10 text-destructive border-destructive/30' },
];

export const MEMBER_SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'joined', label: 'Joined date' },
  { value: 'name', label: 'Name' },
  { value: 'code', label: 'Member code' },
  { value: 'status', label: 'Status' },
  { value: 'membership', label: 'Plan' },
  { value: 'days_left', label: 'Days left' },
  { value: 'expiry', label: 'Plan expiry' },
  { value: 'dues', label: 'Dues' },
];

export const JOINED_RANGES: { value: string; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'month', label: 'This month' },
];

export interface MemberFilterState {
  search: string;
  statuses: MemberStatusKey[];
  planId: string;
  joinedRange: string;
  sort: string;
  dir: 'asc' | 'desc';
}

interface MemberFilterBarProps {
  value: MemberFilterState;
  onChange: (next: MemberFilterState) => void;
  plans: { id: string; name: string }[];
  resultCount?: number | null;
}

export function MemberFilterBar({ value, onChange, plans, resultCount }: MemberFilterBarProps) {
  const patch = (p: Partial<MemberFilterState>) => onChange({ ...value, ...p });

  const toggleStatus = (s: MemberStatusKey) =>
    patch({
      statuses: value.statuses.includes(s)
        ? value.statuses.filter((x) => x !== s)
        : [...value.statuses, s],
    });

  const activeChips: { key: string; label: string; clear: () => void }[] = [
    ...value.statuses.map((s) => ({
      key: `status-${s}`,
      label: MEMBER_STATUS_CHIPS.find((c) => c.value === s)?.label ?? s,
      clear: () => toggleStatus(s),
    })),
    ...(value.planId !== 'all'
      ? [{
          key: 'plan',
          label: `Plan: ${plans.find((p) => p.id === value.planId)?.name ?? 'Selected'}`,
          clear: () => patch({ planId: 'all' }),
        }]
      : []),
    ...(value.joinedRange !== 'any'
      ? [{
          key: 'joined',
          label: `Joined: ${JOINED_RANGES.find((r) => r.value === value.joinedRange)?.label}`,
          clear: () => patch({ joinedRange: 'any' }),
        }]
      : []),
    ...(value.search.trim()
      ? [{ key: 'search', label: `“${value.search.trim()}”`, clear: () => patch({ search: '' }) }]
      : []),
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <label htmlFor="member-search" className="sr-only">Search members</label>
          <Input
            id="member-search"
            placeholder="Search by name, email, phone, or member code..."
            value={value.search}
            onChange={(e) => patch({ search: e.target.value })}
            className="pl-10 h-11 rounded-xl bg-muted/30 border-border/50 focus:bg-background transition-colors"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={value.planId} onValueChange={(v) => patch({ planId: v })}>
            <SelectTrigger className="h-11 w-[170px] rounded-xl" aria-label="Filter by plan">
              <SelectValue placeholder="All plans" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All plans</SelectItem>
              {plans.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={value.joinedRange} onValueChange={(v) => patch({ joinedRange: v })}>
            <SelectTrigger className="h-11 w-[150px] rounded-xl" aria-label="Filter by joined date">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {JOINED_RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={value.sort} onValueChange={(v) => patch({ sort: v })}>
            <SelectTrigger className="h-11 w-[160px] rounded-xl" aria-label="Sort by">
              <ArrowUpDown className="h-4 w-4 mr-2 opacity-60" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MEMBER_SORT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-11 w-11 rounded-xl"
            aria-label={value.dir === 'asc' ? 'Sort ascending, switch to descending' : 'Sort descending, switch to ascending'}
            onClick={() => patch({ dir: value.dir === 'asc' ? 'desc' : 'asc' })}
          >
            {value.dir === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {MEMBER_STATUS_CHIPS.map((chip) => {
          const selected = value.statuses.includes(chip.value);
          return (
            <button
              key={chip.value}
              type="button"
              onClick={() => toggleStatus(chip.value)}
              aria-pressed={selected}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40',
                selected ? chip.className : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted',
              )}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Filters</span>
          {activeChips.map((c) => (
            <Badge key={c.key} variant="secondary" className="rounded-full gap-1 pr-1">
              {c.label}
              <button
                type="button"
                onClick={c.clear}
                aria-label={`Remove filter ${c.label}`}
                className="rounded-full p-0.5 hover:bg-background/60 cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange({ ...value, search: '', statuses: [], planId: 'all', joinedRange: 'any' })}
          >
            Clear all
          </Button>
          {typeof resultCount === 'number' && (
            <span className="text-xs text-muted-foreground ml-auto">{resultCount} matching</span>
          )}
        </div>
      )}
    </div>
  );
}
