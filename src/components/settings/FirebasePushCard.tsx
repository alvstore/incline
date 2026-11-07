import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { CheckCircle2, Loader2, Smartphone, Upload, XCircle, FlaskConical } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { track } from '@/lib/analytics';

interface PushSettings {
  project_id: string | null; client_email: string | null; enabled: boolean;
  last_test_ok: boolean | null; last_test_at: string | null; last_test_error: string | null; key_uploaded_at: string | null;
}
interface PushStatus { settings: PushSettings | null; counts: { phones: number; browsers: number; sent24h: number; failed24h: number } }

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('fcm-admin', { body });
  if (error) {
    let msg = error.message;
    if (error instanceof FunctionsHttpError) { try { msg = (await error.context.json()).error ?? msg; } catch { /* keep */ } }
    throw new Error(msg);
  }
  return data as T;
}
const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export default function FirebasePushCard() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const status = useQuery({ queryKey: ['fcm-admin-status'], queryFn: () => call<PushStatus>({ action: 'status' }) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['fcm-admin-status'] });

  const save = useMutation({
    mutationFn: (text: string) => call<{ project_id: string }>({ action: 'save', service_account: text }),
    onSuccess: () => { track('push_settings_saved'); toast.success('Service account saved. Run a test next.'); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const test = useMutation({
    mutationFn: () => call<{ ok: boolean; error: string | null }>({ action: 'test' }),
    onSuccess: (r) => { track(r.ok ? 'push_test_succeeded' : 'push_test_failed'); r.ok ? toast.success('Firebase connection works') : toast.error(r.error ?? 'Test failed'); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => call({ action: 'set_enabled', enabled }),
    onSuccess: (_d, enabled) => { toast.success(enabled ? 'Phone push switched on' : 'Phone push switched off'); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const onFile = async (f?: File) => {
    if (!f) return;
    if (f.size > 20000) { toast.error('File is too large for a service account'); return; }
    setFileName(f.name);
    save.mutate(await f.text());
    if (fileRef.current) fileRef.current.value = '';
  };

  if (status.isLoading) return <Card className="rounded-xl"><CardContent className="space-y-3 p-6"><Skeleton className="h-6 w-48" /><Skeleton className="h-20 w-full" /></CardContent></Card>;
  if (status.isError) return <Card className="rounded-xl"><CardContent className="p-6 text-sm text-destructive">Could not load push settings. <Button variant="link" onClick={refresh}>Retry</Button></CardContent></Card>;

  const s = status.data?.settings;
  const c = status.data?.counts;
  const configured = !!s?.project_id && !!s.key_uploaded_at;

  return (
    <Card className="rounded-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Smartphone className="h-5 w-5" aria-hidden />Phone push (Firebase)</CardTitle>
        <CardDescription>Sends app notifications to the Flutter apps. Upload the service account file from Firebase Console → Project settings → Service accounts → Generate new private key.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[['Phones', c?.phones], ['Browsers', c?.browsers], ['Sent (24h)', c?.sent24h], ['Failed (24h)', c?.failed24h]].map(([l, v]) => (
            <div key={l as string} className="rounded-xl bg-muted p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{l}</p>
              <p className="text-2xl font-bold tabular-nums">{v ?? 0}</p>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <Label htmlFor="fcm-sa-file">Service account file (JSON)</Label>
          <input id="fcm-sa-file" ref={fileRef} type="file" accept="application/json,.json" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={save.isPending} className="min-h-11">
              {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Upload className="mr-2 h-4 w-4" aria-hidden />}
              {configured ? 'Replace file' : 'Upload file'}
            </Button>
            <span className="text-sm text-muted-foreground" aria-live="polite">{save.isPending ? `Saving ${fileName}…` : configured ? `Key saved · uploaded on ${fmt(s?.key_uploaded_at ?? null)}` : 'No key saved yet'}</span>
          </div>
          {configured && <p className="text-sm text-muted-foreground">Project <span className="font-medium text-foreground">{s?.project_id}</span> · {s?.client_email}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => test.mutate()} disabled={!configured || test.isPending} className="min-h-11">
            {test.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <FlaskConical className="mr-2 h-4 w-4" aria-hidden />}Test connection
          </Button>
          <span className="flex items-center gap-1.5 text-sm" aria-live="polite">
            {s?.last_test_ok === true && <><CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />Test passed · {fmt(s.last_test_at)}</>}
            {s?.last_test_ok === false && <><XCircle className="h-4 w-4 text-destructive" aria-hidden />Test failed: {s.last_test_error}</>}
            {s?.last_test_ok == null && configured && <span className="text-muted-foreground">Not tested yet</span>}
          </span>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-muted p-4">
          <div>
            <Label htmlFor="fcm-enabled" className="font-medium">Send phone push</Label>
            <p className="text-sm text-muted-foreground">{s?.enabled ? 'On — phone alerts go out directly through Firebase.' : 'Off. Needs a passing test first.'}</p>
          </div>
          <Switch id="fcm-enabled" checked={!!s?.enabled} disabled={!s?.last_test_ok || toggle.isPending} onCheckedChange={(v) => toggle.mutate(v)} aria-label="Send phone push" />
        </div>
      </CardContent>
    </Card>
  );
}
