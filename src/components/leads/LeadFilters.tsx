import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Search, Filter, Flame, Sun, Snowflake } from 'lucide-react';
import type { LeadFilters as LeadFiltersType } from '@/services/leadService';

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'negotiation', 'converted', 'lost'] as const;

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  new: { color: 'bg-sky-500/10 text-sky-600 border-sky-200', label: 'New' },
  contacted: { color: 'bg-amber-500/10 text-amber-600 border-amber-200', label: 'Contacted' },
  qualified: { color: 'bg-emerald-500/10 text-emerald-600 border-emerald-200', label: 'Qualified' },
  negotiation: { color: 'bg-violet-500/10 text-violet-600 border-violet-200', label: 'Negotiation' },
  converted: { color: 'bg-primary/10 text-primary border-primary/20', label: 'Converted' },
  lost: { color: 'bg-muted text-muted-foreground border-border', label: 'Lost' },
};

const TEMP_CONFIG = [
  { value: 'hot', label: 'Hot', icon: Flame, color: 'bg-red-500/10 text-red-600 border-red-200' },
  { value: 'warm', label: 'Warm', icon: Sun, color: 'bg-amber-500/10 text-amber-600 border-amber-200' },
  { value: 'cold', label: 'Cold', icon: Snowflake, color: 'bg-blue-500/10 text-blue-600 border-blue-200' },
];

interface LeadFilterBarProps {
  filters: LeadFiltersType;
  onFiltersChange: (filters: LeadFiltersType) => void;
  sources: string[];
  statusFilter: string[];
  onStatusFilterChange: (statuses: string[]) => void;
  temperatureFilter: string[];
  onTemperatureFilterChange: (temps: string[]) => void;
}

export function LeadFilterBar({
  filters,
  onFiltersChange,
  sources,
  statusFilter,
  onStatusFilterChange,
  temperatureFilter,
  onTemperatureFilterChange,
}: LeadFilterBarProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, phone, email..."
            value={filters.search || ''}
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
            className="pl-10 rounded-xl"
          />
        </div>
        <Select value={filters.source || 'all'} onValueChange={(v) => onFiltersChange({ ...filters, source: v })}>
          <SelectTrigger className="w-[150px] rounded-xl">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['all', ...sources].map(s => (
              <SelectItem key={s} value={s}>{s === 'all' ? 'All Sources' : s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.ownerId || 'all'} onValueChange={(v) => onFiltersChange({ ...filters, ownerId: v === 'all' ? undefined : v })}>
          <SelectTrigger className="w-[150px] rounded-xl">
            <SelectValue placeholder="All Owners" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Owners</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Status chips */}
      <div className="flex flex-wrap gap-2">
        {LEAD_STATUSES.map(status => {
          const cfg = STATUS_CONFIG[status];
          const isSelected = statusFilter.includes(status);
          return (
            <button
              key={status}
              onClick={() => onStatusFilterChange(
                isSelected ? statusFilter.filter(s => s !== status) : [...statusFilter, status]
              )}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                isSelected ? cfg.color : 'bg-muted/50 text-muted-foreground border-border opacity-60'
              }`}
            >
              {cfg.label}
            </button>
          );
        })}
        <div className="w-px h-6 bg-border mx-1" />
        {TEMP_CONFIG.map(temp => {
          const isSelected = temperatureFilter.includes(temp.value);
          const TempIcon = temp.icon;
          return (
            <button
              key={temp.value}
              onClick={() => onTemperatureFilterChange(
                isSelected ? temperatureFilter.filter(t => t !== temp.value) : [...temperatureFilter, temp.value]
              )}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors flex items-center gap-1 ${
                isSelected ? temp.color : 'bg-muted/50 text-muted-foreground border-border opacity-60'
              }`}
            >
              <TempIcon className="h-3 w-3" />
              {temp.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export { STATUS_CONFIG, LEAD_STATUSES, TEMP_CONFIG };
