import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Loader2, ShieldCheck } from 'lucide-react';

type AuthorizationDetails = {
  client?: { name?: string | null } | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
};

type OAuthNamespace = {
  getAuthorizationDetails: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
};

function oauth(): OAuthNamespace {
  return (supabase.auth as unknown as { oauth: OAuthNamespace }).oauth;
}

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get('authorization_id') ?? '';
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError('Missing authorization_id');
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = '/auth?next=' + encodeURIComponent(next);
        return;
      }
      const { data, error: detailsError } = await oauth().getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (detailsError) {
        setError(detailsError.message);
        return;
      }
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    const { data, error: decisionError } = approve
      ? await oauth().approveAuthorization(authorizationId)
      : await oauth().denyAuthorization(authorizationId);
    if (decisionError) {
      setBusy(false);
      setError(decisionError.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError('No redirect returned by the authorization server.');
      return;
    }
    window.location.href = target;
  }

  const clientName = details?.client?.name ?? 'an app';

  return (
    <main className="min-h-dvh flex items-center justify-center bg-muted px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-card p-6 sm:p-8 shadow-lg shadow-slate-200/50 space-y-5">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-primary/10 p-2 text-primary">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </span>
          <h1 className="text-xl font-bold text-foreground">Authorize access</h1>
        </div>

        {error ? (
          <p className="text-sm text-destructive">Could not load this authorization request: {error}</p>
        ) : !details ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
          </p>
        ) : (
          <>
            <div className="space-y-2">
              <p className="text-sm text-foreground font-medium">
                Connect {clientName} to your Incline account
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {clientName} will be able to use Incline tools as you — reading members, dues, attendance,
                leads and tasks, and creating leads. It only sees what your own account can see.
              </p>
            </div>
            <div className="flex gap-3 pt-1">
              <Button
                type="button"
                variant="outline"
                className="flex-1 rounded-xl"
                disabled={busy}
                onClick={() => decide(false)}
              >
                Deny
              </Button>
              <Button
                type="button"
                className="flex-1 rounded-xl"
                disabled={busy}
                onClick={() => decide(true)}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : 'Approve'}
              </Button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
