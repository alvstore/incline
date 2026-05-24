import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkles, TrendingUp, CalendarRange, CalendarDays, type LucideIcon } from 'lucide-react';
import { startOfMonth, startOfYear, subDays, format } from 'date-fns';
import { cn } from '@/lib/utils';

interface Props {
  branchFilter: string | null;
}

async function countNewMembers(branchFilter: string | null, gte: string) {
  let q = supabase.from('members').select('id', { count: 'exact', head: true }).gte('created_at', gte);
  if (branchFilter) q = q.eq('branch_id', branchFilter);
  const { count } = await q;
  return count ?? 0;
}

interface Tile {
  label: string;
  value: number;
  icon: LucideIcon;
  accent: string; // gradient classes
  ring: string;
  glow: string;
}

export function JoinedSummaryStrip({ branchFilter }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['joined-summary', branchFilter],
    queryFn: async () => {
      const now = new Date();
      const today = format(now, 'yyyy-MM-dd');
      const sevenAgo = subDays(now, 7).toISOString();
      const monthStart = startOfMonth(now).toISOString();
      const yearStart = startOfYear(now).toISOString();
      const [t, w, m, y] = await Promise.all([
        countNewMembers(branchFilter, today),
        countNewMembers(branchFilter, sevenAgo),
        countNewMembers(branchFilter, monthStart),
        countNewMembers(branchFilter, yearStart),
      ]);
      return { today: t, week: w, month: m, year: y };
    },
  });

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 sm:h-24 rounded-2xl" />
        ))}
      </div>
    );
  }

  const tiles: Tile[] = [
    {
      label: 'Joined Today',
      value: data.today,
      icon: Sparkles,
      accent: 'from-violet-500 via-fuchsia-500 to-pink-500',
      ring: 'ring-violet-500/20',
      glow: 'shadow-violet-500/20',
    },
    {
      label: 'Last 7 Days',
      value: data.week,
      icon: TrendingUp,
      accent: 'from-sky-500 via-cyan-500 to-teal-500',
      ring: 'ring-sky-500/20',
      glow: 'shadow-sky-500/20',
    },
    {
      label: 'This Month',
      value: data.month,
      icon: CalendarRange,
      accent: 'from-amber-500 via-orange-500 to-rose-500',
      ring: 'ring-amber-500/20',
      glow: 'shadow-amber-500/20',
    },
    {
      label: 'This Year',
      value: data.year,
      icon: CalendarDays,
      accent: 'from-emerald-500 via-green-500 to-lime-500',
      ring: 'ring-emerald-500/20',
      glow: 'shadow-emerald-500/20',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
      {tiles.map((t) => (
        <div
          key={t.label}
          title={`${t.value.toLocaleString()} members · ${t.label}`}
          className={cn(
            'group relative overflow-hidden rounded-2xl bg-card p-3 sm:p-4 ring-1 ring-border/60',
            'shadow-lg transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl',
            t.glow,
          )}
        >
          {/* Decorative gradient glow */}
          <div
            className={cn(
              'pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br opacity-20 blur-2xl transition-opacity duration-300 group-hover:opacity-40',
              t.accent,
            )}
          />
          {/* Subtle grid texture */}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--border))_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border))_1px,transparent_1px)] bg-[size:24px_24px] opacity-[0.04]" />

          {/* NEW chip (hidden on xs to save room) */}
          <span className="absolute right-2 top-2 hidden sm:inline-flex rounded-full bg-muted/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            New
          </span>

          <div className="relative flex items-center gap-3">
            <div
              className={cn(
                'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md',
                t.accent,
              )}
            >
              <t.icon className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-2xl md:text-3xl font-bold tabular-nums leading-tight text-foreground">
                {t.value.toLocaleString()}
              </div>
              <p className="text-[11px] font-medium text-muted-foreground truncate">{t.label}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
