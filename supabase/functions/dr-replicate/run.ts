// v2.0.0 — DR copy orchestrator: a resumable state machine stored in private.dr_sync_runs.
//
// Each worker call ("tick") claims the active run with a short lease, advances it step
// by step until its time budget is used, saves progress and releases the lease. Every
// step is idempotent (re-derived from the live state of both sides), so a killed worker
// or a network error simply resumes on the next tick.

import {
  loadModeDrops, MIRROR_SCHEMAS, type PlanStep, planSchema, snapshotSql, type Snapshot, summarizePlan,
} from "./catalog.ts";
import { JOBS_SQL, type JobStats, mirrorJobs, pauseStandbyJobs, planJobs, standbyJobs, syncSequences } from "./jobs.ts";
import { type Sql, readJson } from "./primary.ts";
import { compareTables, emptyRowStats, loadSpecs, type RowStats, syncTables } from "./rows.ts";
import type { Standby } from "./standby.ts";
import { cleanExtraBuckets, listObjects, planObjects, type StorageState, type StorageStats, syncObjects } from "./storage.ts";

export const AUTH_TABLES = ["auth.users", "auth.identities", "auth.mfa_factors", "auth.audit_log_entries"];

export const FULL_STEPS = [
  "prepare", "schema", "rows_prep", "rows", "storage_buckets", "storage_objects",
  "rows_catchup", "schema_final", "sequences", "jobs", "verify",
] as const;
export type StepName = (typeof FULL_STEPS)[number];

export interface Env {
  primary: Sql;
  standby: Standby;
  primaryUrl: string;
  serviceKey: string;
  /** Re-installs the standby helper functions (direct connection, code only). */
  bootstrap: () => Promise<void>;
}

interface SchemaReport {
  iterations: number;
  applied: number;
  remaining: number;
  failures: Array<{ key: string; error: string }>;
  summary?: Record<string, number>;
}

interface BucketDelta {
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

interface Report {
  steps: Record<string, { startedAt?: string; finishedAt?: string }>;
  helpersInstalled?: boolean;
  pausedJobs?: number;
  schema?: SchemaReport;
  schemaFinal?: SchemaReport;
  fkDropped?: number;
  rows?: RowStats;
  catchup?: RowStats;
  buckets?: { removed: string[]; rows: RowStats };
  storage?: StorageStats & { failures: Record<string, string> };
  sequences?: { synced: number; failed: string[] };
  jobs?: JobStats;
  verify?: VerifyReport;
  errors: string[];
  fatal?: string;
}

interface State {
  schema?: { iterations: number };
  schemaFinal?: { iterations: number };
  rows?: { idx: number; stats: RowStats };
  catchup?: { idx: number; stats: RowStats };
  storage?: StorageState;
  storageStats?: StorageStats;
  verify?: {
    phase: "schema" | "tables" | "catchup" | "storage" | "jobs" | "done";
    idx: number;
    mismatches: Record<string, { primary: string; standby: string }>;
    rechecked?: boolean;
  };
  stepErrors?: Record<string, number>;
}

interface Run {
  id: string;
  kind: "full" | "verify";
  step: string;
  state: State;
  report: Report;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 400);

// ── Schema apply ──────────────────────────────────────────────────────────────

export async function applyPlan(
  standby: Standby,
  steps: PlanStep[],
  deadline: number,
): Promise<{ applied: number; failures: Array<{ key: string; error: string }>; timedOut: boolean }> {
  const failures: Array<{ key: string; error: string }> = [];
  let applied = 0;
  let i = 0;
  while (i < steps.length) {
    if (deadline - Date.now() < 10_000) return { applied, failures, timedOut: true };
    const batch: PlanStep[] = [];
    if (steps[i].solo) batch.push(steps[i]);
    else while (i + batch.length < steps.length && !steps[i + batch.length].solo && batch.length < 25) batch.push(steps[i + batch.length]);
    i += batch.length;
    try {
      await standby.run(batch.flatMap((s) => s.sql));
      applied += batch.length;
      continue;
    } catch { /* isolate below */ }
    for (const st of batch) {
      try {
        await standby.run(st.sql);
        applied++;
      } catch (e) {
        if (st.fallback) {
          try { await standby.run(st.fallback); applied++; continue; } catch (e2) { failures.push({ key: st.key, error: msg(e2) }); continue; }
        }
        failures.push({ key: st.key, error: msg(e) });
      }
    }
  }
  return { applied, failures, timedOut: false };
}

async function snapshots(env: Env): Promise<{ p: Snapshot; s: Snapshot }> {
  const p = await readJson<Snapshot>(env.primary, snapshotSql());
  const s = JSON.parse((await env.standby.one(snapshotSql())) ?? "null") as Snapshot;
  return { p, s };
}

async function schemaStep(env: Env, run: Run, deadline: number, final: boolean): Promise<boolean> {
  const key = final ? "schemaFinal" : "schema";
  const st = (run.state[key] ??= { iterations: 0 });
  const rep: SchemaReport = (run.report[key] ??= { iterations: 0, applied: 0, remaining: 0, failures: [] });
  const p = await readJson<Snapshot>(env.primary, snapshotSql());
  while (true) {
    if (deadline - Date.now() < 20_000) return false;
    const s = JSON.parse((await env.standby.one(snapshotSql())) ?? "null") as Snapshot;
    const plan = planSchema(p, s, { includeDeferred: final });
    rep.remaining = plan.length;
    rep.summary = summarizePlan(plan);
    if (!plan.length) { rep.failures = []; return true; }
    if (st.iterations >= 5) return true; // leftovers stay in the report and the verify diff
    st.iterations++;
    rep.iterations = st.iterations;
    const res = await applyPlan(env.standby, plan, deadline);
    rep.applied += res.applied;
    rep.failures = res.failures.slice(0, 60);
    if (res.timedOut) return false;
    if (res.applied === 0) return true;
  }
}

// ── Steps ─────────────────────────────────────────────────────────────────────

async function rowsStep(env: Env, run: Run, deadline: number, key: "rows" | "catchup"): Promise<boolean> {
  const { specs, missingOnStandby } = await loadSpecs(env.primary, env.standby, MIRROR_SCHEMAS, AUTH_TABLES);
  const st = (run.state[key] ??= { idx: 0, stats: emptyRowStats(specs.length) });
  st.stats.tables = specs.length;
  for (const m of missingOnStandby) st.stats.failures[m] = "table missing on standby";
  st.idx = await syncTables({ primary: env.primary, standby: env.standby, deadline }, specs, st.idx, st.stats);
  run.report[key] = st.stats;
  return st.idx >= specs.length;
}

async function verifyStep(env: Env, run: Run, deadline: number): Promise<boolean> {
  const v = (run.state.verify ??= { phase: "schema", idx: 0, mismatches: {} });
  const rep: VerifyReport = (run.report.verify ??= {});
  const ctx = { primary: env.primary, standby: env.standby, deadline };
  const specsFor = async () =>
    (await loadSpecs(env.primary, env.standby, MIRROR_SCHEMAS, [...AUTH_TABLES, "storage.buckets"])).specs;
  while (true) {
    if (deadline - Date.now() < 15_000) return false;
    if (v.phase === "schema") {
      const { p, s } = await snapshots(env);
      const plan = planSchema(p, s, { includeDeferred: true });
      rep.schema = { differences: plan.length, summary: summarizePlan(plan), sample: plan.slice(0, 40).map((x) => x.key) };
      v.phase = "tables";
      v.idx = 0;
      v.mismatches = {};
    } else if (v.phase === "tables") {
      const specs = await specsFor();
      v.idx = await compareTables(ctx, specs, v.idx, v.mismatches);
      if (v.idx < specs.length) return false;
      rep.tables = {
        total: specs.length,
        matched: specs.length - Object.keys(v.mismatches).length,
        mismatched: Object.entries(v.mismatches).map(([table, h]) => ({ table, ...h })),
      };
      v.phase = run.kind === "full" && Object.keys(v.mismatches).length && !v.rechecked ? "catchup" : "storage";
    } else if (v.phase === "catchup") {
      // Rows written on the primary during the copy: copy just those tables again, re-check.
      const specs = (await specsFor()).filter((s) => v.mismatches[`${s.schema}.${s.name}`]);
      const stats = emptyRowStats(specs.length);
      const idx = await syncTables(ctx, specs, 0, stats);
      if (idx < specs.length) return false;
      await compareTables(ctx, specs, 0, v.mismatches);
      v.rechecked = true;
      const total = rep.tables?.total ?? specs.length;
      rep.tables = {
        total,
        matched: total - Object.keys(v.mismatches).length,
        mismatched: Object.entries(v.mismatches).map(([table, h]) => ({ table, ...h })),
      };
      v.phase = "storage";
    } else if (v.phase === "storage") {
      const { p, s } = await listObjects(env);
      const plan = planObjects(p, s);
      const buckets = new Map<string, BucketDelta>();
      const b = (id: string) => {
        let d = buckets.get(id);
        if (!d) {
          d = { bucket: id, primaryObjects: 0, primaryBytes: 0, standbyObjects: 0, standbyBytes: 0, missing: 0, different: 0, extra: 0, metadata: 0 };
          buckets.set(id, d);
        }
        return d;
      };
      for (const o of p) { b(o.b).primaryObjects++; b(o.b).primaryBytes += Number(o.s); }
      for (const o of s) { b(o.b).standbyObjects++; b(o.b).standbyBytes += Number(o.s); }
      const sKeys = new Set(s.map((o) => `${o.b}/${o.n}`));
      for (const o of plan.copy) sKeys.has(`${o.b}/${o.n}`) ? b(o.b).different++ : b(o.b).missing++;
      for (const o of plan.remove) b(o.b).extra++;
      for (const o of plan.fixMeta) b(o.b).metadata++;
      const list = [...buckets.values()].sort((x, y) => x.bucket.localeCompare(y.bucket));
      rep.storage = {
        buckets: list,
        objects: p.length,
        bytes: p.reduce((a, o) => a + Number(o.s), 0),
        missing: list.reduce((a, d) => a + d.missing, 0),
        different: list.reduce((a, d) => a + d.different, 0),
        extra: list.reduce((a, d) => a + d.extra, 0),
        metadata: list.reduce((a, d) => a + d.metadata, 0),
      };
      v.phase = "jobs";
    } else if (v.phase === "jobs") {
      const sj = await standbyJobs(env.standby);
      const pj = await readJson<Parameters<typeof planJobs>[0]>(env.primary, JOBS_SQL);
      const plan = planJobs(pj, sj);
      rep.jobs = { activeOnStandby: sj.filter((j) => j.active).length, missing: plan.schedule.length, extra: plan.unschedule.length };
      v.phase = "done";
    } else {
      rep.allInSync =
        (rep.schema?.differences ?? 1) === 0 &&
        (rep.tables?.mismatched.length ?? 1) === 0 &&
        !!rep.storage && rep.storage.missing + rep.storage.different + rep.storage.extra + rep.storage.metadata === 0 &&
        !!rep.jobs && rep.jobs.activeOnStandby === 0 && rep.jobs.missing === 0 && rep.jobs.extra === 0;
      rep.checkedAt = new Date().toISOString();
      return true;
    }
  }
}

async function runStep(step: string, env: Env, run: Run, deadline: number, persist: () => Promise<void>): Promise<boolean> {
  switch (step) {
    case "prepare": {
      if (!(await env.standby.helpersReady())) {
        await env.bootstrap();
        run.report.helpersInstalled = true;
      }
      // Safety first: nothing on the standby may run on its own once live config is copied.
      run.report.pausedJobs = await pauseStandbyJobs(env.standby);
      return true;
    }
    case "schema":
      return await schemaStep(env, run, deadline, false);
    case "rows_prep": {
      const { p, s } = await snapshots(env);
      const drops = loadModeDrops(p, s);
      for (let i = 0; i < drops.length; i += 50) {
        if (deadline - Date.now() < 10_000) return false;
        await env.standby.run(drops.slice(i, i + 50));
      }
      run.report.fkDropped = (run.report.fkDropped ?? 0) + drops.length;
      return true;
    }
    case "rows":
      return await rowsStep(env, run, deadline, "rows");
    case "storage_buckets": {
      const removed = await cleanExtraBuckets(env);
      const { specs } = await loadSpecs(env.primary, env.standby, [], ["storage.buckets"]);
      const stats = emptyRowStats(specs.length);
      const idx = await syncTables({ primary: env.primary, standby: env.standby, deadline }, specs, 0, stats);
      run.report.buckets = { removed: [...(run.report.buckets?.removed ?? []), ...removed], rows: stats };
      return idx >= specs.length;
    }
    case "storage_objects": {
      const st = (run.state.storage ??= { attempts: {}, tus: {}, failures: {} });
      const stats = (run.state.storageStats ??= {
        primaryObjects: 0, primaryBytes: 0, standbyObjects: 0, copied: 0, copiedBytes: 0, removed: 0, metaFixed: 0, failed: 0, remaining: 0,
      });
      const done = await syncObjects({ ...env, deadline, persist }, st, stats);
      run.report.storage = { ...stats, failures: st.failures };
      return done;
    }
    case "rows_catchup":
      return await rowsStep(env, run, deadline, "catchup");
    case "schema_final":
      return await schemaStep(env, run, deadline, true);
    case "sequences":
      run.report.sequences = await syncSequences(env.primary, env.standby, MIRROR_SCHEMAS);
      return true;
    case "jobs":
      run.report.jobs = await mirrorJobs(env.primary, env.standby);
      return true;
    case "verify":
      return await verifyStep(env, run, deadline);
    default:
      throw new Error(`unknown step ${step}`);
  }
}

// ── Tick ──────────────────────────────────────────────────────────────────────

export interface TickResult {
  state: "idle" | "busy" | "progress" | "finished" | "failed";
  runId?: string;
  step?: string;
  status?: string;
  ms: number;
}

export async function tick(env: Env, budgetMs: number): Promise<TickResult> {
  const started = Date.now();
  const deadline = started + budgetMs;
  const sql = env.primary;

  await sql.unsafe(`UPDATE private.dr_sync_runs
      SET status = 'failed', finished_at = now(), lease_until = NULL,
          report = report || jsonb_build_object('fatal', 'Stopped: the copy did not finish within 6 hours')
    WHERE status IN ('queued','running') AND created_at < now() - interval '6 hours'`);

  const claimed = await sql.unsafe(`UPDATE private.dr_sync_runs r
      SET status = 'running', started_at = coalesce(r.started_at, now()), heartbeat_at = now(),
          lease_until = now() + interval '170 seconds', ticks = r.ticks + 1
    WHERE r.id = (SELECT id FROM private.dr_sync_runs WHERE status IN ('queued','running') ORDER BY created_at LIMIT 1)
      AND (r.lease_until IS NULL OR r.lease_until < now())
    RETURNING r.id::text AS id, r.kind, r.step, r.state::text AS state, r.report::text AS report`);
  if (!claimed.length) {
    const [{ n }] = await sql.unsafe(`SELECT count(*)::int AS n FROM private.dr_sync_runs WHERE status IN ('queued','running')`);
    return { state: Number(n) > 0 ? "busy" : "idle", ms: Date.now() - started };
  }
  const row = claimed[0] as Record<string, string>;
  const run: Run = {
    id: row.id,
    kind: row.kind === "verify" ? "verify" : "full",
    step: row.step,
    state: JSON.parse(row.state || "{}") as State,
    report: JSON.parse(row.report || "{}") as Report,
  };
  run.report.errors ??= [];
  run.report.steps ??= {};
  const steps: readonly string[] = run.kind === "verify" ? ["verify"] : FULL_STEPS;
  if (!steps.includes(run.step)) run.step = steps[0];

  const persist = async () => {
    await sql.unsafe(
      `UPDATE private.dr_sync_runs SET step = $1, state = $2::text::jsonb, report = $3::text::jsonb,
              heartbeat_at = now(), lease_until = now() + interval '170 seconds' WHERE id = $4::uuid`,
      [run.step, JSON.stringify(run.state), JSON.stringify(run.report), run.id],
    );
  };
  const finish = async (status: string) => {
    await sql.unsafe(
      `UPDATE private.dr_sync_runs SET status = $1, step = $2, state = $3::text::jsonb, report = $4::text::jsonb,
              finished_at = now(), heartbeat_at = now(), lease_until = NULL WHERE id = $5::uuid`,
      [status, run.step, JSON.stringify(run.state), JSON.stringify(run.report), run.id],
    );
  };

  try {
    while (deadline - Date.now() > 5_000) {
      const step = run.step;
      run.report.steps[step] ??= { startedAt: new Date().toISOString() };
      let done = false;
      try {
        done = await runStep(step, env, run, deadline, persist);
        if (run.state.stepErrors?.[step]) run.state.stepErrors[step] = 0;
      } catch (e) {
        const errors = (run.state.stepErrors ??= {});
        errors[step] = (errors[step] ?? 0) + 1;
        run.report.errors = [...run.report.errors, `${new Date().toISOString()} ${step}: ${msg(e)}`].slice(-50);
        await logError(sql, errors[step] >= 5 ? "error" : "warning", `DR copy step ${step} failed: ${msg(e)}`, run.id);
        if (errors[step] >= 5) {
          run.report.fatal = `Step "${step}" failed 5 times in a row: ${msg(e)}`;
          await finish("failed");
          return { state: "failed", runId: run.id, step, status: "failed", ms: Date.now() - started };
        }
        await persist();
        break; // retry on the next tick
      }
      if (!done) { await persist(); break; }
      run.report.steps[step].finishedAt = new Date().toISOString();
      const next = steps[steps.indexOf(step) + 1];
      if (!next) {
        const status = run.report.verify?.allInSync ? "succeeded" : "drift";
        await finish(status);
        if (status === "drift") await logError(sql, "warning", "DR copy finished with differences between live and standby", run.id);
        return { state: "finished", runId: run.id, step, status, ms: Date.now() - started };
      }
      run.step = next;
      await persist();
    }
  } finally {
    await sql.unsafe(`UPDATE private.dr_sync_runs SET lease_until = NULL WHERE id = $1::uuid AND status = 'running'`, [run.id]);
  }
  return { state: "progress", runId: run.id, step: run.step, status: "running", ms: Date.now() - started };
}

async function logError(sql: Sql, severity: string, message: string, runId: string): Promise<void> {
  try {
    await sql.unsafe(
      `SELECT public.log_error_event(p_severity => $1, p_source => 'edge', p_message => $2, p_function_name => 'dr-replicate',
         p_route => NULL, p_table_name => 'dr_sync_runs', p_branch_id => NULL, p_user_id => NULL, p_request_id => $3,
         p_release_sha => NULL, p_stack => NULL, p_context => jsonb_build_object('run_id', $3))`,
      [severity, message.slice(0, 900), runId],
    );
  } catch (e) {
    console.error("log_error_event failed", msg(e));
  }
}
