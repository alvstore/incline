import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Loader2, ShieldCheck, RefreshCw, Lock, DoorOpen, History, CheckCircle2 } from "lucide-react";

type GateMode = "legacy" | "shadow" | "enforce";
interface BranchRule { id: string; name: string; mode: GateMode; override: GateMode | null }
interface Overview { global_mode: GateMode; tz_lock: boolean; branches: BranchRule[] }
interface DriftRow {
  member_id: string; member_code: string | null; full_name: string | null;
  hardware_access_status: string | null; expected: string; base_due: number; other_due: number;
}
interface ChangeRow { id: string; setting: string; new_value: unknown; rechecked: number; created_at: string }

const MODE_LABEL: Record<GateMode, string> = {
  legacy: "Old rule — any overdue bill blocks the door",
  shadow: "Trial — new rule measured, old rule still applied",
  enforce: "New rule — only membership dues block the door",
};

const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (fn: string, args?: Record<string, unknown>) => (supabase.rpc as any)(fn, args);

export default function GateRulesTab({ branchId }: { branchId?: string }) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<{ branch: string | null; mode: GateMode } | null>(null);

  const overview = useQuery({
    queryKey: ["gate-rules-overview"],
    queryFn: async () => {
      const { data, error } = await rpc("gate_rules_overview");
      if (error) throw error;
      return data as Overview;
    },
  });
  const drift = useQuery({
    queryKey: ["gate-access-drift", branchId ?? null],
    queryFn: async () => {
      const { data, error } = await rpc("gate_access_drift", { _branch_id: branchId ?? null });
      if (error) throw error;
      return (data ?? []) as DriftRow[];
    },
  });
  const changes = useQuery({
    queryKey: ["gate-rule-changes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gate_rule_changes")
        .select("id, setting, new_value, rechecked, created_at")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as ChangeRow[];
    },
  });

  const refresh = () => ["gate-rules-overview", "gate-access-drift", "gate-rule-changes"].forEach((k) =>
    qc.invalidateQueries({ queryKey: [k] }));

  const setSettings = useMutation({
    mutationFn: async (args: { _branch_id: string | null; _mode?: GateMode; _tz_lock?: boolean }) => {
      const { data, error } = await rpc("set_gate_settings", args);
      if (error) throw error;
      return data as { rechecked?: number };
    },
    onSuccess: (d) => {
      toast.success(d?.rechecked ? `Saved. ${d.rechecked} member(s) re-checked at the gates.` : "Gate settings saved.");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const recheck = useMutation({
    mutationFn: async () => {
      const { data, error } = await rpc("gate_recheck_branch", { _branch_id: branchId ?? null });
      if (error) throw error;
      return data as { queued: number; failed: number };
    },
    onSuccess: (d) => { toast.success(`Re-check sent for ${d.queued} member(s)${d.failed ? `, ${d.failed} failed` : ""}.`); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const fixOne = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await rpc("gate_fix_member", { _member_id: id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Gate update sent."); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (overview.isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (overview.isError || !overview.data)
    return <Card className="rounded-xl"><CardContent className="p-6 text-sm text-destructive">Could not load gate rules.</CardContent></Card>;

  const o = overview.data;
  const rows = drift.data ?? [];

  return (
    <div className="grid grid-cols-12 gap-4">
      <Card className="col-span-12 rounded-xl lg:col-span-7">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-primary" /> Gate rule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-5 pt-0">
          <div className="space-y-1.5">
            <Label htmlFor="gate-mode-all">All branches (default)</Label>
            <Select value={o.global_mode} onValueChange={(v) => setPending({ branch: null, mode: v as GateMode })}>
              <SelectTrigger id="gate-mode-all" className="min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(MODE_LABEL) as GateMode[]).map((m) => <SelectItem key={m} value={m}>{MODE_LABEL[m]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {o.branches.map((b) => (
            <div key={b.id} className="space-y-1.5">
              <Label htmlFor={`gate-mode-${b.id}`}>{b.name} {!b.override && <span className="text-xs text-muted-foreground">(uses default)</span>}</Label>
              <Select value={b.mode} onValueChange={(v) => setPending({ branch: b.id, mode: v as GateMode })}>
                <SelectTrigger id={`gate-mode-${b.id}`} className="min-h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(MODE_LABEL) as GateMode[]).map((m) => <SelectItem key={m} value={m}>{MODE_LABEL[m]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ))}
          <div className="rounded-xl bg-muted/50 p-4 text-xs text-muted-foreground">
            <p className="mb-2 font-semibold uppercase tracking-wide">What blocks the door under the new rule</p>
            <ul className="space-y-1">
              <li className="flex items-center gap-2"><Lock className="h-3.5 w-3.5 text-destructive" /> Membership dues, expired or frozen membership — always blocks</li>
              <li className="flex items-center gap-2"><DoorOpen className="h-3.5 w-3.5 text-accent" /> PT, store and add-on dues — door opens, front desk gets an alert</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card className="col-span-12 rounded-xl lg:col-span-5">
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Lock className="h-4 w-4 text-primary" /> Lock method</CardTitle></CardHeader>
        <CardContent className="space-y-3 p-5 pt-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="tz-lock">Future start date lock (recommended)</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Locked members get validity 2099-01-01 → 2099-12-31. The gate recognises the face, says
                "Permission Denied" and keeps the face saved. Turning this off uses the older past end date
                (2000-01-01), which can make gates re-learn faces.
              </p>
            </div>
            <Switch id="tz-lock" checked={o.tz_lock} disabled={setSettings.isPending}
              onCheckedChange={(v) => setSettings.mutate({ _branch_id: null, _tz_lock: v })} />
          </div>
          <p className="text-xs text-muted-foreground">When a member is unlocked, validity returns to joining date → membership end date.</p>
        </CardContent>
      </Card>

      <Card className="col-span-12 rounded-xl lg:col-span-8">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Members out of sync with the rule</CardTitle>
          <Button size="sm" className="min-h-11 rounded-xl" disabled={recheck.isPending || rows.length === 0} onClick={() => recheck.mutate()}>
            {recheck.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Re-check all now
          </Button>
        </CardHeader>
        <CardContent className="p-5 pt-0" aria-live="polite">
          {drift.isLoading ? <Skeleton className="h-24 w-full" /> : drift.isError ? (
            <p className="text-sm text-destructive">Could not load the list.</p>
          ) : rows.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Every gate matches the rule.</div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.member_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium">{r.full_name ?? "Member"} <span className="text-xs text-muted-foreground">{r.member_code}</span></p>
                    <p className="text-xs text-muted-foreground">Membership due {inr(r.base_due)} · PT/store/add-on due {inr(r.other_due)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={r.expected === "open" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-500" : "border-destructive/20 bg-destructive/10 text-destructive"}>
                      Should be {r.expected === "open" ? "open" : "locked"}
                    </Badge>
                    <Button size="sm" variant="outline" className="min-h-11 rounded-xl" disabled={fixOne.isPending}
                      aria-label={`Fix gate for ${r.full_name ?? r.member_code}`} onClick={() => fixOne.mutate(r.member_id)}>Fix</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="col-span-12 rounded-xl lg:col-span-4">
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4 text-primary" /> Recent changes</CardTitle></CardHeader>
        <CardContent className="p-5 pt-0">
          {changes.isLoading ? <Skeleton className="h-16 w-full" /> : (changes.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No changes yet.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {(changes.data ?? []).map((c) => (
                <li key={c.id} className="flex justify-between gap-2">
                  <span>{c.setting === "gate_tier_mode" ? `Rule → ${String(c.new_value)}` : `Lock method changed`}{c.rechecked ? ` · ${c.rechecked} re-checked` : ""}</span>
                  <span className="text-muted-foreground">{new Date(c.created_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!pending} onOpenChange={(v) => !v && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change the gate rule?</AlertDialogTitle>
            <AlertDialogDescription>
              {pending && MODE_LABEL[pending.mode]}. Members affected will be re-checked and their gate dates updated one by one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (pending) setSettings.mutate({ _branch_id: pending.branch, _mode: pending.mode }); setPending(null); }}>
              Change rule
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
