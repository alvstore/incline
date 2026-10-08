import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ArrowRightLeft, Loader2, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { fetchTrainers } from '@/services/trainerService';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { getISTToday } from '@/lib/utils/datetime';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  branchId: string;
  fromTrainerId?: string;
  packageId?: string;
  packageIds?: string[];
  fromTrainerName?: string;
}

interface PkgRow {
  id: string;
  member_id: string;
  trainer_id: string;
  sessions_total: number;
  sessions_remaining: number;
  expiry_date: string;
  member_name: string;
  pending: { month: string; amount: number }[];
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export function TransferPTClientsDrawer({ open, onOpenChange, branchId, fromTrainerId, packageId, packageIds, fromTrainerName }: Props) {
  const qc = useQueryClient();
  const today = typeof getISTToday === 'function' ? format(getISTToday(), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd');
  const [selected, setSelected] = useState<string[]>([]);
  const [toTrainer, setToTrainer] = useState('');
  const [effective, setEffective] = useState(today);
  const [keepGeneral, setKeepGeneral] = useState(false);
  const [reason, setReason] = useState('');

  const pkgs = useQuery({
    queryKey: ['pt-transfer-packages', fromTrainerId ?? null, packageId ?? null, (packageIds ?? []).join(',')],
    enabled: open && !!(fromTrainerId || packageId || packageIds?.length),
    queryFn: async (): Promise<PkgRow[]> => {
      let q = supabase.from('member_pt_packages')
        .select('id, member_id, trainer_id, sessions_total, sessions_remaining, expiry_date, status')
        .in('status', ['active', 'pending_payment']);
      q = packageIds?.length ? q.in('id', packageIds) : packageId ? q.eq('id', packageId) : q.eq('trainer_id', fromTrainerId!);
      const { data, error } = await q;
      if (error) throw error;
      const rows = data ?? [];
      if (!rows.length) return [];
      const memberIds = [...new Set(rows.map((r) => r.member_id))];
      const { data: mem } = await supabase.from('members').select('id, user_id, member_code').in('id', memberIds);
      const uids = (mem ?? []).map((m) => m.user_id).filter(Boolean) as string[];
      const { data: profs } = uids.length ? await supabase.from('profiles').select('id, full_name').in('id', uids) : { data: [] };
      const nameByUser = new Map((profs ?? []).map((p) => [p.id, p.full_name]));
      const nameByMember = new Map((mem ?? []).map((m) => [m.id, (m.user_id && nameByUser.get(m.user_id)) || m.member_code || 'Member']));
      const { data: comm } = await supabase.from('trainer_commissions').select('id, pt_package_id').in('pt_package_id', rows.map((r) => r.id));
      const pkgByComm = new Map((comm ?? []).map((c) => [c.id, c.pt_package_id]));
      const { data: inst } = (comm ?? []).length
        ? await supabase.from('pt_commission_installments')
          .select('commission_id, trainer_id, payout_month, installment_amount, status, payroll_item_id')
          .in('commission_id', (comm ?? []).map((c) => c.id)).eq('status', 'pending').is('payroll_item_id', null)
        : { data: [] };
      return rows.map((r) => ({
        ...r,
        member_name: String(nameByMember.get(r.member_id) ?? 'Member'),
        pending: (inst ?? []).filter((i) => pkgByComm.get(i.commission_id) === r.id && i.trainer_id === r.trainer_id)
          .map((i) => ({ month: i.payout_month, amount: Number(i.installment_amount) })),
      }));
    },
  });

  const trainers = useQuery({
    queryKey: ['trainers', branchId, 'active'],
    enabled: open && !!branchId,
    queryFn: () => fetchTrainers(branchId, true),
  });

  useEffect(() => {
    if (open && pkgs.data) setSelected(pkgs.data.map((p) => p.id));
  }, [open, pkgs.data]);

  const effMonth = effective.slice(0, 7);
  const preview = useMemo(() => {
    let move = 0, stay = 0;
    (pkgs.data ?? []).filter((p) => selected.includes(p.id)).forEach((p) =>
      p.pending.forEach((i) => (i.month.slice(0, 7) >= effMonth ? (move += i.amount) : (stay += i.amount))));
    return { move, stay };
  }, [pkgs.data, selected, effMonth]);

  const sourceTrainers = new Set(fromTrainerId ? [fromTrainerId] : (pkgs.data ?? []).map((p) => p.trainer_id));
  const options = (trainers.data ?? []).filter((t) => !sourceTrainers.has(t.id));
  const toName = options.find((t) => t.id === toTrainer)?.profile_name ?? 'new trainer';

  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('transfer_pt_package_trainer', {
        _package_ids: selected, _to_trainer: toTrainer, _effective_date: effective,
        _keep_general: keepGeneral, _reason: reason.trim() || null,
      });
      if (error) throw error;
      return data as { transferred: number; moved_amount: number };
    },
    onSuccess: (d) => {
      toast.success(`${d.transferred} PT client(s) moved to ${toName}`);
      ['member-pt-packages', 'active-member-packages', 'trainer-sessions', 'pt-transfer-packages', 'member-details', 'payroll', 'pt-commissions']
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSubmit = selected.length > 0 && !!toTrainer && !!effective && !mutation.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border p-5">
          <SheetTitle className="flex items-center gap-2"><ArrowRightLeft className="h-4 w-4" />Transfer PT clients</SheetTitle>
          <SheetDescription>
            {fromTrainerName ? `From ${fromTrainerName}. ` : ''}Paid commission stays with the old trainer; unpaid parts from the effective month move to the new trainer.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <section className="space-y-2 rounded-2xl border border-border p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">1 · Packages</p>
            {pkgs.isLoading ? (
              <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
            ) : pkgs.isError ? (
              <p className="text-sm text-destructive">Could not load packages.</p>
            ) : !pkgs.data?.length ? (
              <div className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground">
                <Users className="h-6 w-6" aria-hidden />No active PT packages to transfer.
              </div>
            ) : pkgs.data.map((p) => {
              const due = p.pending.reduce((s, i) => s + i.amount, 0);
              const id = `pkg-${p.id}`;
              return (
                <label key={p.id} htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl p-2 hover:bg-secondary">
                  <Checkbox id={id} checked={selected.includes(p.id)}
                    onCheckedChange={(c) => setSelected((s) => (c ? [...s, p.id] : s.filter((x) => x !== p.id)))} className="mt-1" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{p.member_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.sessions_total > 0 ? `${p.sessions_remaining}/${p.sessions_total} sessions left` : 'Monthly'} · expires {format(new Date(p.expiry_date), 'dd MMM yyyy')}
                      {due > 0 ? ` · unpaid commission ${inr(due)}` : ''}
                    </p>
                  </div>
                </label>
              );
            })}
          </section>

          <section className="space-y-3 rounded-2xl border border-border p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">2 · New trainer & date</p>
            <div className="space-y-1.5">
              <Label htmlFor="pt-transfer-trainer">New trainer</Label>
              {trainers.isLoading ? <Skeleton className="h-11 w-full" /> : (
                <Select value={toTrainer} onValueChange={setToTrainer}>
                  <SelectTrigger id="pt-transfer-trainer" className="min-h-11"><SelectValue placeholder="Choose trainer" /></SelectTrigger>
                  <SelectContent>
                    {options.map((t) => <SelectItem key={t.id} value={t.id}>{t.profile_name ?? 'Trainer'}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pt-transfer-date">Effective from</Label>
              <Input id="pt-transfer-date" type="date" className="min-h-11" value={effective} onChange={(e) => setEffective(e.target.value)} />
            </div>
            <label htmlFor="pt-keep-general" className="flex min-h-11 cursor-pointer items-center gap-3">
              <Checkbox id="pt-keep-general" checked={keepGeneral} onCheckedChange={(c) => setKeepGeneral(!!c)} />
              <span className="text-sm">Keep current general trainer on the member profile</span>
            </label>
            <div className="space-y-1.5">
              <Label htmlFor="pt-transfer-reason">Reason</Label>
              <Textarea id="pt-transfer-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Trainer left the gym" maxLength={300} />
            </div>
          </section>

          <section className="space-y-1 rounded-2xl border border-border bg-muted/40 p-4" aria-live="polite">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">3 · Payroll preview</p>
            <p className="text-sm">Moves to {toName}: <span className="font-semibold tabular-nums">{inr(preview.move)}</span></p>
            <p className="text-sm text-muted-foreground">Stays with old trainer (before {format(new Date(effective || today), 'MMM yyyy')}): <span className="tabular-nums">{inr(preview.stay)}</span></p>
            <p className="text-xs text-muted-foreground">Already-paid parts and completed sessions are never changed. Future scheduled sessions move too.</p>
          </section>
        </div>

        <div className="flex justify-end gap-2 border-t border-border p-4">
          <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="min-h-11" disabled={!canSubmit} onClick={() => mutation.mutate()}>
            {mutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Transfer {selected.length || ''}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
