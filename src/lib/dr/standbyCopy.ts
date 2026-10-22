/**
 * Standby (disaster-recovery) copy — types and pure helpers for the owner card.
 * The worker (`dr-replicate`) writes these shapes into private.dr_sync_runs.report;
 * `dr_sync_status()` returns them to owners only.
 */

export type RunStatus = "queued" | "running" | "succeeded" | "drift" | "failed" | "cancelled";
export type RunKind = "full" | "verify";

export interface RowStats {
  tables: number; done: number; inSync: number; chunksCompared: number; chunksCopied: number;
  rowsWritten: number; rowsDeleted: number; failures: Record<string, string>;
}
export interface StorageStats {
  primaryObjects: number; primaryBytes: number; standbyObjects: number; copied: number; copiedBytes: number;
  removed: number; metaFixed: number; failed: number; remaining: number; failures?: Record<string, string>;
}
export interface BucketDelta {
  bucket: string; primaryObjects: number; primaryBytes: number; standbyObjects: number; standbyBytes: number;
  missing: number; different: number; extra: number; metadata: number;
}
export interface VerifyReport {
  schema?: { differences: number; summary: Record<string, number>; sample: string[] };
  tables?: { total: number; matched: number; mismatched: Array<{ table: string; primary: string; standby: string }> };
  storage?: { buckets: BucketDelta[]; objects: number; bytes: number; missing: number; different: number; extra: number; metadata: number };
  jobs?: { activeOnStandby: number; missing: number; extra: number };
  allInSync?: boolean;
  checkedAt?: string;
}
export interface SchemaReport { iterations: number; applied: number; remaining: number; failures: Array<{ key: string; error: string }> }
export interface RunReport {
  steps?: Record<string, { startedAt?: string; finishedAt?: string }>;
  pausedJobs?: number;
  schema?: SchemaReport;
  schemaFinal?: SchemaReport;
  rows?: RowStats;
  catchup?: RowStats;
  storage?: StorageStats;
  verify?: VerifyReport;
  errors?: string[];
  fatal?: string;
}
export interface RunRow {
  id: string; kind: RunKind; trigger: "nightly" | "manual"; status: RunStatus; step: string; report: RunReport;
  ticks?: number; created_at: string; started_at: string | null; heartbeat_at?: string | null; finished_at: string | null;
}
export interface HistoryRow {
  id: string; kind: RunKind; trigger: "nightly" | "manual"; status: RunStatus;
  created_at: string; started_at: string | null; finished_at: string | null; in_sync: boolean | null;
}
export interface StandbyStatus { latest: RunRow | null; lastFull: RunRow | null; history: HistoryRow[] }

export const FULL_STEPS = [
  "prepare", "schema", "rows_prep", "rows", "storage_buckets", "storage_objects",
  "rows_catchup", "schema_final", "sequences", "jobs", "verify",
] as const;

/** Plain-language step names for the owner. */
export const STEP_LABELS: Record<string, string> = {
  prepare: "Pausing the standby's own scheduled jobs",
  schema: "Copying tables, links and security rules",
  rows_prep: "Preparing the data copy",
  rows: "Copying records and sign-in accounts",
  storage_buckets: "Creating file folders",
  storage_objects: "Copying files",
  rows_catchup: "Catching up changes made during the copy",
  schema_final: "Re-linking records",
  sequences: "Aligning counters",
  jobs: "Copying scheduled jobs (kept paused)",
  verify: "Checking the copy is an exact match",
};

/** Rough share of the total time each step takes (files and records dominate). */
const STEP_WEIGHT: Record<string, number> = {
  prepare: 1, schema: 4, rows_prep: 1, rows: 30, storage_buckets: 1, storage_objects: 45,
  rows_catchup: 6, schema_final: 3, sequences: 1, jobs: 1, verify: 7,
};

export const isActive = (s?: RunStatus | null) => s === "queued" || s === "running";

/** 0–100 progress estimate for a run. */
export function runProgress(run: RunRow): number {
  if (!isActive(run.status)) return 100;
  if (run.kind === "verify") return run.status === "queued" ? 2 : 50;
  const steps = FULL_STEPS as readonly string[];
  const idx = Math.max(0, steps.indexOf(run.step));
  const total = steps.reduce((a, s) => a + (STEP_WEIGHT[s] ?? 1), 0);
  let done = steps.slice(0, idx).reduce((a, s) => a + (STEP_WEIGHT[s] ?? 1), 0);
  const w = STEP_WEIGHT[run.step] ?? 1;
  const r = run.report;
  let frac = 0;
  if (run.step === "rows" && r.rows?.tables) frac = r.rows.done / r.rows.tables;
  else if (run.step === "rows_catchup" && r.catchup?.tables) frac = r.catchup.done / r.catchup.tables;
  else if (run.step === "storage_objects" && r.storage) {
    const all = r.storage.copied + r.storage.remaining;
    frac = all > 0 ? r.storage.copied / all : 0;
  }
  done += w * Math.min(1, Math.max(0, frac));
  return Math.max(2, Math.min(99, Math.round((done / total) * 100)));
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 1024) return `${Math.max(0, Math.round(n || 0))} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDuration(fromIso: string | null | undefined, toIso: string | null | undefined): string {
  if (!fromIso || !toIso) return "—";
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const m = Math.round(ms / 60000);
  if (m < 1) return "under a minute";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Friendly table name: "public.whatsapp_chat_settings" -> "Whatsapp chat settings". */
export function friendlyTable(qualified: string): string {
  const [schema, name] = qualified.includes(".") ? qualified.split(".", 2) : ["public", qualified];
  const base = name.replace(/_/g, " ");
  const label = base.charAt(0).toUpperCase() + base.slice(1);
  if (schema === "auth") return `Sign-in: ${label}`;
  if (schema === "storage") return `Files: ${label}`;
  return label;
}

export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

export function statusMeta(run: RunRow | null): { label: string; tone: Tone } {
  if (!run) return { label: "No copy yet", tone: "neutral" };
  switch (run.status) {
    case "queued": return { label: "Starting", tone: "info" };
    case "running": return { label: run.kind === "verify" ? "Checking" : "Copying", tone: "info" };
    case "succeeded": return { label: "Exact match", tone: "success" };
    case "drift": return { label: "Small differences", tone: "warning" };
    case "failed": return { label: "Failed", tone: "danger" };
    default: return { label: "Cancelled", tone: "neutral" };
  }
}
