import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BellRing, BellOff, Loader2, Send, Share } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { pushSupport, pushEnabled, pushPublicKey, enablePush, disablePush, testPush } from '@/services/webPushService';
import { toast } from 'sonner';

export function BrowserNotifications({ branchId }: { branchId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const support = pushSupport();
  const queryKey = ['browser-push', user?.id, branchId];
  const { data: enabled = false, isLoading, isError } = useQuery({ queryKey, queryFn: () => user ? pushEnabled(user.id, branchId) : Promise.resolve(false), enabled: Boolean(user && branchId && support === 'supported'), refetchOnWindowFocus: true });
  const key = useQuery({ queryKey: ['browser-push-key', user?.id], queryFn: pushPublicKey, enabled: Boolean(user && support === 'supported'), staleTime: Infinity });
  const update = useMutation({
    mutationFn: async () => {
      if (enabled) return disablePush();
      if (!key.data) throw new Error('Notifications are not ready. Please retry.');
      return enablePush(branchId, key.data);
    },
    onSuccess: () => { setError(null); qc.invalidateQueries({ queryKey }); toast.success(enabled ? 'Browser notifications turned off' : 'Browser notifications enabled'); },
    onError: (e: Error) => setError(e.message),
  });
  const test = useMutation({ mutationFn: () => testPush(branchId), onSuccess: () => toast.success('Test queued. Check your device notifications.'), onError: (e: Error) => setError(e.message) });
  return (
    <Card className="min-w-0 rounded-2xl border-border bg-card">
      <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><BellRing className="h-5 w-5" /></div>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-foreground">Browser notifications</h3><Badge variant="secondary">{enabled ? 'On this device' : 'Opt-in'}</Badge></div>
            <p className="text-sm text-muted-foreground">{support === 'install' ? 'On iPhone, add Incline to your Home Screen, then open it from that icon.' : support === 'blocked' ? 'Notifications are blocked. Allow them in your browser’s site settings.' : support === 'unsupported' ? 'Browser notifications are unavailable on this browser.' : 'Booking updates and reminders. No WhatsApp or SMS needed.'}</p>
            {(error || isError || key.isError) && <p role="alert" className="text-sm text-destructive">{error || 'Could not load notification settings. Please retry.'}</p>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {support === 'supported' && <>
            <Button variant={enabled ? 'outline' : 'default'} className="min-h-11 gap-2" onClick={() => update.mutate()} disabled={update.isPending || isLoading || (!enabled && !key.data)}>{update.isPending || isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : enabled ? <BellOff className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}{enabled ? 'Turn off' : 'Enable notifications'}</Button>
            {enabled && <Button variant="outline" className="min-h-11 gap-2" disabled={test.isPending || update.isPending} onClick={() => test.mutate()}>{test.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Send test</Button>}
            {(isError || key.isError) && <Button variant="outline" onClick={() => { qc.invalidateQueries({ queryKey }); key.refetch(); }}>Retry</Button>}
          </>}
          {support === 'install' && <Share aria-hidden className="h-5 w-5 text-primary" />}
        </div>
      </CardContent>
    </Card>
  );
}