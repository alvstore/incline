import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Package,
  Edit,
  Eye,
  EyeOff,
  IndianRupee,
  CalendarDays,
  Dumbbell,
  Utensils,
  Heart,
  Moon,
  Target,
  Activity,
  Zap,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PTPackageRow } from './ptTypes';

const SESSION_TYPE_LABELS: Record<string, string> = {
  per_session: 'Per Session',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  custom: 'Custom',
};

type Tier = 'silver' | 'gold' | 'platinum' | 'default';

function inferTier(name: string | null | undefined): Tier {
  const n = (name || '').toLowerCase();
  if (n.includes('platinum') || n.includes('elite')) return 'platinum';
  if (n.includes('gold')) return 'gold';
  if (n.includes('silver') || n.includes('basic') || n.includes('foundation')) return 'silver';
  return 'default';
}

const TIER_RIBBON: Record<Tier, string> = {
  silver: 'bg-gradient-to-r from-muted-foreground/60 via-muted to-muted-foreground/60',
  gold: 'bg-gradient-to-r from-warning via-warning to-warning',
  platinum: 'bg-gradient-to-r from-primary via-primary to-primary/90',
  default: 'bg-gradient-to-r from-primary via-primary to-primary/80',
};

const TIER_ICON_BG: Record<Tier, string> = {
  silver: 'bg-muted text-muted-foreground',
  gold: 'bg-warning/15 text-warning',
  platinum: 'bg-primary/15 text-primary',
  default: 'bg-primary/15 text-primary',
};

// Parse a free-text description into "Label: value" feature rows.
function parseFeatureRows(text: string): Array<{ label: string; value: string }> {
  if (!text) return [];
  const normalized = text.replace(/\r\n/g, '\n').trim();
  const segments = normalized
    .split(/(?:\.\s+|\n+)(?=[A-Z][A-Za-z0-9 /&-]{1,40}:)/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const rows: Array<{ label: string; value: string }> = [];
  for (const seg of segments) {
    const m = seg.match(/^([A-Z][A-Za-z0-9 /&-]{1,40}):\s*(.+?)\.?$/s);
    if (m) rows.push({ label: m[1].trim(), value: m[2].trim() });
  }
  return rows;
}

const FEATURE_ICON_MAP: Array<{ test: RegExp; Icon: typeof Dumbbell }> = [
  { test: /coaching|training|session|workout|gym/i, Icon: Dumbbell },
  { test: /nutrition|diet|meal|caloric/i, Icon: Utensils },
  { test: /recovery|sauna|ice|massage|rest/i, Icon: Heart },
  { test: /sleep|rest/i, Icon: Moon },
  { test: /frequency|schedule|day|week/i, Icon: CalendarDays },
  { test: /goal|target|focus/i, Icon: Target },
  { test: /assessment|scan|measure|tracking/i, Icon: Activity },
  { test: /support|access|premium|priority/i, Icon: Zap },
];

function iconForLabel(label: string): typeof Dumbbell {
  for (const { test, Icon } of FEATURE_ICON_MAP) if (test.test(label)) return Icon;
  return Sparkles;
}

export function PackageCard({
  pkg,
  canManage,
  onEdit,
  onToggle,
}: {
  pkg: PTPackageRow;
  canManage: boolean;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const tier = inferTier(pkg.name);
  const isMonthly =
    pkg.session_type === 'monthly' ||
    pkg.session_type === 'quarterly' ||
    (pkg.total_sessions ?? 0) === 0;
  const inactive = pkg.is_active === false;
  const months = Math.max(1, Math.round((pkg.validity_days || 30) / 30));
  const badgeLabel = isMonthly
    ? pkg.session_type === 'quarterly'
      ? 'Quarterly'
      : 'Monthly Plan'
    : SESSION_TYPE_LABELS[pkg.session_type || ''] || 'Per Session';

  const featureRows = useMemo(() => parseFeatureRows(pkg.description || ''), [pkg.description]);

  return (
    <Card
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-2xl border-0 bg-card shadow-lg shadow-slate-200/50 transition-all duration-200 hover:shadow-xl hover:shadow-primary/10',
        inactive && 'opacity-70',
      )}
    >
      <div className={cn('h-1.5', TIER_RIBBON[tier])} aria-hidden />
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
              TIER_ICON_BG[tier],
            )}
          >
            {isMonthly ? (
              <CalendarDays className="h-3 w-3" aria-hidden />
            ) : (
              <Dumbbell className="h-3 w-3" aria-hidden />
            )}
            {badgeLabel}
          </span>
          {canManage && (
            <div className="flex gap-1 max-md:opacity-100 md:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:focus-within:opacity-100">
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Edit ${pkg.name}`}
                className="h-11 w-11 cursor-pointer rounded-lg text-primary hover:bg-primary/10"
                onClick={onEdit}
              >
                <Edit className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={inactive ? `Activate ${pkg.name}` : `Deactivate ${pkg.name}`}
                className="h-11 w-11 cursor-pointer rounded-lg text-muted-foreground hover:bg-muted"
                onClick={onToggle}
              >
                {inactive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </Button>
            </div>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span
            className={cn(
              'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl',
              TIER_ICON_BG[tier],
            )}
            aria-hidden
          >
            <Package className="h-4 w-4" />
          </span>
          <CardTitle className="text-lg font-bold leading-snug text-foreground">{pkg.name}</CardTitle>
        </div>
        {inactive && (
          <Badge className="absolute right-3 top-3 rounded-full bg-muted text-[10px] text-foreground hover:bg-muted">
            Inactive
          </Badge>
        )}
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        {pkg.description &&
          (featureRows.length > 0 ? (
            <ul className="space-y-2.5">
              {featureRows.map((row, idx) => {
                const Icon = iconForLabel(row.label);
                return (
                  <li key={`${row.label}-${idx}`} className="flex items-start gap-2.5">
                    <span
                      className={cn(
                        'mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg',
                        TIER_ICON_BG[tier],
                      )}
                      aria-hidden
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {row.label}
                      </p>
                      <p className="text-sm leading-snug text-foreground">{row.value}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {pkg.description}
            </p>
          ))}

        <div className="mt-auto pt-2">
          <div className="grid grid-cols-3 divide-x divide-border rounded-xl bg-muted/40 py-3">
            <div className="px-2 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {isMonthly ? 'Months' : 'Sessions'}
              </p>
              <p className="mt-0.5 text-base font-bold tabular-nums text-foreground">
                {isMonthly ? months : pkg.total_sessions || 0}
              </p>
            </div>
            <div className="px-2 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Price
              </p>
              <p className="mt-0.5 flex items-center justify-center text-base font-bold tabular-nums text-foreground">
                <IndianRupee className="h-3.5 w-3.5" aria-hidden />
                {(pkg.price || 0).toLocaleString('en-IN')}
              </p>
            </div>
            <div className="px-2 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Validity
              </p>
              <p className="mt-0.5 text-base font-bold tabular-nums text-foreground">
                {pkg.validity_days || 0}d
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
