import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Loader2, Search, CheckCircle2, XCircle, AlertTriangle, Star, RefreshCw,
  Stethoscope, ExternalLink, Copy, ShieldCheck, MapPin,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';


interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  branchId: string;
  branchName?: string;
}

interface PlaceItem {
  place_id: string;
  name: string;
  address: string;
  rating: number | null;
  total_ratings: number | null;
}

interface DiagnoseCheck {
  key: string;
  ok: boolean;
  lane: 'places' | 'business_profile';
  label: string;
  hint?: string;
}

type Row = {
  id: string;
  is_active: boolean;
  config: Record<string, any> | null;
  credentials: Record<string, any> | null;
} | null;

function Chip({ ok, label, warn }: { ok: boolean; label: string; warn?: boolean }) {
  const cls = ok
    ? 'bg-emerald-100 text-emerald-700'
    : warn
      ? 'bg-amber-100 text-amber-700'
      : 'bg-slate-100 text-slate-600';
  const Icon = ok ? CheckCircle2 : warn ? AlertTriangle : XCircle;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </span>
  );
}

export default function GoogleBusinessDrawer({ open, onOpenChange, branchId, branchName }: Props) {
  const qc = useQueryClient();
  const [isActive, setIsActive] = useState(false);
  const [autoFetch, setAutoFetch] = useState(true);
  const [placeId, setPlaceId] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [placesKey, setPlacesKey] = useState('');
  const [placesKeyTouched, setPlacesKeyTouched] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [secretTouched, setSecretTouched] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [results, setResults] = useState<PlaceItem[]>([]);
  const [searching, setSearching] = useState(false);
  
  const [diag, setDiag] = useState<DiagnoseCheck[] | null>(null);
  const [diagRunning, setDiagRunning] = useState(false);

  const { data: row, isLoading } = useQuery<Row>({
    queryKey: ['gbp-settings', branchId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('integration_settings')
        .select('id, is_active, config, credentials')
        .eq('integration_type', 'google_business')
        .eq('provider', 'google_business')
        .eq('branch_id', branchId)
        .maybeSingle();
      if (error) throw error;
      return data as Row;
    },
    enabled: open && !!branchId,
  });

  useEffect(() => {
    if (!open) return;
    const cfg = (row?.config ?? {}) as Record<string, any>;
    const cred = (row?.credentials ?? {}) as Record<string, any>;
    setIsActive(!!row?.is_active);
    setAutoFetch(cfg.auto_fetch_reviews !== 'false');
    setPlaceId(cfg.place_id ?? '');
    setPlaceName(cfg.place_name ?? '');
    setClientId(cred.client_id ?? '');
    setPlacesKey('');
    setPlacesKeyTouched(false);
    setClientSecret('');
    setSecretTouched(false);
    setResults([]);
    setSearchText('');
    setDiag(null);
  }, [row, open]);

  const cfg = (row?.config ?? {}) as Record<string, any>;
  const cred = (row?.credentials ?? {}) as Record<string, any>;
  const hasStoredPlacesKey = !!(cred.places_api_key || cred.api_key);
  const hasOAuth = !!cred.refresh_token;
  const hasLocation = !!(cfg.account_id && cfg.location_id);
  const callbackUrl = `${import.meta.env.VITE_SUPABASE_URL ?? ''}/functions/v1/google-reviews-brain`;

  const invoke = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('google-reviews-brain', { body });
    if (error) throw error;
    return data as any;
  };

  const save = useMutation({
    mutationFn: async () => {
      const nextConfig = {
        ...cfg,
        place_id: placeId.trim() || null,
        place_name: placeName || null,
        auto_fetch_reviews: autoFetch ? 'true' : 'false',
      };
      const nextCreds: Record<string, any> = { ...cred };
      if (placesKeyTouched && placesKey.trim()) nextCreds.places_api_key = placesKey.trim();
      if (clientId.trim()) nextCreds.client_id = clientId.trim();
      if (secretTouched && clientSecret.trim()) nextCreds.client_secret = clientSecret.trim();
      // Re-auth required when the OAuth app changes.
      if ((clientId.trim() && clientId.trim() !== cred.client_id) || (secretTouched && clientSecret.trim())) {
        delete nextCreds.access_token;
        delete nextCreds.refresh_token;
        delete nextCreds.token_expires_at;
      }
      const payload = {
        branch_id: branchId,
        integration_type: 'google_business',
        provider: 'google_business',
        is_active: isActive,
        config: nextConfig,
        credentials: nextCreds,
      };
      if (row?.id) {
        const { error } = await (supabase as any).from('integration_settings').update(payload).eq('id', row.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from('integration_settings').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success('Google Business settings saved');
      qc.invalidateQueries({ queryKey: ['gbp-settings', branchId] });
      qc.invalidateQueries({ queryKey: ['integrations'] });
    },
    onError: (e: any) => toast.error(e?.message ?? 'Save failed'),
  });

  const runSearch = async () => {
    if (searchText.trim().length < 3) {
      toast.error('Type at least 3 characters');
      return;
    }
    setSearching(true);
    setResults([]);
    try {
      const r = await invoke({ action: 'search_places', branch_id: branchId, query: searchText.trim() });
      if (!r?.ok) {
        toast.error(r?.reason ?? 'Search failed');
        return;
      }
      setResults(r.items ?? []);
      if ((r.items ?? []).length === 0) toast.info('No matching Google listing found');
    } catch (e: any) {
      toast.error(e?.message ?? 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const fetchNow = useMutation({
    mutationFn: async () => invoke({ action: 'fetch_reviews_places', branch_id: branchId }),
    onSuccess: (r: any) => {
      if (r?.reason) toast.error(r.detail ?? `Fetch failed: ${r.reason}`);
      else toast.success(`Synced ${r?.fetched ?? 0} reviews · rating ${r?.rating ?? '—'} (${r?.total_ratings ?? 0} ratings)`);
      qc.invalidateQueries({ queryKey: ['gbp-settings', branchId] });
      qc.invalidateQueries({ queryKey: ['gri'] });
      qc.invalidateQueries({ queryKey: ['dashboard-google-reviews'] });
    },
    onError: (e: any) => toast.error(e?.message ?? 'Fetch failed'),
  });

  const runDiagnose = async () => {
    setDiagRunning(true);
    try {
      const r = await invoke({ action: 'diagnose', branch_id: branchId });
      setDiag((r?.checks ?? []) as DiagnoseCheck[]);
    } catch (e: any) {
      toast.error(e?.message ?? 'Diagnostics failed');
    } finally {
      setDiagRunning(false);
    }
  };

  const connectGoogle = async () => {
    try {
      const r = await invoke({ action: 'oauth_start', branch_id: branchId });
      if (!r?.ok) {
        toast.error(r?.reason ?? 'Could not start Google OAuth');
        return;
      }
      window.open(r.auth_url, '_blank', 'noopener');
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not start Google OAuth');
    }
  };

  const laneChecks = useMemo(() => ({
    places: (diag ?? []).filter((c) => c.lane === 'places'),
    gbp: (diag ?? []).filter((c) => c.lane === 'business_profile'),
  }), [diag]);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
          <SheetHeader className="border-b border-slate-100 px-6 py-4">
            <SheetTitle>Google Business Profile</SheetTitle>
            <SheetDescription>
              {branchName ? `${branchName} · ` : ''}Pull Google reviews into the CRM and reply from here.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-9 w-full rounded-xl" />
                <Skeleton className="h-24 w-full rounded-2xl" />
                <Skeleton className="h-40 w-full rounded-2xl" />
              </div>
            ) : (
              <>
                {/* Status strip */}
                <div className="flex flex-wrap gap-2">
                  <Chip ok={hasStoredPlacesKey || placesKeyTouched} warn label="Places key" />
                  <Chip ok={!!placeId} warn label={placeId ? 'Listing linked' : 'Listing not linked'} />
                  <Chip ok={hasOAuth} label={hasOAuth ? 'OAuth connected' : 'OAuth pending'} />
                  <Chip ok={hasLocation} label={hasLocation ? 'Location mapped' : 'Location not mapped'} />
                  {cfg.place_rating != null && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
                      {Number(cfg.place_rating).toFixed(1)} · {cfg.place_rating_count ?? 0} ratings
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                  <div>
                    <Label htmlFor="gbp-active" className="text-sm font-semibold text-slate-900">Enable integration</Label>
                    <p className="text-xs text-slate-500">Turn off to pause all Google review syncing for this branch.</p>
                  </div>
                  <Switch id="gbp-active" checked={isActive} onCheckedChange={setIsActive} />
                </div>

                {/* Step 1 — Places */}
                <section className="space-y-4 rounded-2xl bg-white p-4 shadow-lg shadow-slate-200/50">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 rounded-full bg-indigo-50 p-2 text-indigo-600"><MapPin className="h-4 w-4" aria-hidden /></span>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Step 1 · Quick connect (recommended)</h3>
                      <p className="text-xs leading-relaxed text-slate-500">
                        Uses Google's Places API (New). Read-only — rating, total review count and the 5 most recent
                        reviews. No Google approval needed.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="places-key">Places API key</Label>
                    <Input
                      id="places-key"
                      type="password"
                      autoComplete="new-password"
                      value={placesKeyTouched ? placesKey : ''}
                      onChange={(e) => { setPlacesKey(e.target.value); setPlacesKeyTouched(true); }}
                      placeholder={hasStoredPlacesKey ? '•••••••• (saved — leave blank to keep)' : 'Paste a Google Cloud API key with Places API (New) enabled'}
                    />
                    <p className="text-xs text-slate-500">
                      Google Cloud Console → APIs &amp; Services → Credentials → <strong>Create credentials → API key</strong>,
                      then enable <strong>Places API (New)</strong>. Leave application restrictions as “None” or IP-based —
                      referrer restrictions block server-side calls.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="place-search">Find my listing</Label>
                    <div className="flex gap-2">
                      <Input
                        id="place-search"
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } }}
                        placeholder="The Incline, Sector 14, Udaipur"
                      />
                      <Button type="button" variant="outline" onClick={runSearch} disabled={searching} className="cursor-pointer shrink-0">
                        {searching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
                        <span className="ml-1.5 hidden sm:inline">Search</span>
                      </Button>
                    </div>
                    {results.length > 0 && (
                      <ul className="space-y-1.5">
                        {results.map((p) => (
                          <li key={p.place_id}>
                            <button
                              type="button"
                              onClick={() => { setPlaceId(p.place_id); setPlaceName(p.name); setResults([]); }}
                              className="w-full cursor-pointer rounded-xl border border-slate-100 px-3 py-2 text-left transition-colors duration-150 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-sm font-semibold text-slate-900">{p.name}</span>
                                {p.rating != null && (
                                  <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-amber-600">
                                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
                                    {p.rating} ({p.total_ratings ?? 0})
                                  </span>
                                )}
                              </div>
                              <p className="truncate text-xs text-slate-500">{p.address}</p>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="place-id">Place ID</Label>
                    <Input id="place-id" value={placeId} onChange={(e) => setPlaceId(e.target.value)} placeholder="ChIJ…" className="font-mono text-xs" />
                    {placeName && <p className="text-xs text-slate-500">Linked to <strong>{placeName}</strong></p>}
                  </div>

                  <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                    <Label htmlFor="auto-fetch" className="text-sm text-slate-700">Auto-fetch new reviews (every 4h)</Label>
                    <Switch id="auto-fetch" checked={autoFetch} onCheckedChange={setAutoFetch} />
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full cursor-pointer rounded-xl"
                    onClick={() => fetchNow.mutate()}
                    disabled={fetchNow.isPending || !placeId}
                  >
                    {fetchNow.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="mr-2 h-4 w-4" aria-hidden />}
                    Fetch reviews now
                  </Button>
                </section>

                {/* Step 2 — Business Profile */}
                <section className="space-y-4 rounded-2xl bg-white p-4 shadow-lg shadow-slate-200/50">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 rounded-full bg-emerald-50 p-2 text-emerald-600"><ShieldCheck className="h-4 w-4" aria-hidden /></span>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Step 2 · Full access (optional)</h3>
                      <p className="text-xs leading-relaxed text-slate-500">
                        Needed only to <strong>post replies</strong> and read the full review history. Requires the Business
                        Profile APIs enabled and quota approved by Google.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="client-id">OAuth Client ID</Label>
                    <Input id="client-id" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="123…apps.googleusercontent.com" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="client-secret">OAuth Client Secret</Label>
                    <Input
                      id="client-secret"
                      type="password"
                      autoComplete="new-password"
                      value={secretTouched ? clientSecret : ''}
                      onChange={(e) => { setClientSecret(e.target.value); setSecretTouched(true); }}
                      placeholder={cred.client_secret ? '•••••••• (saved — leave blank to keep)' : 'From Google Auth Platform → Clients'}
                    />
                  </div>

                  <div className="space-y-1.5 rounded-xl bg-indigo-50/60 p-3">
                    <p className="text-xs font-semibold text-slate-700">Authorized redirect URI</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 break-all rounded bg-white px-2 py-1.5 font-mono text-[11px] text-slate-600">{callbackUrl}</code>
                      <Button
                        type="button" size="sm" variant="outline" aria-label="Copy redirect URI" className="cursor-pointer"
                        onClick={() => { navigator.clipboard.writeText(callbackUrl); toast.success('Redirect URI copied'); }}
                      >
                        <Copy className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </div>
                  </div>

                  <Button type="button" variant="outline" className="w-full cursor-pointer rounded-xl" onClick={connectGoogle}>
                    <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden />
                    {hasOAuth ? 'Re-connect Google' : 'Connect Google'}
                  </Button>
                  <p className="text-xs leading-relaxed text-slate-500">
                    Replying from inside the app unlocks only after Google approves Business Profile API quota for your
                    Cloud project. Until then, use <strong>Copy &amp; open on Google</strong> on each review in
                    Feedback &amp; Reviews.
                  </p>

                </section>

                {/* Diagnostics */}
                <section className="space-y-3 rounded-2xl bg-white p-4 shadow-lg shadow-slate-200/50">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900">Diagnostics</h3>
                    <Button type="button" size="sm" variant="outline" className="cursor-pointer rounded-xl" onClick={runDiagnose} disabled={diagRunning}>
                      {diagRunning ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : <Stethoscope className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
                      Run checks
                    </Button>
                  </div>
                  {diagRunning && <Skeleton className="h-24 w-full rounded-xl" />}
                  {!diagRunning && diag && (
                    <div className="space-y-4">
                      {([['Quick connect (Places)', laneChecks.places], ['Full access (Business Profile)', laneChecks.gbp]] as const).map(([title, list]) => (
                        <div key={title} className="space-y-1.5">
                          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</p>
                          {list.map((c) => (
                            <div key={c.key} className="flex items-start gap-2 rounded-xl px-2 py-1.5 hover:bg-slate-50">
                              {c.ok
                                ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                                : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden />}
                              <div className="min-w-0">
                                <p className="text-sm text-slate-800">{c.label}</p>
                                {!c.ok && c.hint && <p className="text-xs leading-relaxed text-slate-500">{c.hint}</p>}
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                  {!diagRunning && !diag && (
                    <p className="text-xs text-slate-500">Run checks to see exactly which Google step is blocking review sync.</p>
                  )}
                </section>

                <Separator />
                <p className="text-xs leading-relaxed text-slate-500">
                  Places API (New) returns at most 5 reviews and cannot post replies — that is a Google limit. Replying
                  unlocks once Business Profile quota is approved in Step 2.
                </p>
              </>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
            <Button variant="ghost" className="cursor-pointer" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="cursor-pointer rounded-xl" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Save settings
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
