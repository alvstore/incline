import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Lock,
  PlugZap,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';

export type GoogleConnState = 'unknown' | 'not_configured' | 'read_only' | 'live';

interface DiagnoseCheck {
  key: string;
  ok: boolean;
  lane: 'places' | 'business_profile';
  label: string;
  hint?: string;
}

interface Props {
  state: GoogleConnState;
  checks: DiagnoseCheck[];
  isChecking: boolean;
  isFetching: boolean;
  onConnect: () => void;
  onRecheck: () => void;
  onFetch: () => void;
}

const COPY: Record<
  Exclude<GoogleConnState, 'unknown'>,
  { title: string; body: string; cta: string; tone: string; icon: typeof PlugZap }
> = {
  not_configured: {
    title: 'Google Business Profile is not connected',
    body: 'Reviews cannot be pulled in and replies cannot be posted until this branch is linked to its Google location.',
    cta: 'Connect Google',
    tone: 'border-warning/25 bg-warning/10 text-warning',
    icon: PlugZap,
  },
  read_only: {
    title: 'Reading reviews live — replies are posted by hand',
    body: 'Ratings and recent reviews sync automatically from Google. Posting replies from here needs Business Profile API access from Google; until that is granted, use "Copy & open on Google" on each review and mark it replied.',
    cta: 'Finish connection',

    tone: 'border-warning/25 bg-warning/10 text-warning',
    icon: Lock,
  },
  live: {
    title: 'Connected — replies post straight to Google',
    body: 'Business Profile access is active for this branch. New reviews sync automatically and replies publish in real time.',
    cta: 'Manage connection',
    tone: 'border-success/25 bg-success/10 text-success',
    icon: ShieldCheck,
  },
};

/**
 * Always-visible connection health strip for the external reviews workspace.
 * Makes the "why is the reply button disabled?" answer obvious and one click
 * away from being fixed.
 */
export default function GoogleConnectionBanner({
  state,
  checks,
  isChecking,
  isFetching,
  onConnect,
  onRecheck,
  onFetch,
}: Props) {
  if (state === 'unknown') {
    return (
      <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50">
        <CardContent className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Checking the Google connection for this branch…
        </CardContent>
      </Card>
    );
  }

  const copy = COPY[state];
  const Icon = copy.icon;
  const failing = checks.filter((c) => !c.ok);

  return (
    <Card className={`rounded-2xl border ${copy.tone.split(' ').slice(0, 2).join(' ')} shadow-lg shadow-slate-200/40`}>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-start gap-3">
          <span
            className={`rounded-full p-2 ${
              state === 'live' ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
            }`}
          >
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-foreground">{copy.title}</p>
              <Badge
                className={
                  state === 'live'
                    ? 'bg-success/15 text-success'
                    : state === 'read_only'
                      ? 'bg-warning/15 text-warning'
                      : 'bg-muted text-muted-foreground'
                }
              >
                {state === 'live' ? 'Live' : state === 'read_only' ? 'Places · read-only' : 'Not connected'}
              </Badge>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{copy.body}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={state === 'live' ? 'outline' : 'default'}
              onClick={onConnect}
              className="cursor-pointer"
            >
              <PlugZap className="mr-1.5 h-4 w-4" aria-hidden />
              {copy.cta}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onRecheck}
              disabled={isChecking}
              className="cursor-pointer"
              aria-label="Re-check the Google connection"
            >
              <RefreshCw className={`mr-1.5 h-4 w-4 ${isChecking ? 'animate-spin' : ''}`} aria-hidden />
              Re-check
            </Button>
            {state !== 'not_configured' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onFetch}
                disabled={isFetching}
                className="cursor-pointer"
              >
                <RefreshCw className={`mr-1.5 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} aria-hidden />
                Fetch now
              </Button>
            )}
          </div>
        </div>

        {failing.length > 0 && (
          <ul className="grid gap-1.5 rounded-xl bg-background/60 p-3">
            {failing.map((c) => (
              <li key={c.key} className="flex items-start gap-2 text-xs">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
                <span className="text-muted-foreground">
                  <strong className="text-foreground">{c.label}</strong>
                  {c.hint ? ` — ${c.hint}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}

        {state === 'live' && failing.length === 0 && (
          <p className="flex items-center gap-1.5 text-xs text-success">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            All connection checks passed.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
