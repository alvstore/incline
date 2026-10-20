import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ScanFace, Loader2, PencilLine, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { toast } from 'sonner';
import { OUTCOME, REASON, hhmm, isMarked } from './ptAutoAttendanceShared';
import { PtCorrectionRequestDrawer } from './PtCorrectionRequestDrawer';

export type MyBoardRow = {
  id: string;
  member_name: string | null;
  member_first_at: string | null;
  trainer_first_at: string | null;
  arrival_order: string | null;
  gap_minutes: number | null;
  outcome: string;
  match_reason: string | null;
  correction_id: string | null;
  correction_action: string | null;
  correction_status: string | null;
  correction_reason: string | null;
  correction_note: string | null;
  mode: string | null;
};

const CORR: Record<string, string> = {
  pending: 'bg-amber-500/10 text-amber-500 border border-amber-500/20',
  approved: 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20',
  rejected: 'bg-destructive/10 text-destructive border border-destructive/20',
};

export type PtClientLite = { id: string; member?: { profile?: { full_name?: string | null } | null; member_code?: string | null } | null; package?: { name?: string | null } | null };

export function TrainerPtAttendanceCard({ ptClients = [] }: { ptClients?: PtClientLite[] }) {
  const qc = useQueryClient();
  const today = format(new Date(), 'yyyy-MM-dd');
  const [correcting, setCorrecting] = useState<MyBoardRow | null>(null);

  const board = useQuery({
    queryKey: ['pt-auto-attendance', 'mine', today],
    queryFn: async (): Promise<MyBoardRow[]> => {
      const { data, error } = await supabase.rpc('pt_auto_attendance_my_board', { p_date: today });
      if (error) throw error;
      return (data ?? []) as MyBoardRow[];
    },
  });

  useRealtimeInvalidate({
    channel: 'trainer-pt-auto-attendance',
    tables: ['pt_sessions', 'approval_requests'],
    invalidateKeys: [['pt-auto-attendance']],
  });

  const confirm = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('pt_auto_attendance_resolve', { p_log_id: id, p_action: 'confirm', p_note: null });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Session confirmed');
      qc.invalidateQueries({ queryKey: ['pt-auto-attendance'] });
      qc.invalidateQueries({ queryKey: ['trainer-sessions'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = board.data ?? [];
  const norm = (n?: string | null) => (n ?? '').trim().toLowerCase();
  const scanned = new Set(rows.map(r => norm(r.member_name)));
  const waiting = ptClients.filter(c => !scanned.has(norm(c.member?.profile?.full_name ?? c.member?.member_code)));

  return (
    <Card className="rounded-2xl shadow-lg shadow-slate-200/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ScanFace className="h-4 w-4 text-primary" aria-hidden /> Today's PT attendance
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          From gate scans. If something is wrong, request a correction. Your branch manager approves it.
        </p>
      </CardHeader>
      <CardContent>
        {board.isLoading ? (
          <div className="space-y-2">{[0, 1].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : board.isError ? (
          <p className="text-sm text-destructive">Could not load. Please refresh.</p>
        ) : rows.length === 0 && waiting.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">You have no active PT clients.</p>
        ) : (
          <ul className="divide-y divide-border">
            {waiting.map(c => (
              <li key={`w-${c.id}`} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{c.member?.profile?.full_name ?? c.member?.member_code ?? 'Member'}</p>
                  <p className="text-xs text-muted-foreground truncate">{c.package?.name ?? 'PT package'} · Marked automatically when you both scan in</p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground border border-border">
                  <Clock className="h-3 w-3" aria-hidden /> Waiting for scan
                </span>
              </li>
            ))}
            {rows.map(r => {
              const o = OUTCOME[r.outcome] ?? OUTCOME.dismissed;
              const Icon = o.icon;
              const pending = r.correction_status === 'pending';
              return (
                <li key={r.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{r.member_name ?? 'Member'}</p>
                    <p className="text-xs text-muted-foreground">
                      Client in {hhmm(r.member_first_at)} · You {r.match_reason === 'outside_duty' ? 'last seen' : 'in'} {hhmm(r.trainer_first_at)}
                      {r.match_reason && <span> · {REASON[r.match_reason] ?? r.match_reason}</span>}
                    </p>
                    {r.correction_status && (
                      <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs ${CORR[r.correction_status] ?? ''}`}>
                        Correction {r.correction_status}{r.correction_status === 'rejected' && r.correction_note ? `: ${r.correction_note}` : ''}
                      </span>
                    )}
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${o.cls}`}>
                    <Icon className="h-3 w-3" aria-hidden /> {o.label}
                  </span>
                  <div className="flex gap-2">
                    {r.outcome === 'ready_to_confirm' && (
                      <Button size="sm" className="min-h-[44px]" disabled={confirm.isPending}
                        aria-label={`Confirm session for ${r.member_name ?? 'member'}`}
                        onClick={() => confirm.mutate(r.id)}>
                        {confirm.isPending && confirm.variables === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm'}
                      </Button>
                    )}
                    {!pending ? (
                      <Button size="sm" variant="outline" className="min-h-[44px]"
                        aria-label={`Request correction for ${r.member_name ?? 'member'}`}
                        onClick={() => setCorrecting(r)}>
                        <PencilLine className="h-4 w-4 mr-1" /> Correction
                      </Button>
                    ) : (
                      <Badge variant="outline" className="bg-muted text-muted-foreground">Awaiting manager</Badge>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      <PtCorrectionRequestDrawer
        row={correcting}
        defaultAction={correcting && isMarked(correcting.outcome) ? 'undo' : 'mark'}
        onOpenChange={(o) => { if (!o) setCorrecting(null); }}
      />
    </Card>
  );
}
