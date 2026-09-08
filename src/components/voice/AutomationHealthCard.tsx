/**
 * Automation Health — plain-language status of the server-side retention worker.
 * The worker runs every 10 minutes and decides on its own whether it may call.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Bot, CheckCircle2, AlertTriangle, PauseCircle } from 'lucide-react';
import { format } from 'date-fns';
import { useVoiceAutomationHealth } from '@/hooks/useVoiceOps';

function when(value?: string | null) {
  if (!value) return 'Never';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'Never' : format(d, 'dd MMM, HH:mm');
}

const SKIP_TEXT: Record<string, string> = {
  outside_window: 'Outside the calling hours',
  daily_cap_reached: "Today's call limit is already used",
  retention_disabled: 'Retention calling is switched off in Settings',
  integration_inactive: 'Voice provider is not connected yet',
  not_ready: 'Voice agent setup is incomplete',
  no_candidates: 'No members are due for a call right now',
  locked: 'Another run was already in progress',
};

export function AutomationHealthCard() {
  const { data, isLoading, isError } = useVoiceAutomationHealth();

  const run = data?.last_run ?? null;
  const scheduler = data?.scheduler ?? null;
  const paused = scheduler?.is_active === false;
  const failing = run?.status === 'failed' || (run?.error_count ?? 0) > 0;

  const state = paused
    ? { label: 'Paused', className: 'bg-slate-100 text-slate-600', Icon: PauseCircle }
    : failing
      ? { label: 'Needs attention', className: 'bg-red-100 text-red-700', Icon: AlertTriangle }
      : { label: 'Running', className: 'bg-emerald-100 text-emerald-700', Icon: CheckCircle2 };

  const reason = run?.skip_reason ? (SKIP_TEXT[run.skip_reason] ?? run.skip_reason) : null;

  return (
    <Card className="rounded-2xl shadow-sm transition-all duration-200 hover:shadow-md">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="rounded-full bg-indigo-50 p-2 text-indigo-600"><Bot className="h-4 w-4" aria-hidden /></span>
          Automation health
          {!isLoading && (
            <Badge className={`ml-auto rounded-full ${state.className}`}>
              <state.Icon className="mr-1 h-3 w-3" aria-hidden />
              {state.label}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}
          </div>
        ) : isError ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Could not load automation status.</p>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Last check</p>
                <p className="text-sm font-semibold text-foreground">{when(run?.started_at)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Members due</p>
                <p className="text-sm font-semibold text-foreground">{run?.candidates_found ?? 0}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Calls placed</p>
                <p className="text-sm font-semibold text-foreground">{run?.calls_placed ?? 0}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Last call placed</p>
                <p className="text-sm font-semibold text-foreground">{when(data?.last_success?.started_at)}</p>
              </div>
            </div>

            {reason && (
              <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Nothing was called on the last check: {reason}.
              </p>
            )}
            {run?.last_error && (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{run.last_error}</p>
            )}
            {paused && (
              <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Automatic calling is switched off. Turn it back on from Settings to resume.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
