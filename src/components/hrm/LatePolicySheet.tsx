import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Clock, Save, BellRing, Users } from 'lucide-react';

interface LatePolicy {
  late_grace_min: number;
  late_notifications_enabled: boolean;
  late_notify_managers: boolean;
  min_punch_gap_min: number;
  unscheduled_punch_policy: string;
}

const DEFAULTS: LatePolicy = {
  late_grace_min: 10,
  late_notifications_enabled: true,
  late_notify_managers: true,
  min_punch_gap_min: 60,
  unscheduled_punch_policy: 'unscheduled',
};

interface StaffGraceRow {
  user_id: string;
  full_name: string;
  late_grace_min: number | null;
}

export function LatePolicySheet({
  open, onOpenChange, branchId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  branchId: string | null;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<LatePolicy>(DEFAULTS);

  const { data: settings, isLoading } = useQuery({
    queryKey: ['late-policy', branchId],
    enabled: open,
    queryFn: async () => {
      const q = supabase
        .from('hr_settings')
        .select('late_grace_min, late_notifications_enabled, late_notify_managers, min_punch_gap_min, unscheduled_punch_policy');
      const { data, error } = branchId
        ? await q.eq('branch_id', branchId).maybeSingle()
        : await q.is('branch_id', null).maybeSingle();
      if (error && error.code !== 'PGRST116') throw error;
      return (data as unknown as LatePolicy) || null;
    },
  });

  const { data: staffGrace = [], isLoading: loadingStaff } = useQuery({
    queryKey: ['staff-grace', branchId],
    enabled: open && !!branchId,
    queryFn: async (): Promise<StaffGraceRow[]> => {
      const { data: shifts, error } = await supabase
        .from('staff_shifts')
        .select('user_id, late_grace_min')
        .eq('branch_id', branchId!);
      if (error) throw error;
      const byUser = new Map<string, number | null>();
      (shifts || []).forEach((s: { user_id: string; late_grace_min: number | null }) => {
        if (!byUser.has(s.user_id)) byUser.set(s.user_id, s.late_grace_min);
      });
      const ids = Array.from(byUser.keys());
      if (ids.length === 0) return [];
      const { data: profiles } = await supabase
        .from('profiles').select('id, full_name').in('id', ids);
      const nameOf = new Map((profiles || []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name || 'Staff member']));
      return ids
        .map((uid) => ({ user_id: uid, full_name: nameOf.get(uid) || 'Staff member', late_grace_min: byUser.get(uid) ?? null }))
        .sort((a, b) => a.full_name.localeCompare(b.full_name));
    },
  });

  const [graceEdits, setGraceEdits] = useState<Record<string, string>>({});

  useEffect(() => {
    setForm({ ...DEFAULTS, ...(settings || {}) });
    setGraceEdits({});
  }, [settings, open]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('hr_settings')
        .upsert({ branch_id: branchId, ...form } as never, { onConflict: 'branch_id' });
      if (error) throw error;

      const entries = Object.entries(graceEdits);
      for (const [userId, raw] of entries) {
        const value = raw === '' ? null : Number(raw);
        const { error: sErr } = await supabase
          .from('staff_shifts')
          .update({ late_grace_min: value })
          .eq('user_id', userId)
          .eq('branch_id', branchId!);
        if (sErr) throw sErr;
      }
    },
    onSuccess: () => {
      toast.success('Late policy saved');
      qc.invalidateQueries({ queryKey: ['late-policy'] });
      qc.invalidateQueries({ queryKey: ['staff-grace'] });
      qc.invalidateQueries({ queryKey: ['staff-attendance-month'] });
      onOpenChange(false);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Failed to save'),
  });

  function patch<K extends keyof LatePolicy>(k: K, v: LatePolicy[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" /> Attendance &amp; Late Policy
          </SheetTitle>
          <SheetDescription>
            Lateness is measured against each person&apos;s roster shift — including per-date overrides,
            evening and night blocks. Applies to staff, managers and trainers.
          </SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div className="space-y-3 py-6">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : (
          <div className="space-y-5 py-6">
            <div className="rounded-2xl bg-card p-4 shadow-sm space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="grace">Branch grace period (minutes)</Label>
                  <Input
                    id="grace" type="number" min={0} max={240}
                    value={form.late_grace_min}
                    onChange={(e) => patch('late_grace_min', Number(e.target.value))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gap">Minimum minutes between scans</Label>
                  <Input
                    id="gap" type="number" min={0} max={720}
                    value={form.min_punch_gap_min}
                    onChange={(e) => patch('min_punch_gap_min', Number(e.target.value))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="unscheduled">Punch on an unscheduled / off day</Label>
                <Select
                  value={form.unscheduled_punch_policy}
                  onValueChange={(v) => patch('unscheduled_punch_policy', v)}
                >
                  <SelectTrigger id="unscheduled"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unscheduled">Record as unscheduled (no lateness)</SelectItem>
                    <SelectItem value="ontime">Count as on-time</SelectItem>
                    <SelectItem value="late">Count as late</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-2xl bg-card p-4 shadow-sm space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 font-semibold text-foreground">
                    <BellRing className="h-4 w-4 text-primary" /> Late check-in notifications
                  </div>
                  <p className="text-xs text-muted-foreground">Alerts owners and admins when someone clocks in past grace.</p>
                </div>
                <Switch
                  aria-label="Enable late check-in notifications"
                  checked={form.late_notifications_enabled}
                  onCheckedChange={(v) => patch('late_notifications_enabled', v)}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium text-foreground">Also notify branch managers</div>
                  <p className="text-xs text-muted-foreground">Managers of the same branch receive the alert too.</p>
                </div>
                <Switch
                  aria-label="Notify branch managers"
                  disabled={!form.late_notifications_enabled}
                  checked={form.late_notify_managers}
                  onCheckedChange={(v) => patch('late_notify_managers', v)}
                />
              </div>
            </div>

            <div className="rounded-2xl bg-card p-4 shadow-sm space-y-3">
              <div className="flex items-center gap-2 font-semibold text-foreground">
                <Users className="h-4 w-4 text-primary" /> Per-staff grace override
              </div>
              <p className="text-xs text-muted-foreground">Leave blank to use the branch grace period.</p>
              {loadingStaff ? (
                <Skeleton className="h-24 w-full rounded-xl" />
              ) : staffGrace.length === 0 ? (
                <p className="text-sm text-muted-foreground">No roster rows for this branch yet.</p>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {staffGrace.map((s) => (
                    <div key={s.user_id} className="flex items-center justify-between gap-3">
                      <Label htmlFor={`grace-${s.user_id}`} className="text-sm font-normal">{s.full_name}</Label>
                      <Input
                        id={`grace-${s.user_id}`}
                        type="number" min={0} max={240}
                        className="w-24"
                        placeholder={String(form.late_grace_min)}
                        value={graceEdits[s.user_id] ?? (s.late_grace_min ?? '')}
                        onChange={(e) => setGraceEdits((g) => ({ ...g, [s.user_id]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || isLoading}>
            <Save className="mr-2 h-4 w-4" />
            {save.isPending ? 'Saving…' : 'Save policy'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default LatePolicySheet;
