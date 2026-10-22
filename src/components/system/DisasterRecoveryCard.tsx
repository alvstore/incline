import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CalendarClock, CheckCircle2, ChevronDown, Clock, Database, FolderOpen, Loader2,
  RefreshCw, ScanSearch, ServerCog, ShieldCheck, Table2, TimerOff, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { can } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import {
  FULL_STEPS, STEP_LABELS, formatBytes, formatDuration, friendlyTable, isActive, runProgress, statusMeta,
  type HistoryRow, type RunKind, type RunRow, type StandbyStatus, type Tone,
} from "@/lib/dr/standbyCopy";

const QUERY_KEY = ["dr-standby-status"] as const;

const TONE_BADGE: Record<Tone, string> = {
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  danger: "bg-destructive/10 text-destructive border-destructive/20",
  info: "bg-primary/10 text-primary border-primary/20",
  neutral: "bg-muted text-muted-foreground border-border",
};
const TONE_ICON: Record<Tone, string> = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-destructive/10 text-destructive",
  info: "bg-primary/10 text-primary",
  neutral: "bg-muted text-muted-foreground",
};

const fmtDateTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" })
    : "—";
const n = (v: number | undefined | null) => (v ?? 0).toLocaleString("en-IN");

function StatusPill({ tone, label, spinning }: { tone: Tone; label: string; spinning?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold", TONE_BADGE[tone])}>
      {spinning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : tone === "success" ? <CheckCircle2 className="h-3.5 w-3.5" /> : tone === "danger" ? <XCircle className="h-3.5 w-3.5" /> : tone === "warning" ? <AlertTriangle className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
      {label}
    </span>
  );
}

function ResultTile({ icon: Icon, label, value, caption, tone }: {
  icon: typeof Database; label: string; value: string; caption: string; tone: Tone;
}) {
  return (
    <div className="rounded-xl bg-muted/40 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", TONE_ICON[tone])}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-foreground">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{caption}</p>
    </div>
  );
}

function LiveProgress({ run }: { run: RunRow }) {
  const pct = runProgress(run);
  const r = run.report;
  const steps = run.kind === "verify" ? ["verify"] : (FULL_STEPS as readonly string[]);
  const current = steps.indexOf(run.step);
  let detail = "";
  if (run.step === "rows" && r.rows) detail = `${n(r.rows.done)} of ${n(r.rows.tables)} tables · ${n(r.rows.rowsWritten)} records copied`;
  else if (run.step === "rows_catchup" && r.catchup) detail = `${n(r.catchup.done)} of ${n(r.catchup.tables)} tables re-checked`;
  else if (run.step === "storage_objects" && r.storage)
    detail = `${n(r.storage.copied)} files copied (${formatBytes(r.storage.copiedBytes)}) · ${n(r.storage.remaining)} to go`;
  const stale = run.heartbeat_at && Date.now() - new Date(run.heartbeat_at).getTime() > 10 * 60_000;

  return (
    <div className="rounded-xl bg-primary/5 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">
          {run.status === "queued" ? "Getting ready…" : STEP_LABELS[run.step] ?? "Working…"}
        </p>
        <p className="text-2xl font-bold tabular-nums text-primary">{pct}%</p>
      </div>
      <Progress value={pct} className="mt-3 h-2" aria-label="Copy progress" />
      <p className="mt-2 text-xs text-muted-foreground">
        {detail || `Started ${fmtDateTime(run.started_at ?? run.created_at)} · ${run.trigger === "nightly" ? "nightly copy" : "started manually"}`}
      </p>
      {stale && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-warning">
          <TimerOff className="h-3.5 w-3.5" /> No progress for over 10 minutes — it restarts automatically within the hour.
        </p>
      )}
      {steps.length > 1 && (
        <ol className="mt-4 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {steps.map((s, i) => {
            const done = i < current;
            const now = i === current;
            return (
              <li key={s} className={cn("flex items-center gap-2 text-xs", done ? "text-foreground" : now ? "font-semibold text-primary" : "text-muted-foreground")}>
                {done ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" /> : now ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-border" />}
                {STEP_LABELS[s]}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function Results({ run, oversized }: { run: RunRow; oversized: string[] }) {
  const [open, setOpen] = useState(false);
  const v = run.report.verify;
  if (!v) return null;
  const schemaDiff = v.schema?.differences ?? 0;
  const tables = v.tables;
  const files = v.storage;
  const fileIssues = files ? files.missing + files.different + files.extra + files.metadata : 0;
  const jobs = v.jobs;
  const jobIssues = jobs ? jobs.missing + jobs.extra : 0;
  const bucketIssues = (files?.buckets ?? []).filter((b) => b.missing + b.different + b.extra + b.metadata > 0);
  const errors = (run.report.errors ?? []).slice(-5).reverse();
  const copyStats = run.report.rows;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Match check · {fmtDateTime(v.checkedAt ?? run.finished_at)}
        </p>
        {run.finished_at && run.started_at && (
          <p className="text-xs text-muted-foreground">
            {run.kind === "full" ? "Full copy" : "Check"} took {formatDuration(run.started_at, run.finished_at)}
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        <ResultTile icon={ShieldCheck} label="Structure & rules" value={schemaDiff === 0 ? "Identical" : n(schemaDiff)}
          caption={schemaDiff === 0 ? "Tables, links, security rules, functions" : "differences in structure or security rules"}
          tone={schemaDiff === 0 ? "success" : "warning"} />
        <ResultTile icon={Table2} label="Records" value={tables ? `${n(tables.matched)}/${n(tables.total)}` : "—"}
          caption={tables && tables.mismatched.length === 0 ? "Every table matches, including sign-in accounts" : `${n(tables?.mismatched.length)} table(s) changed since the copy`}
          tone={tables && tables.mismatched.length === 0 ? "success" : "warning"} />
        <ResultTile icon={FolderOpen} label="Files" value={files ? n(files.objects) : "—"}
          caption={files ? (fileIssues === 0 ? `${formatBytes(files.bytes)} · every file matches` : `${n(fileIssues)} file(s) differ`) : "Not checked"}
          tone={files && fileIssues === 0 ? "success" : "warning"} />
        <ResultTile icon={CalendarClock} label="Scheduled jobs" value={jobs ? (jobs.activeOnStandby === 0 ? "Paused" : n(jobs.activeOnStandby)) : "—"}
          caption={jobs ? (jobs.activeOnStandby === 0 && jobIssues === 0 ? "Copied and kept paused on the standby" : jobs.activeOnStandby > 0 ? "running on the standby — should be paused" : `${n(jobIssues)} job(s) differ`) : "Not checked"}
          tone={jobs && jobs.activeOnStandby === 0 && jobIssues === 0 ? "success" : "warning"} />
      </div>

      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="min-h-11 gap-1.5 px-2 text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:text-foreground data-[state=open]:text-foreground">
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
            {open ? "Hide details" : "See details"}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-2">
          {copyStats && run.kind === "full" && (
            <p className="text-sm text-muted-foreground">
              This copy wrote {n(copyStats.rowsWritten + (run.report.catchup?.rowsWritten ?? 0))} records, removed {n(copyStats.rowsDeleted)} outdated
              ones{run.report.storage ? `, and copied ${n(run.report.storage.copied)} files (${formatBytes(run.report.storage.copiedBytes)})` : ""}.
            </p>
          )}
          {tables && tables.mismatched.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tables that changed since the copy</p>
              <p className="mb-2 text-xs text-muted-foreground">Busy tables (chats, gate scans) keep changing on the live app; the next copy picks these up.</p>
              <ul className="flex flex-wrap gap-1.5">
                {tables.mismatched.map((t) => (
                  <li key={t.table} className="rounded-md bg-warning/10 px-2 py-1 text-xs text-warning">{friendlyTable(t.table)}</li>
                ))}
              </ul>
            </div>
          )}
          {files && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">File folders</p>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Folder</th>
                      <th className="px-3 py-2 text-right font-medium">Live</th>
                      <th className="px-3 py-2 text-right font-medium">Standby</th>
                      <th className="px-3 py-2 text-right font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(bucketIssues.length ? bucketIssues : files.buckets).map((b) => {
                      const issues = b.missing + b.different + b.extra + b.metadata;
                      return (
                        <tr key={b.bucket} className="border-t border-border transition-colors duration-150 hover:bg-muted/50">
                          <td className="px-3 py-2 font-medium text-foreground">{b.bucket}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{n(b.primaryObjects)} · {formatBytes(b.primaryBytes)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{n(b.standbyObjects)} · {formatBytes(b.standbyBytes)}</td>
                          <td className={cn("px-3 py-2 text-right text-xs font-semibold", issues ? "text-warning" : "text-success")}>
                            {issues ? [b.missing && `${b.missing} missing`, b.different && `${b.different} different`, b.extra && `${b.extra} extra`, b.metadata && `${b.metadata} settings`].filter(Boolean).join(", ") : "Match"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {bucketIssues.length > 0 && <p className="mt-1.5 text-xs text-muted-foreground">Only folders with differences are shown.</p>}
              {oversized.length > 0 && (
                <div className="mt-3 rounded-lg bg-warning/10 p-3 text-xs">
                  <p className="flex items-center gap-1.5 font-semibold text-warning">
                    <AlertTriangle className="h-3.5 w-3.5" /> {oversized.length} file{oversized.length === 1 ? " is" : "s are"} larger than the standby server accepts
                  </p>
                  <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
                    {oversized.map((k) => <li key={k} className="break-all">{k}</li>)}
                  </ul>
                  <p className="mt-1.5 text-muted-foreground">Raise the upload size limit on the standby server; the next copy adds them automatically.</p>
                </div>
              )}
            </div>
          )}
          {errors.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent problems (retried automatically)</p>
              <ul className="space-y-1">
                {errors.map((e, i) => (
                  <li key={i} className="break-words rounded-md bg-muted/50 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">{e}</li>
                ))}
              </ul>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function History({ rows }: { rows: HistoryRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent runs</p>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {rows.map((h) => {
          const meta = statusMeta({ ...h, step: "", report: {} } as RunRow);
          return (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-foreground">
                  {h.kind === "verify" ? "Match check" : h.trigger === "nightly" ? "Nightly copy" : "Manual copy"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {fmtDateTime(h.created_at)}{h.finished_at ? ` · ${formatDuration(h.started_at ?? h.created_at, h.finished_at)}` : ""}
                </p>
              </div>
              <StatusPill tone={meta.tone} label={meta.label} spinning={isActive(h.status)} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function DisasterRecoveryCard() {
  const { roles } = useAuth();
  const allowed = can.manageStandbyCopy(roles);
  const queryClient = useQueryClient();

  const status = useQuery({
    queryKey: QUERY_KEY,
    enabled: allowed,
    queryFn: async (): Promise<StandbyStatus> => {
      const { data, error } = await supabase.rpc("dr_sync_status");
      if (error) throw error;
      const s = (data ?? {}) as unknown as Partial<StandbyStatus>;
      return { latest: s.latest ?? null, lastFull: s.lastFull ?? null, history: s.history ?? [] };
    },
    refetchInterval: (q) => (isActive(q.state.data?.latest?.status) ? 5_000 : 60_000),
  });

  const start = useMutation({
    mutationFn: async (kind: RunKind) => {
      const { data, error } = await supabase.rpc("dr_request_sync", { p_kind: kind });
      if (error) throw error;
      return { kind, run: data as unknown as { id: string; kind: RunKind; status: string } };
    },
    onSuccess: ({ kind, run }) => {
      const already = status.data?.latest && isActive(status.data.latest.status) && status.data.latest.id === run.id;
      if (already) toast.info("A copy is already running — showing its progress.");
      else toast.success(kind === "full" ? "Standby copy started" : "Match check started");
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (e: Error) => toast.error("Couldn't start", { description: e.message }),
  });

  if (!allowed) return null;

  const latest = status.data?.latest ?? null;
  const active = isActive(latest?.status);
  const shown = latest && !active && latest.report?.verify ? latest : status.data?.lastFull ?? null;
  const headline = statusMeta(active ? latest : shown ?? latest);
  const failedRun = latest?.status === "failed" ? latest : null;
  const fileFailures = status.data?.lastFull?.report?.storage?.failures ?? {};
  const oversized = Object.keys(fileFailures).filter((k) => /\b413\b|maximum size/i.test(fileFailures[k]));

  return (
    <Card className="overflow-hidden rounded-2xl">
      <CardContent className="space-y-5 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ServerCog className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold tracking-tight text-foreground">Standby copy</h3>
                {!status.isLoading && !status.isError && <StatusPill tone={headline.tone} label={headline.label} spinning={active} />}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                A complete second copy of the app — records, sign-in accounts, security rules and files — on your standby server.
                Refreshes automatically every night at 2:30 AM.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="outline" className="min-h-11 gap-2 hover:bg-secondary" disabled={active || start.isPending || status.isLoading} onClick={() => start.mutate("verify")}>
              <ScanSearch className="h-4 w-4" /> Check match
            </Button>
            <Button className="min-h-11 gap-2" disabled={active || start.isPending || status.isLoading} onClick={() => start.mutate("full")}>
              {start.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Copy now
            </Button>
          </div>
        </div>

        {status.isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full rounded-xl" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
            </div>
          </div>
        )}

        {status.isError && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
            <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Couldn't load the standby copy status.</span>
            <Button variant="outline" size="sm" className="min-h-11" onClick={() => status.refetch()}>Try again</Button>
          </div>
        )}

        {latest && active && <LiveProgress run={latest} />}

        {failedRun && (
          <div className="rounded-xl bg-destructive/10 p-4 text-sm">
            <p className="flex items-center gap-2 font-semibold text-destructive"><XCircle className="h-4 w-4" /> The last copy stopped ({fmtDateTime(failedRun.finished_at)})</p>
            <p className="mt-1 break-words text-xs text-muted-foreground">{failedRun.report?.fatal ?? "Unknown problem"}</p>
            <p className="mt-1 text-xs text-muted-foreground">The standby still holds the previous copy. Press “Copy now” to try again.</p>
          </div>
        )}

        {shown && <Results run={shown} oversized={oversized} />}

        {!status.isLoading && !status.isError && !latest && (
          <div className="flex flex-col items-center gap-2 rounded-xl bg-muted/40 px-4 py-8 text-center">
            <Database className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">No standby copy yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">The first copy runs tonight at 2:30 AM, or press “Copy now” to start it immediately.</p>
          </div>
        )}

        {status.data && <History rows={status.data.history} />}

        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          The standby's own scheduled jobs stay paused, so it never sends messages or changes data by itself. They are switched on only if you move to the standby.
        </p>
      </CardContent>
    </Card>
  );
}
