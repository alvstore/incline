import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Download, Search, Sparkles, UserCheck } from 'lucide-react';
import { AssignTrainerDrawer } from '@/components/members/AssignTrainerDrawer';
import { notifyTrainerAssignment } from '@/lib/comms/trainerAssignmentNotify';
import { invalidateMembersData } from '@/lib/memberInvalidation';
import { usePageEntrance, useRowsEntrance } from '@/components/motion/pageMotion';
import { describeWindow, fmtMin, rankTrainers, usualWindow, type MatchMemberRow, type MatchTrainerRow, type TrainerFit } from '@/lib/trainers/trainerMatch';

const CONF_LABEL = { strong: 'Strong', some: 'Some', none: 'Not enough' } as const;
const FIT_VARIANT: Record<TrainerFit['label'], string> = {
  'Best match': 'bg-success/10 text-success', Good: 'bg-info/10 text-info',
  'Not on shift': 'bg-muted text-muted-foreground', 'At capacity': 'bg-destructive/10 text-destructive',
};

export function useTrainerMatchEnabled() {
  const { data } = useQuery({
    queryKey: ['flag', 'trainer_match_v1'], staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from('settings').select('value').eq('key', 'trainer_match_v1').is('branch_id', null).maybeSingle();
      const v = data?.value as any;
      return v === true || v?.enabled === true;
    },
  });
  return !!data;
}

export function UnassignedMembersPanel({ branchId }: { branchId: string }) {
  const qc = useQueryClient();
  const scope = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState('');
  const [part, setPart] = useState('all');
  const [conf, setConf] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [drawer, setDrawer] = useState<{ id: string; name: string } | null>(null);
  usePageEntrance(scope);

  const { data, isLoading, error } = useQuery({
    queryKey: ['trainer-match', branchId], enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('trainer_match_data' as any, { p_branch_id: branchId, p_days: 60 });
      if (error) throw error;
      return data as unknown as { members: MatchMemberRow[]; trainers: MatchTrainerRow[] };
    },
  });

  const rows = useMemo(() => (data?.members ?? []).map((m) => {
    const w = usualWindow(m);
    return { m, w, fits: rankTrainers(w, data?.trainers ?? []) };
  }), [data]);

  const filtered = rows.filter(({ m, w }) =>
    (part === 'all' || w.part === part) && (conf === 'all' || w.confidence === conf) &&
    (!q || `${m.name} ${m.member_code} ${m.phone}`.toLowerCase().includes(q.toLowerCase())));
  useRowsEntrance(tableRef, `${part}|${conf}|${q}|${filtered.length}`);

  const assign = useMutation({
    mutationFn: async (items: { member_id: string; trainer_id: string }[]) => {
      const { data, error } = await supabase.rpc('bulk_assign_trainers' as any, { p_assignments: items });
      if (error) throw error;
      return { res: data as any, items };
    },
    onSuccess: ({ res, items }) => {
      const failed = new Set<string>(res?.failed ?? []);
      items.filter((i) => !failed.has(i.member_id)).forEach((i) =>
        void notifyTrainerAssignment({ memberId: i.member_id, trainerId: i.trainer_id, branchId, kind: 'general' }));
      toast.success(`${res?.assigned ?? 0} assigned · trainers and members notified${failed.size ? ` · ${failed.size} skipped` : ''}`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['trainer-match'] });
      invalidateMembersData(qc);
    },
    onError: (e: any) => toast.error(e.message || 'Could not assign'),
  });

  const bulkItems = filtered.filter(({ m, fits }) => selected.has(m.member_id) && fits[0] && !fits[0].atCapacity && fits[0].overlap > 0)
    .map(({ m, fits }) => ({ member_id: m.member_id, trainer_id: fits[0].trainer.trainer_id }));

  const downloadCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Member', 'Code', 'Phone', 'Plan', 'Visits (60d)', 'Usual time', 'Time of day', 'Confidence', 'Best trainer', 'Overlap %', 'Second option', 'Last visit'];
    const lines = filtered.map(({ m, w, fits }) => [m.name, m.member_code, m.phone, m.plan_name, m.visits, describeWindow(w), w.part, CONF_LABEL[w.confidence],
      fits[0]?.trainer.name, fits[0] ? Math.round(fits[0].overlap * 100) : '', fits[1]?.trainer.name, m.last_visit].map(esc).join(','));
    const blob = new Blob(['\ufeff' + [head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `unassigned-members-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!branchId) return <Card className="rounded-2xl"><CardContent className="py-10 text-center text-muted-foreground">Pick a branch to see members without a trainer.</CardContent></Card>;
  if (error) return <Card className="rounded-2xl"><CardContent className="py-10 text-center text-destructive">{(error as any).message}</CardContent></Card>;

  const allChecked = filtered.length > 0 && filtered.every((r) => selected.has(r.m.member_id));

  return (
    <div ref={scope} className="space-y-4">
      {/* Trainer load strip */}
      <div data-anim="card" className="flex gap-3 overflow-x-auto pb-1">
        {(data?.trainers ?? []).map((t) => {
          const today = new Date().getDay();
          const s = t.shifts.find((x) => x.weekday === today);
          const hrs = s && !s.off ? [s.ms && `${s.ms.slice(0, 5)}–${s.me?.slice(0, 5)}`, s.es && `${s.es.slice(0, 5)}–${s.ee?.slice(0, 5)}`].filter(Boolean).join(', ') : 'Off today';
          const u = Math.min(100, Math.round((t.clients / Math.max(1, t.max_clients)) * 100));
          return (
            <Card key={t.trainer_id} className="min-w-[190px] rounded-2xl shadow-sm">
              <CardContent className="p-4 space-y-2">
                <p className="font-semibold text-sm truncate">{t.name}</p>
                <p className="text-xs text-muted-foreground">{hrs}</p>
                <Progress value={u} className="h-1.5" />
                <p className="text-xs text-muted-foreground">{t.clients}/{t.max_clients} clients</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card data-anim="card" className="rounded-2xl shadow-sm">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, code or phone" className="pl-9 rounded-xl" aria-label="Search members" />
            </div>
            <Select value={part} onValueChange={setPart}>
              <SelectTrigger className="w-[150px] rounded-xl" aria-label="Time of day"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any time</SelectItem><SelectItem value="Morning">Morning</SelectItem>
                <SelectItem value="Afternoon">Afternoon</SelectItem><SelectItem value="Evening">Evening</SelectItem><SelectItem value="Unknown">No visits</SelectItem>
              </SelectContent>
            </Select>
            <Select value={conf} onValueChange={setConf}>
              <SelectTrigger className="w-[160px] rounded-xl" aria-label="Data confidence"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any confidence</SelectItem><SelectItem value="strong">Strong (8+)</SelectItem>
                <SelectItem value="some">Some (3–7)</SelectItem><SelectItem value="none">Not enough</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" className="rounded-xl gap-2" onClick={downloadCsv} disabled={!filtered.length}><Download className="h-4 w-4" />Download</Button>
            <Button className="rounded-xl gap-2" disabled={!bulkItems.length || assign.isPending} onClick={() => setConfirmOpen(true)}>
              <Sparkles className="h-4 w-4" />Assign suggested ({bulkItems.length})
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">{isLoading ? 'Working out usual visit times…' : `${filtered.length} of ${rows.length} members with an active plan have no trainer`}</p>

          <div ref={tableRef} className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="p-2 w-8"><Checkbox aria-label="Select all" checked={allChecked} onCheckedChange={(v) => setSelected(v ? new Set(filtered.map((r) => r.m.member_id)) : new Set())} /></th>
                  <th className="p-2">Member</th><th className="p-2">Usual time</th><th className="p-2">Visits</th>
                  <th className="p-2">Best trainer</th><th className="p-2">Second option</th><th className="p-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ m, w, fits }) => {
                  const best = fits[0], second = fits[1];
                  return (
                    <tr key={m.member_id} data-anim="row" className="border-b border-border/50 hover:bg-muted/40">
                      <td className="p-2"><Checkbox aria-label={`Select ${m.name}`} checked={selected.has(m.member_id)} onCheckedChange={(v) => setSelected((s) => { const n = new Set(s); v ? n.add(m.member_id) : n.delete(m.member_id); return n; })} /></td>
                      <td className="p-2"><p className="font-medium">{m.name ?? 'Member'}</p><p className="text-xs text-muted-foreground">{m.member_code} · {m.plan_name ?? 'Plan'}</p></td>
                      <td className="p-2"><p>{describeWindow(w)}</p><p className="text-xs text-muted-foreground">{w.part}</p></td>
                      <td className="p-2"><p className="tabular-nums">{m.visits}</p><Badge variant="outline" className="text-[10px]">{CONF_LABEL[w.confidence]}</Badge></td>
                      <td className="p-2">{best ? <><p className="font-medium">{best.trainer.name}</p><span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${FIT_VARIANT[best.label]}`}>{best.label} · {Math.round(best.overlap * 100)}%</span></> : '—'}</td>
                      <td className="p-2 text-muted-foreground">{second ? `${second.trainer.name} · ${Math.round(second.overlap * 100)}%` : '—'}</td>
                      <td className="p-2 text-right whitespace-nowrap">
                        <Button size="sm" className="rounded-xl gap-1" disabled={!best || best.atCapacity || best.overlap === 0 || assign.isPending}
                          onClick={() => assign.mutate([{ member_id: m.member_id, trainer_id: best.trainer.trainer_id }])}><UserCheck className="h-3.5 w-3.5" />Assign</Button>
                        <Button size="sm" variant="ghost" className="rounded-xl ml-1" onClick={() => setDrawer({ id: m.member_id, name: m.name ?? 'Member' })}>Other</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!isLoading && !filtered.length && <p className="py-10 text-center text-muted-foreground">Everyone here has a trainer.</p>}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Assign {bulkItems.length} members to their best-match trainer?</AlertDialogTitle>
            <AlertDialogDescription>Members whose best trainer is full or not on shift are left out. Trainers and members get the usual notification.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => assign.mutate(bulkItems.slice(0, 50))}>Assign</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {drawer && (
        <AssignTrainerDrawer open onOpenChange={(o) => { if (!o) { setDrawer(null); qc.invalidateQueries({ queryKey: ['trainer-match'] }); } }}
          memberId={drawer.id} memberName={drawer.name} branchId={branchId} />
      )}
    </div>
  );
}
export { fmtMin };
