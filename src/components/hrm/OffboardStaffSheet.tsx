import { useMemo, useState } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ShieldOff, KeyRound, CalendarX, UserX, Loader2, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { UNIFIED_STAFF_KEY, type UnifiedStaffPerson, type StaffRole } from '@/hooks/useUnifiedStaff';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  person: UnifiedStaffPerson | null;
  mode?: 'offboard' | 'reinstate';
}

const EXIT_TYPES = [
  { value: 'resigned', label: 'Resigned' },
  { value: 'terminated', label: 'Terminated' },
  { value: 'end_of_contract', label: 'End of contract' },
  { value: 'absconded', label: 'Absconded' },
  { value: 'other', label: 'Other' },
] as const;

export function OffboardStaffSheet({ open, onOpenChange, person, mode = 'offboard' }: Props) {
  const queryClient = useQueryClient();
  const [selectedRoles, setSelectedRoles] = useState<StaffRole[]>([]);
  const [exitType, setExitType] = useState<string>('resigned');
  const [exitDate, setExitDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Initialize selected roles when person opens
  useMemo(() => {
    if (open && person) {
      setSelectedRoles(person.roles);
      setConfirmName('');
      setReason('');
      setNotes('');
      setExitType('resigned');
      setExitDate(new Date().toISOString().slice(0, 10));
    }
  }, [open, person]);

  if (!person) return null;

  const isReinstate = mode === 'reinstate';
  const nameOk = isReinstate || confirmName.trim().toLowerCase() === person.name.trim().toLowerCase();
  const canSubmit = selectedRoles.length > 0 && nameOk && !submitting && (isReinstate || exitType);

  const toggleRole = (r: StaffRole, checked: boolean) => {
    setSelectedRoles((prev) =>
      checked ? Array.from(new Set([...prev, r])) : prev.filter((x) => x !== r),
    );
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const fn = isReinstate ? 'restore-staff' : 'offboard-staff';
      const payload: any = {
        user_id: person.user_id,
        person_id: person.employee?.id || person.trainer?.id,
        roles: selectedRoles,
      };
      if (!isReinstate) {
        Object.assign(payload, {
          exit_date: exitDate,
          exit_type: exitType,
          exit_reason: reason || null,
          exit_notes: notes || null,
        });
      }
      const { data, error } = await supabase.functions.invoke(fn, { body: payload });
      if (error) throw error;
      const steps: Array<{ step: string; ok: boolean; detail?: string }> = data?.steps || [];
      const failed = steps.filter((s) => !s.ok);
      if (failed.length === 0) {
        toast.success(isReinstate ? `${person.name} reinstated` : `${person.name} offboarded`, {
          description: `${steps.length} step${steps.length === 1 ? '' : 's'} completed.`,
        });
      } else {
        toast.warning(`${isReinstate ? 'Reinstate' : 'Offboard'} completed with issues`, {
          description: failed.map((f) => `${f.step}: ${f.detail || 'failed'}`).join(' · '),
        });
      }
      queryClient.invalidateQueries({ queryKey: UNIFIED_STAFF_KEY });
      queryClient.invalidateQueries({ queryKey: ['hrm-employees'] });
      queryClient.invalidateQueries({ queryKey: ['hrm-payroll-staff'] });
      queryClient.invalidateQueries({ queryKey: ['trainers'] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || `Failed to ${isReinstate ? 'reinstate' : 'offboard'}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-xl w-full p-0 flex flex-col rounded-l-2xl border-0 shadow-2xl">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-slate-200/60">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-full ${isReinstate ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
              {isReinstate ? <CheckCircle2 className="h-5 w-5" /> : <UserX className="h-5 w-5" />}
            </div>
            <div>
              <SheetTitle className="text-lg font-bold text-slate-900">
                {isReinstate ? `Reinstate ${person.name}` : `Offboard ${person.name}`}
              </SheetTitle>
              <SheetDescription className="text-sm text-slate-500">
                {isReinstate
                  ? 'Restore turnstile access, app login and active rosters.'
                  : 'Revoke turnstile access, remove app login, mark exit. History stays intact.'}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Roles */}
          <section className="space-y-2">
            <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {isReinstate ? 'Roles to reinstate' : 'Roles to offboard'}
            </Label>
            <div className="rounded-xl border border-slate-200 p-3 space-y-2 bg-slate-50/50">
              {person.roles.map((r) => (
                <label key={r} className="flex items-center gap-3 cursor-pointer">
                  <Checkbox
                    checked={selectedRoles.includes(r)}
                    onCheckedChange={(c) => toggleRole(r, !!c)}
                  />
                  <span className="text-sm font-medium text-slate-700 capitalize">{r}</span>
                </label>
              ))}
            </div>
          </section>

          {!isReinstate && (
            <>
              {/* Exit type + date */}
              <section className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="exit-type">Exit type</Label>
                  <Select value={exitType} onValueChange={setExitType}>
                    <SelectTrigger id="exit-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EXIT_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="exit-date">Exit date</Label>
                  <Input id="exit-date" type="date" value={exitDate} onChange={(e) => setExitDate(e.target.value)} />
                </div>
              </section>

              <section className="space-y-1.5">
                <Label htmlFor="reason">Reason <span className="text-slate-400 font-normal">(optional)</span></Label>
                <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Short reason for exit" />
              </section>

              <section className="space-y-1.5">
                <Label htmlFor="notes">Internal notes <span className="text-slate-400 font-normal">(optional)</span></Label>
                <Textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Visible only to HR / Owners" />
              </section>

              {/* Checklist preview */}
              <section className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2.5">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">What happens</div>
                <ChecklistItem icon={<ShieldOff className="h-4 w-4" />} label="Revoke MIPS turnstile / biometric access" />
                <ChecklistItem icon={<KeyRound className="h-4 w-4" />} label="Remove app roles & sign out of all sessions" />
                <ChecklistItem icon={<CalendarX className="h-4 w-4" />} label="Unassign future class schedules (if trainer)" />
                <ChecklistItem icon={<CheckCircle2 className="h-4 w-4" />} label="Keep payroll history, contracts and attendance intact" />
              </section>

              {/* Confirm typed name */}
              <section className="rounded-xl border border-red-200 bg-red-50/50 p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
                  <AlertTriangle className="h-4 w-4" />
                  Type <span className="font-mono px-1.5 py-0.5 bg-white rounded border border-red-200">{person.name}</span> to confirm
                </div>
                <Input
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder="Type full name"
                  className="bg-white"
                />
              </section>
            </>
          )}
        </div>

        <div className="sticky bottom-0 px-6 py-4 border-t border-slate-200/60 bg-white flex items-center justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={!canSubmit}
            className={isReinstate
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
              : 'bg-red-600 hover:bg-red-700 text-white'}
          >
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isReinstate ? 'Reinstate' : `Offboard ${person.name.split(' ')[0]}`}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ChecklistItem({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2.5 text-sm text-slate-700">
      <span className="text-slate-500">{icon}</span>
      {label}
    </div>
  );
}
