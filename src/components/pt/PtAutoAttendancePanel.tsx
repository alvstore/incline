import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import {
  ScanFace, Settings2, CheckCircle2, Clock, AlertTriangle, Undo2, XCircle, Loader2,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { can } from '@/lib/auth/permissions';
import type { RoleLike } from '@/lib/auth/permissions';
import { toast } from 'sonner';

type BoardRow = {
  id: string;
  member_id: string;
  member_name: string | null;
  member_code: string | null;
  trainer_id: string;
  trainer_name: string | null;
  member_first_at: string | null;
  trainer_first_at: string | null;
  arrival_order: string | null;
  gap_minutes: number | null;
  outcome: string;
  pt_session_id: string | null;
  manager_alert_kind: string | null;
  resolution_note: string | null;
};

type AutoConfig = {
  enabled: boolean;
  window_minutes: number;
  late_alert_minutes: number;
  notify_manager: boolean;
};

const OUTCOME: Record<string, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  auto_logged: { label: 'Auto-marked', cls: 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20', icon: CheckCircle2 },
  confirmed: { label: 'Confirmed', cls: 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20', icon: CheckCircle2 },
  awaiting_trainer: { label: 'Waiting for trainer', cls: 'bg-amber-500/10 text-amber-600 border border-amber-500/20', icon: Clock },
  needs_review: { label: 'Trainer very late — review', cls: 'bg-destructive/10 text-destructive border border-destructive/20', icon: AlertTriangle },
  trainer_no_show: { label: 'Trainer did not come', cls: 'bg-destructive/10 text-destructive border border-destructive/20', icon: XCircle },
  dismissed: { label: 'Dismissed', cls: 'bg-muted text-muted-foreground border border-border', icon: XCircle },
  reversed: { label: 'Reversed', cls: 'bg-muted text-muted-foreground border border-border', icon: Undo2 },
};

const t = (iso: string | null) => (iso ? format(new Date(iso), 'HH:mm') : '—');

export function PtAutoAttendancePanel({
  branchId, dayISO, roles,
}: { branchId: string | null; dayISO: string; roles: RoleLike[] }) {
  const qc = useQueryClient();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const enabled = !!branchId && branchId !== 'all';

  const board = useQuery({
    queryKey: ['pt-auto-attendance', branchId, dayISO],
    enabled,
    queryFn: async (): Promise<BoardRow[]> => {
      const { data, error } = await supabase.rpc('pt_auto_attendance_board', { p_branch_id: branchId!, p_date: dayISO });
      if (error) throw error;
      return (data ?? []) as BoardRow[];
    },
  });

  const config = useQuery({
    queryKey: ['pt-auto-attendance-config', branchId],
    enabled,
    queryFn: async (): Promise<AutoConfig> => {
      const { data, error } = await supabase.rpc('pt_auto_attendance_config', { p_branch_id: branchId! });
      if (error) throw error;
      return data as unknown as AutoConfig;
    },
  });

  useRealtimeInvalidate({
    channel: 'pt-auto-attendance',
    tables: ['pt_sessions'],
    invalidateKeys: [['pt-auto-attendance']],
    enabled,
  });

  const resolve = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'confirm' | 'dismiss' | 'reverse' }) => {
      const { error } = await supabase.rpc('pt_auto_attendance_resolve', { p_log_id: id, p_action: action, p_note: null });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.action === 'confirm' ? 'Session marked' : v.action === 'reverse' ? 'Session reversed' : 'Dismissed');
      qc.invalidateQueries({ queryKey: ['pt-auto-attendance'] });
      qc.invalidateQueries({ queryKey: ['pt-roster-sessions'] });
      qc.invalidateQueries({ queryKey: ['pt-attendance-history'] });
      qc.invalidateQueries({ queryKey: ['member-pt-packages'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!enabled) return null;
  const rows = board.data ?? [];
  const isOff = config.data && !config.data.enabled;
  const windowMin = config.data?.window_minutes ?? 30;

  return (
    <Card className="rounded-2xl shadow-lg shadow-slate-200/50">
      <CardHeader className="pb-3 flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <ScanFace className="h-4 w-4 text-primary" aria-hidden />
            Automatic PT attendance
            {isOff ? (
              <Badge variant="outline" className="bg-muted text-muted-foreground">Off</Badge>
            ) : (
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">On</Badge>
            )}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Marked when a client and their trainer both scan in within {windowMin} minutes. Managers are alerted when the trainer comes after the client.
          </p>
        </div>
        {can.manageSettings(roles) && (
          <Button variant="outline" size="sm" className="min-h-[44px]" onClick={() => setSettingsOpen(true)} aria-label="Automatic PT attendance settings">
            <Settings2 className="h-4 w-4 mr-1" /> Settings
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {board.isLoading ? (
          <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : board.isError ? (
          <p className="text-sm text-destructive">Could not load automatic attendance. Please refresh.</p>
        ) : rows.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            <ScanFace className="h-8 w-8 mx-auto mb-2 opacity-50" aria-hidden />
            No PT clients have scanned in yet for this day.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map(r => {
              const o = OUTCOME[r.outcome] ?? OUTCOME.dismissed;
              const Icon = o.icon;
              const late = r.arrival_order === 'member_first' && (r.gap_minutes ?? 0) > 0;
              const busy = resolve.isPending && resolve.variables?.id === r.id;
              return (
                <li key={r.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {r.member_name ?? 'Member'} <span className="text-muted-foreground font-normal">with {r.trainer_name ?? 'Trainer'}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Client in {t(r.member_first_at)} · Trainer in {t(r.trainer_first_at)}
                      {late && <span className="text-amber-600"> · trainer {r.gap_minutes} min after client</span>}
                      {r.manager_alert_kind && <span> · manager alerted</span>}
                    </p>
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${o.cls}`}>
                    <Icon className="h-3 w-3" aria-hidden /> {o.label}
                  </span>
                  <div className="flex gap-2">
                    {['needs_review', 'awaiting_trainer', 'trainer_no_show'].includes(r.outcome) && (
                      <>
                        <Button size="sm" className="min-h-[44px]" disabled={busy}
                          aria-label={`Mark PT session for ${r.member_name ?? 'member'}`}
                          onClick={() => resolve.mutate({ id: r.id, action: 'confirm' })}>
                          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Mark session'}
                        </Button>
                        <Button size="sm" variant="outline" className="min-h-[44px]" disabled={busy}
                          aria-label={`Dismiss for ${r.member_name ?? 'member'}`}
                          onClick={() => resolve.mutate({ id: r.id, action: 'dismiss' })}>
                          Dismiss
                        </Button>
                      </>
                    )}
                    {['auto_logged', 'confirmed'].includes(r.outcome) && (
                      <Button size="sm" variant="ghost" className="min-h-[44px]" disabled={busy}
                        aria-label={`Reverse PT session for ${r.member_name ?? 'member'}`}
                        onClick={() => resolve.mutate({ id: r.id, action: 'reverse' })}>
                        <Undo2 className="h-4 w-4 mr-1" /> Undo
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      {config.data && (
        <AutoSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} branchId={branchId!} initial={config.data} />
      )}
    </Card>
  );
}

function AutoSettingsSheet({
  open, onOpenChange, branchId, initial,
}: { open: boolean; onOpenChange: (o: boolean) => void; branchId: string; initial: AutoConfig }) {
  const qc = useQueryClient();
  const [cfg, setCfg] = useState<AutoConfig>(initial);
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('pt_auto_attendance_set_config', { p_branch_id: branchId, p_config: cfg });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Settings saved');
      qc.invalidateQueries({ queryKey: ['pt-auto-attendance-config'] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Sheet open={open} onOpenChange={(o) => { if (o) setCfg(initial); onOpenChange(o); }}>
      <SheetContent className="sm:max-w-lg flex flex-col">
        <SheetHeader>
          <SheetTitle>Automatic PT attendance</SheetTitle>
          <SheetDescription>Applies to this branch. Manual marking keeps working either way.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto space-y-5 py-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="pt-auto-enabled">Mark sessions automatically</Label>
            <Switch id="pt-auto-enabled" checked={cfg.enabled} onCheckedChange={(v) => setCfg({ ...cfg, enabled: v })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pt-auto-window">Both must scan in within (minutes)</Label>
            <Input id="pt-auto-window" type="number" min={5} max={180} value={cfg.window_minutes}
              onChange={(e) => setCfg({ ...cfg, window_minutes: Number(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pt-auto-late">Alert manager when trainer is late by (minutes)</Label>
            <Input id="pt-auto-late" type="number" min={0} max={120} value={cfg.late_alert_minutes}
              onChange={(e) => setCfg({ ...cfg, late_alert_minutes: Number(e.target.value) })} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="pt-auto-notify">Notify manager</Label>
            <Switch id="pt-auto-notify" checked={cfg.notify_manager} onCheckedChange={(v) => setCfg({ ...cfg, notify_manager: v })} />
          </div>
        </div>
        <SheetFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
