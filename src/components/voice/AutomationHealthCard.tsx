import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Bot, CheckCircle2, AlertTriangle, PauseCircle, Clock, RefreshCw, PhoneOutgoing } from 'lucide-react';
import { useVoiceAutomationHealth } from '@/hooks/useVoiceOps';
import { automationStatus, voiceTime } from '@/lib/voice/automationStatus';

const states = {
  paused: { label: 'Paused', Icon: PauseCircle, tone: 'bg-muted text-muted-foreground' },
  disabled: { label: 'Switched off', Icon: PauseCircle, tone: 'bg-muted text-muted-foreground' },
  attention: { label: 'Needs attention', Icon: AlertTriangle, tone: 'bg-destructive/10 text-destructive' },
  unknown: { label: 'Status unavailable', Icon: AlertTriangle, tone: 'bg-muted text-muted-foreground' },
  outside: { label: 'Outside calling hours', Icon: Clock, tone: 'bg-accent/10 text-accent' },
  scheduled: { label: 'Scheduled', Icon: CheckCircle2, tone: 'bg-primary/10 text-primary' },
};

export function AutomationHealthCard() {
  const { data, isLoading, isError, refetch } = useVoiceAutomationHealth();
  const state = states[isError ? 'unknown' : automationStatus(data?.automation, data?.scheduler)];
  const run = data?.last_run;
  const renewal = data?.renewal;
  return (
    <Card className="h-full rounded-2xl border-border motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
      <CardHeader className="pb-4">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span className="rounded-xl bg-primary/10 p-2 text-primary"><Bot className="h-5 w-5" aria-hidden /></span>
          Automatic member care
          {!isLoading && <Badge variant="secondary" className={`ml-auto gap-1.5 ${state.tone}`}><state.Icon className="h-3.5 w-3.5" />{state.label}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? <Skeleton className="h-40 w-full rounded-xl" /> : isError ? (
          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">Could not load calling status.<Button variant="outline" onClick={() => refetch()}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button></div>
        ) : <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <div><p className="text-xs text-muted-foreground">Retention · last check</p><p className="mt-1 text-sm font-semibold">{voiceTime(data?.scheduler?.last_run_at)} IST</p></div>
            <div><p className="text-xs text-muted-foreground">Retention · next check</p><p className="mt-1 text-sm font-semibold">{data?.automation?.paused || !data?.automation?.enabled ? 'Not scheduled' : `${voiceTime(data?.scheduler?.next_run_at)} IST`}</p></div>
            <div><p className="text-xs text-muted-foreground">Last dialing run</p><p className="mt-1 text-sm font-semibold">{voiceTime(run?.started_at)}</p></div>
            <div><p className="text-xs text-muted-foreground">Last run · due / placed</p><p className="mt-1 text-sm font-semibold tabular-nums">{run?.candidates_found ?? '—'} / {run?.calls_placed ?? '—'}</p></div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
            <div><p className="text-xs text-muted-foreground">Renewal calling</p><p className="mt-1 text-sm font-semibold">{data?.automation?.paused || renewal?.paused ? 'Paused' : renewal?.enabled && renewal?.voice_enabled ? 'Scheduled' : 'Switched off'}</p></div>
            <div className="text-right"><p className="text-xs text-muted-foreground">Renewal · next check</p><p className="mt-1 text-sm font-semibold">{voiceTime(renewal?.next_check_at)} IST</p></div>
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
            <PhoneOutgoing className="h-4 w-4 shrink-0 text-primary" /><div><p className="text-xs text-muted-foreground">Last actual call · this branch selection</p><p className="text-sm font-semibold">{voiceTime(data?.last_call_at)} IST</p></div>
          </div>
          {(data?.automation?.pause_reason || run?.last_error || data?.scheduler?.last_error) && <p className="text-sm text-destructive">{data?.automation?.pause_reason || data?.scheduler?.last_error || run?.last_error}</p>}
        </>}
      </CardContent>
    </Card>
  );
}
