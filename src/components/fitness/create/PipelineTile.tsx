import { Skeleton } from '@/components/ui/skeleton';
import { ChevronRight, Check, AlertTriangle } from 'lucide-react';

interface PipelineTileProps {
  icon: React.ReactNode;
  title: string;
  count?: number;
  loading: boolean;
  singular: string;
  plural: string;
  /** Shown when the count is zero — should read as a call to action. */
  emptyHint: string;
  /** Short action label describing where the tile leads. */
  action: string;
  step: number;
  /** Empty state reads as a blocker (amber) rather than a neutral invite. */
  blocking?: boolean;
  onClick: () => void;
}

/**
 * One node of the Catalog → Templates → Assignments readiness strip.
 * Presentation only: counts are passed in by the page.
 */
export function PipelineTile({
  icon,
  title,
  count,
  loading,
  singular,
  plural,
  emptyHint,
  action,
  step,
  blocking,
  onClick,
}: PipelineTileProps) {
  const empty = !loading && !count;
  const ready = !loading && !!count;

  return (
    <button
      onClick={onClick}
      aria-label={`${title} — ${action}`}
      className="group flex min-h-[44px] w-full flex-1 cursor-pointer items-center gap-3 rounded-2xl bg-card p-4 text-left shadow-lg shadow-slate-200/50 ring-1 ring-border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        {icon}
        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
          {step}
        </span>
      </div>


      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{title}</p>
        {loading ? (
          <Skeleton className="mt-1 h-4 w-28 rounded" />
        ) : empty ? (
          <p className="truncate text-xs font-medium text-primary">{emptyHint}</p>
        ) : (
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-semibold tabular-nums text-foreground">{count}</span>{' '}
            {count === 1 ? singular : plural} · {action}
          </p>
        )}
      </div>

      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
    </button>
  );
}
