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
import {
  MEMBER_STATUS_CHIPS,
  MEMBER_SORT_OPTIONS,
  JOINED_RANGES,
  type MemberStatusKey,
} from './memberFilterOptions';

export type { MemberStatusKey };

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
