import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Globe, Star, MapPin, RefreshCw, Settings, Stethoscope,
  CheckCircle2, AlertTriangle, Loader2, ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface DiagnoseCheck {
  key: string;
  ok: boolean;
  lane: 'places' | 'business_profile';
  label: string;
  hint?: string;
}

interface Props {
  branchId?: string;
  integration?: any;
  onConfigure: () => void;
}

const fmtWhen = (iso?: string | null) => {
  if (!iso) return 'never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? 'never'
    : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/**
 * Google Business Profile card for Settings → Integrations.
 * Places API (New) is the only lane used for reading — the legacy
 * account/location discovery path has been removed.
 */
export default function GoogleListingCard({ branchId, integration, onConfigure }: Props) {
  const qc = useQueryClient();
  const [checks, setChecks] = useState<DiagnoseCheck[] | null>(null);

  const cfg = (integration?.config ?? {}) as Record<string, any>;
  const isActive = !!integration?.is_active;
  const linked = !!cfg.place_id;
  const canReply = !!(cfg.account_id && cfg.location_id);

  const invoke = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('google-reviews-brain', { body });
    if (error) throw error;
    return data as any;
  };

  const fetchNow = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error('Select a branch first');
      return invoke({ action: 'fetch_reviews_places', branch_id: branchId });
    },
    onSuccess: (r: any) => {
      if (r?.reason) toast.error(r.detail ?? `Sync failed: ${r.reason}`);
      else toast.success(`Synced ${r?.fetched ?? 0} reviews · ${r?.rating ?? '—'}★ (${r?.total_ratings ?? 0} ratings)`);
      qc.invalidateQueries({ queryKey: ['integrations'] });
      qc.invalidateQueries({ queryKey: ['gri'] });
      qc.invalidateQueries({ queryKey: ['dashboard-google-reviews'] });
    },
    onError: (e: any) => toast.error(e?.message ?? 'Sync failed'),
  });

  const diagnose = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error('Select a branch first');
      return invoke({ action: 'diagnose', branch_id: branchId });
    },
    onSuccess: (r: any) => setChecks((r?.checks ?? []) as DiagnoseCheck[]),
    onError: (e: any) => toast.error(e?.message ?? 'Checks failed'),
  });

  const steps = [
    { label: 'Listing linked', ok: linked, hint: 'Open Configure → Find my listing and pick this branch on Google.' },
    { label: 'Reading reviews', ok: linked && isActive, hint: 'Enable the integration to sync ratings and recent reviews every 4 hours.' },
    { label: 'Replying from app', ok: canReply, hint: 'Needs Business Profile API access from Google. Until approved, reply with the assisted flow on the Feedback page.' },
  ];

  return (
    <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-indigo-50 p-2 text-indigo-600"><Globe className="h-4 w-4" aria-hidden /></span>
              Google Business Profile
              <Badge className={isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}>
                {isActive ? 'Active' : 'Inactive'}
              </Badge>
            </CardTitle>
            <CardDescription className="mt-1">
              Reads your live Google rating and latest reviews through the Places API — no Google approval needed.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="cursor-pointer rounded-xl" onClick={onConfigure}>
              <Settings className="mr-1.5 h-4 w-4" aria-hidden />
              Configure
            </Button>
            <Button
              size="sm" variant="outline" className="cursor-pointer rounded-xl"
              onClick={() => fetchNow.mutate()} disabled={fetchNow.isPending || !branchId || !linked}
            >
              {fetchNow.isPending
                ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                : <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden />}
              Sync now
            </Button>
            <Button
              size="sm" variant="ghost" className="cursor-pointer rounded-xl"
              onClick={() => diagnose.mutate()} disabled={diagnose.isPending || !branchId}
            >
              <Stethoscope className={`mr-1.5 h-4 w-4 ${diagnose.isPending ? 'animate-pulse' : ''}`} aria-hidden />
              Run checks
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!branchId && (
          <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Select a single branch above — the Google listing is linked per branch.
          </div>
        )}

        {/* Listing summary */}
        <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-slate-50 px-4 py-3">
          <span className="rounded-full bg-white p-2 text-indigo-600 shadow-sm"><MapPin className="h-4 w-4" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">
              {cfg.place_name || (linked ? 'Listing linked' : 'No Google listing linked yet')}
            </p>
            <p className="text-xs text-slate-500">Last synced {fmtWhen(cfg.last_places_sync)}</p>
          </div>
          {cfg.place_rating != null && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-sm font-bold text-amber-700">
              <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden />
              {Number(cfg.place_rating).toFixed(1)}
              <span className="text-xs font-medium text-amber-600">({cfg.place_rating_count ?? 0})</span>
            </span>
          )}
          {cfg.place_uri && (
            <Button asChild size="sm" variant="ghost" className="cursor-pointer">
              <a href={cfg.place_uri} target="_blank" rel="noopener noreferrer" aria-label="Open the Google listing">
                <ExternalLink className="h-4 w-4" aria-hidden />
              </a>
            </Button>
          )}
        </div>

        {/* 3-step tracker */}
        <ol className="grid gap-2 sm:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.label} className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-100">
              <div className="flex items-center gap-2">
                {s.ok
                  ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                  : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />}
                <p className="text-sm font-semibold text-slate-900">{i + 1}. {s.label}</p>
              </div>
              {!s.ok && <p className="mt-1 text-xs leading-relaxed text-slate-500">{s.hint}</p>}
            </li>
          ))}
        </ol>

        {diagnose.isPending && <Skeleton className="h-24 w-full rounded-2xl" />}

        {!diagnose.isPending && checks && (
          <div className="space-y-1.5 rounded-2xl bg-slate-50 p-3">
            {checks.map((c) => (
              <div key={c.key} className="flex items-start gap-2">
                {c.ok
                  ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                  : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />}
                <div className="min-w-0">
                  <p className="text-sm text-slate-800">{c.label}</p>
                  {!c.ok && c.hint && <p className="text-xs leading-relaxed text-slate-500">{c.hint}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
