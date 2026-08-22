import { Clock } from 'lucide-react';
import {
  formatIstDay,
  formatIstTime,
  formatMinutes,
  type ClientVisitSummary,
} from '@/hooks/useTrainerClientVisits';

/**
 * "When does this client actually come in?" — last three visit days from the
 * turnstile feed plus a typical arrival hint, so trainers can plan the floor.
 */
export function ClientVisitRhythm({
  summary,
  loading,
}: {
  summary?: ClientVisitSummary;
  loading?: boolean;
}) {
  if (loading) {
    return <div className="mt-3 h-9 animate-pulse rounded-xl bg-muted/60" />;
  }

  if (!summary || summary.recent.length === 0) {
    return (
      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="h-3.5 w-3.5" aria-hidden />
        No visits in the last 7 days
      </p>
    );
  }

  return (
    <div className="mt-3 rounded-xl bg-muted/50 px-3 py-2">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Clock className="h-3 w-3" aria-hidden /> Last attended
      </p>
      <p className="mt-1 text-xs font-medium text-foreground">
        {summary.recent
          .map((v) => `${formatIstDay(v.visit_date)} ${formatIstTime(v.first_seen)}`)
          .join(' · ')}
      </p>
      {summary.typicalArrivalMinutes !== null && (
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Usually arrives around {formatMinutes(summary.typicalArrivalMinutes)}
        </p>
      )}
    </div>
  );
}
