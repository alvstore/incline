import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { ScanFace, Settings2, Undo2, Loader2, MessageSquareWarning } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { can } from '@/lib/auth/permissions';
import type { RoleLike } from '@/lib/auth/permissions';
import { toast } from 'sonner';
import { OUTCOME, REASON, hhmm, type AutoMode } from './ptAutoAttendanceShared';

type BoardRow = {
  id: string;
  member_name: string | null;
  trainer_name: string | null;
  member_first_at: string | null;
  trainer_first_at: string | null;
  arrival_order: string | null;
  gap_minutes: number | null;
  outcome: string;
  match_reason: string | null;
  manager_alert_kind: string | null;
  correction_id: string | null;
  correction_action: string | null;
  correction_status: string | null;
  correction_reason: string | null;
};

type AutoConfig = {
  enabled: boolean;
  mode: AutoMode;
  window_minutes: number;
  late_alert_minutes: number;
  notify_manager: boolean;
};

const MODE_LABEL: Record<AutoMode, string> = { auto: 'Automatic', review: 'Review first', manual: 'Manual only' };

export function PtAutoAttendancePanel({
  branchId, dayISO, roles,
}: { branchId: string | null; dayISO: string; roles: RoleLike[] }) {
  const qc = useQueryClient();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const enabled = !!branchId && branchId !== 'all';
  const isManager = can.manageSettings(roles) || roles.some(r => (typeof r === 'string' ? r : r?.role) === 'manager');

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
      const c = data as unknown as AutoConfig;
      return { ...c, mode: c.enabled === false ? 'manual' : (c.mode ?? 'auto') };
    },
  });

  useRealtimeInvalidate({
    channel: 'pt-auto-attendance',
    tables: ['pt_sessions', 'approval_requests'],
    invalidateKeys: [['pt-auto-attendance']],
    enabled,
  });

  const invalidate = () => {
    ['pt-auto-attendance', 'pt-roster-sessions', 'pt-attendance-history', 'member-pt-packages', 'approval-queue']
      .forEach(k => qc.invalidateQueries({ queryKey: [k] }));
  };

  const resolve = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'confirm' | 'dismiss' | 'reverse' }) => {
      const { error } = await supabase.rpc('pt_auto_attendance_resolve', { p_log_id: id, p_action: action, p_note: null });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.action === 'confirm' ? 'Session marked' : v.action === 'reverse' ? 'Session undone' : 'Marked as not trained');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decide = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) => {
      const { error } = await supabase.rpc('pt_attendance_decide_correction', { p_correction_id: id, p_decision: decision, p_note: null });
      if (error) throw error;
    },
    onSuccess: (_d, v) => { toast.success(v.decision === 'approve' ? 'Correction approved' : 'Correction rejected'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!enabled) return null;
  const rows = board.data ?? [];
  const mode: AutoMode = config.data?.mode ?? 'auto';
  const windowMin = config.data?.window_minutes ?? 30;
  const pending = rows.filter(r => r.correction_status === 'pending').length;

  return (
    <Card className="rounded-2xl shadow-lg shadow-slate-200/50">
      <CardHeader className="pb-3 flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base flex flex-wrap items-center gap-2">
            <ScanFace className="h-4 w-4 text-primary" aria-hidden />
            Automatic PT attendance
            <Badge variant="outline" className={mode === 'manual' ? 'bg-muted text-muted-foreground' : 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'}>
              {MODE_LABEL[mode]}
            </Badge>
            {pending > 0 && (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                {pending} correction{pending > 1 ? 's' : ''} pending
              </Badge>
            )}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            A session counts when the client arrives while their trainer is on duty, or within {windowMin} minutes of the trainer. Managers are alerted when the trainer comes after the client.
          </p>
        </div>
        {isManager && (
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
              const busy = (resolve.isPending && resolve.variables?.id === r.id)
                || (decide.isPending && decide.variables?.id === r.correction_id);
              return (
                <li key={r.id} className="py-3 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {r.member_name ?? 'Member'} <span className="text-muted-foreground font-normal">with {r.trainer_name ?? 'Trainer'}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Client in {hhmm(r.member_first_at)} · Trainer {r.match_reason === 'outside_duty' ? 'last seen' : 'in'} {hhmm(r.trainer_first_at)}
                        {r.match_reason && <span> · {REASON[r.match_reason] ?? r.match_reason}</span>}
                        {late && r.match_reason !== 'trainer_very_late' && <span className="text-amber-600"> · trainer {r.gap_minutes} min after client</span>}
                        {r.manager_alert_kind && <span> · manager alerted</span>}
                      </p>
                    </div>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${o.cls}`}>
                      <Icon className="h-3 w-3" aria-hidden /> {o.label}
                    </span>
                    <div className="flex gap-2">
                      {['needs_review', 'awaiting_trainer', 'trainer_no_show', 'ready_to_confirm', 'dismissed', 'reversed'].includes(r.outcome) && (
                        <Button size="sm" className="min-h-[44px]" disabled={busy}
                          aria-label={`Mark PT session for ${r.member_name ?? 'member'}`}
                          onClick={() => resolve.mutate({ id: r.id, action: 'confirm' })}>
                          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Mark session'}
                        </Button>
                      )}
                      {['needs_review', 'awaiting_trainer', 'trainer_no_show', 'ready_to_confirm'].includes(r.outcome) && (
                        <Button size="sm" variant="outline" className="min-h-[44px]" disabled={busy}
                          aria-label={`Not trained: ${r.member_name ?? 'member'}`}
                          onClick={() => resolve.mutate({ id: r.id, action: 'dismiss' })}>
                          Not trained
                        </Button>
                      )}
                      {['auto_logged', 'confirmed'].includes(r.outcome) && (
                        <Button size="sm" variant="ghost" className="min-h-[44px]" disabled={busy}
                          aria-label={`Undo PT session for ${r.member_name ?? 'member'}`}
                          onClick={() => resolve.mutate({ id: r.id, action: 'reverse' })}>
                          <Undo2 className="h-4 w-4 mr-1" /> Undo
                        </Button>
                      )}
                    </div>
                  </div>
                  {r.correction_status === 'pending' && r.correction_id && (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                      <MessageSquareWarning className="h-4 w-4 text-amber-600 shrink-0" aria-hidden />
                      <p className="text-xs flex-1">
                        Trainer asks to <strong>{r.correction_action === 'mark' ? 'mark this session' : 'undo this session'}</strong>: {r.correction_reason}
                      </p>
                      {isManager && (
                        <div className="flex gap-2">
                          <Button size="sm" className="min-h-[44px]" disabled={busy}
                            onClick={() => decide.mutate({ id: r.correction_id!, decision: 'approve' })}>Approve</Button>
                          <Button size="sm" variant="outline" className="min-h-[44px]" disabled={busy}
                            onClick={() => decide.mutate({ id: r.correction_id!, decision: 'reject' })}>Reject</Button>
                        </div>
                      )}
                    </div>
                  )}
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
          <SheetDescription>Applies to this branch. Manual marking keeps working in every mode.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto space-y-5 py-4">
          <div className="space-y-2">
            <Label>Mode</Label>
            <RadioGroup value={cfg.mode} onValueChange={(v) => setCfg({ ...cfg, mode: v as AutoMode })} className="space-y-2">
              {([
                ['auto', 'Automatic', 'Sessions are marked by themselves from gate scans.'],
                ['review', 'Review first', 'Matches wait as "Ready to confirm" for the trainer or desk to tap.'],
                ['manual', 'Manual only', 'Nothing automatic. Use Mark Present as before.'],
              ] as const).map(([v, l, d]) => (
                <label key={v} htmlFor={`mode-${v}`} className="flex items-start gap-3 rounded-xl border border-border p-3 cursor-pointer hover:bg-secondary">
                  <RadioGroupItem id={`mode-${v}`} value={v} className="mt-0.5" />
                  <span><span className="text-sm font-medium block">{l}</span><span className="text-xs text-muted-foreground">{d}</span></span>
                </label>
              ))}
            </RadioGroup>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pt-auto-window">Arrival window around trainer (minutes)</Label>
            <Input id="pt-auto-window" type="number" min={5} max={180} value={cfg.window_minutes}
              onChange={(e) => setCfg({ ...cfg, window_minutes: Number(e.target.value) })} />
            <p className="text-xs text-muted-foreground">Also added to the end of the trainer's shift.</p>
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
