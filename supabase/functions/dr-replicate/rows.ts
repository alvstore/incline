// v2.0.0 — Row mirror: chunk fingerprints over the primary key, copy only what differs.
//
// For every table the primary key space is cut into consecutive half-open ranges
// (lo, hi] (first range unbounded below, last unbounded above). Each range is
// fingerprinted on both sides with md5 over the same explicit column list; only ranges
// whose fingerprints differ are copied, and dr_mirror_replace makes the standby range
// identical (rows missing on the primary are deleted, others upserted). Resumable: a
// table is simply re-planned next run and already-matching ranges are skipped.

import { type Sql, readJson, readOne } from "./primary.ts";
import { type PkCol, qi, qn, rangePredicate, rowHashExpr, textArray } from "./sqlText.ts";
import type { Standby } from "./standby.ts";

export interface TableSpec {
  schema: string;
  name: string;
  /** Non-generated columns present on both sides, primary column order. */
  cols: string[];
  pk: PkCol[];
  bytes: number;
  tuples: number;
}

interface RawSpec { schema: string; name: string; cols: string[]; pk: PkCol[]; bytes: number; tuples: number }

export interface RowStats {
  tables: number;
  done: number;
  inSync: number;
  chunksCompared: number;
  chunksCopied: number;
  rowsWritten: number;
  rowsDeleted: number;
  failures: Record<string, string>;
}

export const emptyRowStats = (tables: number): RowStats => ({
  tables, done: 0, inSync: 0, chunksCompared: 0, chunksCopied: 0, rowsWritten: 0, rowsDeleted: 0, failures: {},
});

/** On-disk bytes per chunk; JSON in transit is typically 1–3× this. */
export const TARGET_CHUNK_BYTES = 900_000;

export function chunkRowCount(bytes: number, tuples: number): number {
  if (!tuples || tuples <= 0) return 1000;
  const avg = Math.max(1, bytes / tuples);
  return Math.max(20, Math.min(5000, Math.floor(TARGET_CHUNK_BYTES / avg)));
}

export function specSql(schemas: string[], extra: string[]): string {
  return `SELECT coalesce(json_agg(json_build_object(
    'schema', n.nspname, 'name', c.relname,
    'cols', (SELECT coalesce(json_agg(a.attname ORDER BY a.attnum), '[]'::json) FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''),
    'pk', (SELECT coalesce(json_agg(json_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
              'collatable', a.attcollation <> 0) ORDER BY k.ord), '[]'::json)
            FROM pg_constraint pc CROSS JOIN LATERAL unnest(pc.conkey) WITH ORDINALITY k(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = pc.conrelid AND a.attnum = k.attnum
            WHERE pc.conrelid = c.oid AND pc.contype = 'p'),
    'bytes', pg_table_size(c.oid), 'tuples', greatest(c.reltuples, 0)::bigint
  ) ORDER BY n.nspname, c.relname), '[]'::json)::text
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r','p') AND (n.nspname = ANY(${textArray(schemas)}) OR (n.nspname || '.' || c.relname) = ANY(${textArray(extra)}))`;
}

/** Table specs from both sides: column intersection, primary key from the primary. */
export async function loadSpecs(
  primary: Sql,
  standby: Standby,
  schemas: string[],
  extra: string[],
): Promise<{ specs: TableSpec[]; missingOnStandby: string[] }> {
  const q = specSql(schemas, extra);
  const p = await readJson<RawSpec[]>(primary, q);
  const s = JSON.parse((await standby.one(q)) ?? "[]") as RawSpec[];
  const sMap = new Map(s.map((t) => [`${t.schema}.${t.name}`, t]));
  const specs: TableSpec[] = [];
  const missingOnStandby: string[] = [];
  for (const t of p) {
    const key = `${t.schema}.${t.name}`;
    const st = sMap.get(key);
    if (!st) { missingOnStandby.push(key); continue; }
    const have = new Set(st.cols);
    specs.push({ ...t, cols: t.cols.filter((c) => have.has(c)), bytes: Number(t.bytes), tuples: Number(t.tuples) });
  }
  // Extra tables (auth) first in the given order, then the rest alphabetically.
  const rank = (s: TableSpec) => {
    const i = extra.indexOf(`${s.schema}.${s.name}`);
    return i < 0 ? extra.length : i;
  };
  specs.sort((a, b) => rank(a) - rank(b) || `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`));
  return { specs, missingOnStandby };
}

const keyOrder = (pk: PkCol[], alias: string) =>
  pk.map((c) => `${alias}.${qi(c.name)}${c.collatable ? ' COLLATE "C"' : ""}`).join(", ");

/** Primary: all chunk fingerprints of a table in one pass. */
export function chunkPlanSql(spec: TableSpec, perChunk: number): string {
  const keys = spec.pk.map((c) => `t.${qi(c.name)}::text`).join(", ");
  return `WITH r AS (
  SELECT json_build_array(${keys})::text AS k, ${rowHashExpr(spec.cols)} AS h,
         row_number() OVER (ORDER BY ${keyOrder(spec.pk, "t")}) - 1 AS rn
  FROM ${qn(spec.schema, spec.name)} t)
SELECT coalesce(json_agg(json_build_object('n', c.n, 'h', c.h, 'hi', c.hi) ORDER BY c.chunk), '[]')::text
FROM (SELECT rn / ${perChunk} AS chunk, count(*) AS n, md5(string_agg(h, '' ORDER BY rn)) AS h,
             (array_agg(k ORDER BY rn DESC))[1] AS hi
      FROM r GROUP BY rn / ${perChunk}) c`;
}

/** Fingerprint "count:md5" of one key range (or the whole table when lo/hi are null). */
export function rangeHashSql(spec: TableSpec, lo: string[] | null, hi: string[] | null): string {
  const rel = qn(spec.schema, spec.name);
  if (!spec.pk.length) {
    return `SELECT count(*)::text || ':' || coalesce(md5(string_agg(x.h, '' ORDER BY x.h COLLATE "C")), '') FROM (SELECT ${rowHashExpr(spec.cols)} AS h FROM ${rel} t) x`;
  }
  const keys = spec.pk.map((c) => `t.${qi(c.name)}`).join(", ");
  return `SELECT count(*)::text || ':' || coalesce(md5(string_agg(x.h, '' ORDER BY ${keyOrder(spec.pk, "x")})), '') FROM (SELECT ${keys}, ${rowHashExpr(spec.cols)} AS h FROM ${rel} t WHERE ${rangePredicate(spec.pk, lo, hi)}) x`;
}

/** Primary: the rows of one key range as a JSON array. */
export function rowsSql(spec: TableSpec, lo: string[] | null, hi: string[] | null): string {
  const cols = spec.cols.map((c) => `t.${qi(c)}`).join(", ");
  const order = spec.pk.length ? ` ORDER BY ${keyOrder(spec.pk, "x")}` : "";
  return `SELECT coalesce(json_agg(x${order}), '[]')::text FROM (SELECT ${cols} FROM ${qn(spec.schema, spec.name)} t WHERE ${rangePredicate(spec.pk, lo, hi)}) x`;
}

interface ChunkPlan { n: number; h: string; lo: string[] | null; hi: string[] | null }

async function planTable(primary: Sql, spec: TableSpec): Promise<ChunkPlan[]> {
  if (!spec.pk.length) {
    const fp = (await readOne(primary, rangeHashSql(spec, null, null))) ?? "0:";
    const [n, h] = fp.split(":");
    return [{ n: Number(n), h, lo: null, hi: null }];
  }
  const raw = await readJson<Array<{ n: number; h: string; hi: string }>>(primary, chunkPlanSql(spec, chunkRowCount(spec.bytes, spec.tuples)));
  if (!raw.length) return [{ n: 0, h: "", lo: null, hi: null }];
  return raw.map((c, i) => ({
    n: Number(c.n),
    h: c.h,
    lo: i === 0 ? null : (JSON.parse(raw[i - 1].hi) as string[]),
    hi: i === raw.length - 1 ? null : (JSON.parse(c.hi) as string[]),
  }));
}

/** Standby fingerprints for many statements, isolating a failing table if a batch fails. */
async function standbyHashes(standby: Standby, items: Array<{ table: string; sql: string }>): Promise<Map<number, string | Error>> {
  const out = new Map<number, string | Error>();
  for (let i = 0; i < items.length; i += 40) {
    const group = items.slice(i, i + 40);
    try {
      const res = await standby.run(group.map((g) => g.sql));
      res.forEach((r, j) => out.set(i + j, r ?? "0:"));
    } catch {
      for (let j = 0; j < group.length; j++) {
        try { out.set(i + j, (await standby.one(group[j].sql)) ?? "0:"); }
        catch (e) { out.set(i + j, e as Error); }
      }
    }
  }
  return out;
}

export interface SyncContext {
  primary: Sql;
  standby: Standby;
  deadline: number;
}

/**
 * Process tables from `start` until done or the deadline. Returns the index of the first
 * table not finished (== specs.length when complete).
 */
export async function syncTables(ctx: SyncContext, specs: TableSpec[], start: number, stats: RowStats): Promise<number> {
  let i = start;
  while (i < specs.length && Date.now() < ctx.deadline) {
    // Batch small tables so one standby round trip fingerprints many of them.
    const batch: Array<{ spec: TableSpec; plan: ChunkPlan[] }> = [];
    let chunks = 0;
    while (i + batch.length < specs.length && batch.length < 25 && chunks < 60 && Date.now() < ctx.deadline) {
      const spec = specs[i + batch.length];
      try {
        const plan = await planTable(ctx.primary, spec);
        batch.push({ spec, plan });
        chunks += plan.length;
      } catch (e) {
        batch.push({ spec, plan: [] });
        stats.failures[`${spec.schema}.${spec.name}`] = `plan: ${(e as Error).message}`.slice(0, 300);
      }
    }
    const items: Array<{ table: string; sql: string }> = [];
    const index: Array<{ b: number; c: number }> = [];
    batch.forEach((t, b) => t.plan.forEach((c, ci) => {
      items.push({ table: `${t.spec.schema}.${t.spec.name}`, sql: rangeHashSql(t.spec, c.lo, c.hi) });
      index.push({ b, c: ci });
    }));
    const hashes = await standbyHashes(ctx.standby, items);
    const perTable = batch.map(() => [] as Array<string | Error>);
    index.forEach((ix, k) => { perTable[ix.b][ix.c] = hashes.get(k)!; });

    for (let b = 0; b < batch.length; b++) {
      const { spec, plan } = batch[b];
      const key = `${spec.schema}.${spec.name}`;
      if (!plan.length) { stats.done++; i++; continue; } // planning failed, recorded above
      let copied = 0;
      let failed = false;
      for (let c = 0; c < plan.length; c++) {
        if (Date.now() >= ctx.deadline) return i; // resume this table next run
        const chunk = plan[c];
        const got = perTable[b][c];
        stats.chunksCompared++;
        if (typeof got === "string" && got === `${chunk.n}:${chunk.h}`) continue;
        try {
          const rows = (await readOne(ctx.primary, rowsSql(spec, chunk.lo, chunk.hi))) ?? "[]";
          // Storage tables refuse direct deletes; standby-only buckets are removed via the Storage API first.
          const res = await ctx.standby.replace(qn(spec.schema, spec.name), spec.cols, spec.pk.map((p) => p.name),
            rangePredicate(spec.pk, chunk.lo, chunk.hi), rows, spec.schema !== "storage");
          stats.chunksCopied++;
          stats.rowsWritten += res.written;
          stats.rowsDeleted += res.deleted;
          copied++;
        } catch (e) {
          failed = true;
          stats.failures[key] = (e as Error).message.slice(0, 300);
        }
      }
      if (!failed) delete stats.failures[key];
      if (!copied && !failed) stats.inSync++;
      stats.done++;
      i++;
    }
  }
  return i;
}

/** Whole-table fingerprints on both sides (verification). */
export async function compareTables(
  ctx: SyncContext,
  specs: TableSpec[],
  start: number,
  mismatches: Record<string, { primary: string; standby: string }>,
): Promise<number> {
  let i = start;
  while (i < specs.length && Date.now() < ctx.deadline) {
    const batch = specs.slice(i, i + 30);
    const pHashes: string[] = [];
    for (const spec of batch) pHashes.push((await readOne(ctx.primary, rangeHashSql(spec, null, null))) ?? "0:");
    const sHashes = await standbyHashes(ctx.standby, batch.map((s) => ({ table: `${s.schema}.${s.name}`, sql: rangeHashSql(s, null, null) })));
    batch.forEach((spec, k) => {
      const key = `${spec.schema}.${spec.name}`;
      const sh = sHashes.get(k);
      const sv = sh instanceof Error ? `error: ${sh.message.slice(0, 120)}` : String(sh);
      if (sv !== pHashes[k]) mismatches[key] = { primary: pHashes[k], standby: sv };
      else delete mismatches[key];
    });
    i += batch.length;
  }
  return i;
}
