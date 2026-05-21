import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Save, Building2, Scale, Users, ShieldCheck } from 'lucide-react';

type HrSettings = {
  id?: string;
  branch_id: string | null;
  employer_legal_name: string;
  employer_registered_address: string | null;
  employer_gstin: string | null;
  employer_pan: string | null;
  employer_firm_registration_no: string | null;
  employer_proprietor_name: string | null;
  posh_ic: { name: string; role: string; phone?: string; email?: string }[] | null;
  lawyer_reviewed_by: string | null;
  lawyer_reviewed_at: string | null;
  notice_period_staff_days: number;
  notice_period_trainer_days: number;
  notice_period_manager_days: number;
  arbitration_seat: string;
  governing_jurisdiction: string;
  weekly_hour_cap: number;
  daily_hour_cap: number;
  ot_multiplier: number;
  basic_pct_of_ctc: number;
};

const blank = (branch_id: string | null): HrSettings => ({
  branch_id,
  employer_legal_name: 'Incline (Proprietorship Firm)',
  employer_registered_address: '',
  employer_gstin: '',
  employer_pan: '',
  employer_firm_registration_no: '',
  employer_proprietor_name: 'Yogita Lekhari',
  posh_ic: [],
  lawyer_reviewed_by: '',
  lawyer_reviewed_at: null,
  notice_period_staff_days: 30,
  notice_period_trainer_days: 60,
  notice_period_manager_days: 90,
  arbitration_seat: 'Udaipur',
  governing_jurisdiction: 'Udaipur, Rajasthan',
  weekly_hour_cap: 48,
  daily_hour_cap: 9,
  ot_multiplier: 2.0,
  basic_pct_of_ctc: 50.0,
});

export default function HrSettingsTab() {
  const { selectedBranch } = useBranch();
  const branchId = selectedBranch?.id ?? null;
  const qc = useQueryClient();
  const [form, setForm] = useState<HrSettings>(blank(branchId));

  const { data, isLoading } = useQuery({
    queryKey: ['hr-settings', branchId],
    queryFn: async () => {
      const q = supabase.from('hr_settings').select('*');
      const { data, error } = branchId
        ? await q.eq('branch_id', branchId).maybeSingle()
        : await q.is('branch_id', null).maybeSingle();
      if (error && error.code !== 'PGRST116') throw error;
      return data as HrSettings | null;
    },
  });

  useEffect(() => {
    if (data) setForm({ ...blank(branchId), ...data });
    else setForm(blank(branchId));
  }, [data, branchId]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = { ...form, branch_id: branchId };
      const { error } = await supabase
        .from('hr_settings')
        .upsert(payload, { onConflict: branchId ? 'branch_id' : 'id' });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('HR settings saved');
      qc.invalidateQueries({ queryKey: ['hr-settings'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to save'),
  });

  function patch<K extends keyof HrSettings>(k: K, v: HrSettings[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function addPoshMember() {
    patch('posh_ic', [...(form.posh_ic || []), { name: '', role: 'Member' }]);
  }
  function updatePosh(i: number, field: string, v: string) {
    const next = [...(form.posh_ic || [])];
    next[i] = { ...next[i], [field]: v };
    patch('posh_ic', next);
  }
  function removePosh(i: number) {
    const next = [...(form.posh_ic || [])];
    next.splice(i, 1);
    patch('posh_ic', next);
  }

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-40 w-full rounded-2xl" /><Skeleton className="h-40 w-full rounded-2xl" /></div>;

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl shadow-lg shadow-slate-200/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Building2 className="h-4 w-4 text-indigo-600" /> Employer details</CardTitle>
          <CardDescription>Used on contracts, payslips, GST invoices and policy headers.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Legal name *"><Input value={form.employer_legal_name} onChange={(e) => patch('employer_legal_name', e.target.value)} /></Field>
          <Field label="Proprietor name"><Input value={form.employer_proprietor_name ?? ''} onChange={(e) => patch('employer_proprietor_name', e.target.value)} /></Field>
          <Field label="GSTIN"><Input value={form.employer_gstin ?? ''} onChange={(e) => patch('employer_gstin', e.target.value.toUpperCase())} placeholder="08XXXXX1234X1Z5" /></Field>
          <Field label="PAN"><Input value={form.employer_pan ?? ''} onChange={(e) => patch('employer_pan', e.target.value.toUpperCase())} /></Field>
          <Field label="Firm registration no."><Input value={form.employer_firm_registration_no ?? ''} onChange={(e) => patch('employer_firm_registration_no', e.target.value)} /></Field>
          <Field label="Registered address" className="md:col-span-2">
            <Textarea rows={2} value={form.employer_registered_address ?? ''} onChange={(e) => patch('employer_registered_address', e.target.value)} />
          </Field>
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-lg shadow-slate-200/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Scale className="h-4 w-4 text-indigo-600" /> Statutory & contractual defaults</CardTitle>
          <CardDescription>Applied to all new contracts. Tiered notice per role complies with 2026 Labour Codes.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="Notice — Staff (days)"><Input type="number" value={form.notice_period_staff_days} onChange={(e) => patch('notice_period_staff_days', Number(e.target.value))} /></Field>
          <Field label="Notice — Trainer (days)"><Input type="number" value={form.notice_period_trainer_days} onChange={(e) => patch('notice_period_trainer_days', Number(e.target.value))} /></Field>
          <Field label="Notice — Manager (days)"><Input type="number" value={form.notice_period_manager_days} onChange={(e) => patch('notice_period_manager_days', Number(e.target.value))} /></Field>
          <Field label="Basic % of CTC"><Input type="number" step={0.5} value={form.basic_pct_of_ctc} onChange={(e) => patch('basic_pct_of_ctc', Number(e.target.value))} /></Field>
          <Field label="Daily hours cap"><Input type="number" value={form.daily_hour_cap} onChange={(e) => patch('daily_hour_cap', Number(e.target.value))} /></Field>
          <Field label="Weekly hours cap"><Input type="number" value={form.weekly_hour_cap} onChange={(e) => patch('weekly_hour_cap', Number(e.target.value))} /></Field>
          <Field label="OT multiplier"><Input type="number" step={0.1} value={form.ot_multiplier} onChange={(e) => patch('ot_multiplier', Number(e.target.value))} /></Field>
          <Field label="Arbitration seat"><Input value={form.arbitration_seat} onChange={(e) => patch('arbitration_seat', e.target.value)} /></Field>
          <Field label="Governing jurisdiction" className="md:col-span-2"><Input value={form.governing_jurisdiction} onChange={(e) => patch('governing_jurisdiction', e.target.value)} /></Field>
          <Field label="Reviewed by (lawyer)"><Input value={form.lawyer_reviewed_by ?? ''} onChange={(e) => patch('lawyer_reviewed_by', e.target.value)} /></Field>
          <Field label="Reviewed at"><Input type="date" value={form.lawyer_reviewed_at ?? ''} onChange={(e) => patch('lawyer_reviewed_at', e.target.value || null)} /></Field>
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-lg shadow-slate-200/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-indigo-600" /> POSH Internal Committee</CardTitle>
          <CardDescription>Mandatory under the Sexual Harassment of Women at Workplace Act, 2013. Minimum 4 members; presiding officer must be a senior woman; one external member required.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(form.posh_ic || []).length === 0 && (
            <p className="text-sm text-slate-500">No committee members configured yet.</p>
          )}
          {(form.posh_ic || []).map((m, i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
              <Field label="Name"><Input value={m.name} onChange={(e) => updatePosh(i, 'name', e.target.value)} /></Field>
              <Field label="Role"><Input value={m.role} onChange={(e) => updatePosh(i, 'role', e.target.value)} placeholder="Presiding Officer / Member / External" /></Field>
              <Field label="Phone"><Input value={m.phone ?? ''} onChange={(e) => updatePosh(i, 'phone', e.target.value)} /></Field>
              <Field label="Email"><Input value={m.email ?? ''} onChange={(e) => updatePosh(i, 'email', e.target.value)} /></Field>
              <Button variant="ghost" size="sm" onClick={() => removePosh(i)}>Remove</Button>
            </div>
          ))}
          <Separator />
          <Button variant="outline" size="sm" onClick={addPoshMember}><Users className="h-3.5 w-3.5 mr-1" />Add member</Button>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={save.isPending} className="bg-indigo-600 hover:bg-indigo-700">
          <Save className="h-4 w-4 mr-2" />
          {save.isPending ? 'Saving...' : 'Save HR settings'}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</Label>
      {children}
    </div>
  );
}
