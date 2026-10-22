// v2.0.0 — Scheduled jobs, queues and counters on the standby.
//
// The standby is a cold copy: every scheduled job is mirrored by name/schedule/command
// but kept PAUSED there, otherwise its jobs would rewrite the copy (auto-close
// attendance, membership activation) or call live functions. Enable them only after
// a real failover.

import { type Sql, readJson } from "./primary.ts";
import { lit, qn, textArray } from "./sqlText.ts";
import type { Standby } from "./standby.ts";

interface Job { id: number; name: string | null; schedule: string; command: string; active: boolean }

const JOBS_SQL = `SELECT coalesce(json_agg(json_build_object('id', jobid, 'name', jobname, 'schedule', schedule,
  'command', command, 'active', active) ORDER BY jobid), '[]'::json)::text FROM cron.job`;

const jobName = (j: Job) => j.name ?? `primary-job-${j.id}`;

export async function standbyJobs(standby: Standby): Promise<Job[]> {
  return JSON.parse((await standby.one(JOBS_SQL)) ?? "[]") as Job[];
}

/** Pause every active standby job. Returns how many were paused. */
export async function pauseStandbyJobs(standby: Standby): Promise<number> {
  const active = (await standbyJobs(standby)).filter((j) => j.active);
  if (active.length) await standby.run(active.map((j) => `SELECT cron.alter_job(${j.id}, active := false)::text`));
  return active.length;
}

export interface JobPlan { schedule: string[]; unschedule: string[] }

/** Pure: statements that make standby job definitions equal to the primary's. */
export function planJobs(primary: Job[], standby: Job[]): JobPlan {
  const s = new Map(standby.map((j) => [jobName(j), j]));
  const pNames = new Set(primary.map(jobName));
  const plan: JobPlan = { schedule: [], unschedule: [] };
  for (const j of primary) {
    const cur = s.get(jobName(j));
    if (!cur || cur.schedule !== j.schedule || cur.command !== j.command) {
      plan.schedule.push(`SELECT cron.schedule(${lit(jobName(j))}, ${lit(j.schedule)}, ${lit(j.command)})::text`);
    }
  }
  for (const j of standby) if (!pNames.has(jobName(j))) plan.unschedule.push(`SELECT cron.unschedule(${j.id})::text`);
  return plan;
}

export interface JobStats { primaryJobs: number; scheduled: number; removed: number; activeOnStandby: number; queuesCreated: number }

export async function mirrorJobs(primary: Sql, standby: Standby): Promise<JobStats> {
  const p = await readJson<Job[]>(primary, JOBS_SQL);
  const plan = planJobs(p, await standbyJobs(standby));
  for (let i = 0; i < plan.schedule.length; i += 25) await standby.run(plan.schedule.slice(i, i + 25));
  for (let i = 0; i < plan.unschedule.length; i += 25) await standby.run(plan.unschedule.slice(i, i + 25));
  await pauseStandbyJobs(standby);
  const after = await standbyJobs(standby);

  // pgmq queues (definitions only — queued messages are transient work items).
  const qSql = `SELECT coalesce(json_agg(json_build_object('n', queue_name, 'u', is_unlogged) ORDER BY queue_name), '[]'::json)::text FROM pgmq.meta`;
  const pq = await readJson<Array<{ n: string; u: boolean }>>(primary, qSql);
  const sq = new Set((JSON.parse((await standby.one(qSql)) ?? "[]") as Array<{ n: string }>).map((q) => q.n));
  const missing = pq.filter((q) => !sq.has(q.n));
  if (missing.length) {
    await standby.run(missing.map((q) => `SELECT pgmq.${q.u ? "create_unlogged" : "create"}(${lit(q.n)})::text`));
  }
  return {
    primaryJobs: p.length,
    scheduled: plan.schedule.length,
    removed: plan.unschedule.length,
    activeOnStandby: after.filter((j) => j.active).length,
    queuesCreated: missing.length,
  };
}

/** Counters: standby sequences continue exactly where the primary's are. */
export async function syncSequences(primary: Sql, standby: Standby, schemas: string[]): Promise<{ synced: number; failed: string[] }> {
  const rows = await readJson<Array<{ s: string; n: string; v: string | null; start: string }>>(primary,
    `SELECT coalesce(json_agg(json_build_object('s', schemaname, 'n', sequencename, 'v', last_value::text, 'start', start_value::text)), '[]'::json)::text
     FROM pg_sequences WHERE schemaname = ANY(${textArray(schemas)})`);
  const stmts = rows.map((r) =>
    `SELECT setval(${lit(qn(r.s, r.n))}::regclass, ${r.v ?? r.start}, ${r.v == null ? "false" : "true"})::text`);
  const failed: string[] = [];
  for (let i = 0; i < stmts.length; i += 50) {
    const group = stmts.slice(i, i + 50);
    try { await standby.run(group); }
    catch {
      for (let k = 0; k < group.length; k++) {
        try { await standby.run([group[k]]); } catch (e) { failed.push(`${rows[i + k].s}.${rows[i + k].n}: ${(e as Error).message.slice(0, 120)}`); }
      }
    }
  }
  return { synced: stmts.length - failed.length, failed };
}
