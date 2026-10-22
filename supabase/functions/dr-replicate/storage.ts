// v2.0.0 — Storage mirror: buckets (rows) + objects (bytes via Storage API, HTTPS).
//
// Objects are compared by size + eTag (md5 for single-part uploads; multipart eTags
// "…-N" fall back to size). Missing/different files are streamed primary → standby,
// files larger than LARGE_FILE use the standby's resumable endpoint in 6 MB chunks so
// a 190 MB export can continue across worker runs. Standby-only files are deleted and
// owner/user metadata/created_at are aligned so owner-based storage policies behave
// the same after failover.

import { type Sql, readJson } from "./primary.ts";
import { lit } from "./sqlText.ts";
import { type Standby, TUS_CHUNK } from "./standby.ts";

export interface Obj {
  b: string; n: string; s: number; e: string | null; m: string | null; c: string | null;
  o: string | null; oi: string | null; um: unknown; ca: string | null;
}

export const OBJECTS_SQL = `SELECT coalesce(json_agg(json_build_object('b', o.bucket_id, 'n', o.name,
  's', coalesce((o.metadata->>'size')::bigint, 0), 'e', o.metadata->>'eTag', 'm', o.metadata->>'mimetype',
  'c', o.metadata->>'cacheControl', 'o', o.owner::text, 'oi', o.owner_id, 'um', o.user_metadata, 'ca', o.created_at)
  ORDER BY o.bucket_id, o.name), '[]'::json)::text
FROM storage.objects o WHERE o.archived_at IS NULL AND NOT coalesce(o.is_delete_marker, false)`;

export const BUCKETS_SQL = `SELECT coalesce(json_agg(id ORDER BY id), '[]'::json)::text FROM storage.buckets`;

export const LARGE_FILE = 20 * 1024 * 1024;
export const MAX_ATTEMPTS = 3;

const okey = (o: { b: string; n: string }) => `${o.b}/${o.n}`;

export function sameContent(p: Obj, s: Obj): boolean {
  if (Number(p.s) !== Number(s.s)) return false;
  if (!p.e || !s.e || p.e.includes("-") || s.e.includes("-")) return true;
  return p.e === s.e;
}

export function sameMeta(p: Obj, s: Obj): boolean {
  const n = (v: unknown) => (v === "" || v === undefined ? null : v);
  return n(p.o) === n(s.o) && n(p.oi) === n(s.oi) &&
    JSON.stringify(p.um ?? null) === JSON.stringify(s.um ?? null) &&
    (p.ca ? new Date(p.ca).getTime() : null) === (s.ca ? new Date(s.ca).getTime() : null);
}

export interface ObjectPlan { copy: Obj[]; remove: Obj[]; fixMeta: Obj[]; same: number }

/** Pure diff of primary vs standby object listings. */
export function planObjects(primary: Obj[], standby: Obj[]): ObjectPlan {
  const s = new Map(standby.map((o) => [okey(o), o]));
  const p = new Set(primary.map(okey));
  const plan: ObjectPlan = { copy: [], remove: [], fixMeta: [], same: 0 };
  for (const o of primary) {
    const cur = s.get(okey(o));
    if (!cur || !sameContent(o, cur)) plan.copy.push(o);
    else if (!sameMeta(o, cur)) plan.fixMeta.push(o);
    else plan.same++;
  }
  for (const o of standby) if (!p.has(okey(o))) plan.remove.push(o);
  plan.copy.sort((a, b) => Number(a.s) - Number(b.s));
  return plan;
}

export function metaFixSql(o: Obj): string {
  const v = (x: string | null | undefined, cast: string) => (x == null || x === "" ? "NULL" : `${lit(x)}::${cast}`);
  return `UPDATE storage.objects SET owner = ${v(o.o, "uuid")}, owner_id = ${v(o.oi, "text")}, ` +
    `user_metadata = ${o.um == null ? "NULL" : `${lit(JSON.stringify(o.um))}::jsonb`}, ` +
    `created_at = ${o.ca ? `${lit(o.ca)}::timestamptz` : "created_at"} WHERE bucket_id = ${lit(o.b)} AND name = ${lit(o.n)}`;
}

export interface StorageState {
  attempts: Record<string, number>;
  tus: Record<string, { url: string; size: number }>;
  failures: Record<string, string>;
}

export interface StorageStats {
  primaryObjects: number; primaryBytes: number; standbyObjects: number;
  copied: number; copiedBytes: number; removed: number; metaFixed: number; failed: number; remaining: number;
}

export interface StorageCtx {
  primary: Sql;
  standby: Standby;
  primaryUrl: string;
  serviceKey: string;
  deadline: number;
  persist: () => Promise<void>;
}

export async function listObjects(ctx: Pick<StorageCtx, "primary" | "standby">): Promise<{ p: Obj[]; s: Obj[] }> {
  const p = await readJson<Obj[]>(ctx.primary, OBJECTS_SQL);
  const s = JSON.parse((await ctx.standby.one(OBJECTS_SQL)) ?? "[]") as Obj[];
  return { p, s };
}

/** Buckets: delete standby-only buckets (after emptying them); bucket rows are then mirrored by the row engine. */
export async function cleanExtraBuckets(ctx: Pick<StorageCtx, "primary" | "standby">): Promise<string[]> {
  const p = new Set(await readJson<string[]>(ctx.primary, BUCKETS_SQL));
  const s = JSON.parse((await ctx.standby.one(BUCKETS_SQL)) ?? "[]") as string[];
  const removed: string[] = [];
  for (const id of s) {
    if (p.has(id)) continue;
    const names = JSON.parse(
      (await ctx.standby.one(`SELECT coalesce(json_agg(name), '[]'::json)::text FROM storage.objects WHERE bucket_id = ${lit(id)}`)) ?? "[]",
    ) as string[];
    if (names.length) await ctx.standby.removeObjects(id, names);
    await ctx.standby.storageJson("DELETE", `bucket/${encodeURIComponent(id)}`);
    removed.push(id);
  }
  return removed;
}

function primaryObjectUrl(base: string, o: Obj): string {
  return `${base.replace(/\/+$/, "")}/storage/v1/object/authenticated/${encodeURIComponent(o.b)}/${o.n.split("/").map(encodeURIComponent).join("/")}`;
}

async function download(ctx: StorageCtx, o: Obj, range?: [number, number]): Promise<Uint8Array> {
  const headers: Record<string, string> = { Authorization: `Bearer ${ctx.serviceKey}`, apikey: ctx.serviceKey };
  if (range) headers.Range = `bytes=${range[0]}-${range[1]}`;
  const r = await fetch(primaryObjectUrl(ctx.primaryUrl, o), { headers, signal: AbortSignal.timeout(100_000) });
  if (!r.ok) throw new Error(`download ${okey(o)}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  if (range && r.status !== 206) {
    await r.body?.cancel().catch(() => {});
    throw new Error(`download ${okey(o)}: range not honoured (${r.status})`);
  }
  return new Uint8Array(await r.arrayBuffer());
}

/** Copy one large object with the resumable endpoint. Returns true when complete. */
async function copyLarge(ctx: StorageCtx, o: Obj, state: StorageState): Promise<boolean> {
  const key = okey(o);
  const size = Number(o.s);
  let t = state.tus[key];
  let offset: number | null = null;
  if (t && t.size === size) offset = await ctx.standby.tusOffset(t.url);
  if (!t || t.size !== size || offset == null) {
    t = { url: await ctx.standby.tusCreate(o.b, o.n, size, o.m ?? "application/octet-stream", o.c), size };
    state.tus[key] = t;
    offset = 0;
    await ctx.persist();
  }
  while (offset < size) {
    if (ctx.deadline - Date.now() < 25_000) return false;
    const end = Math.min(offset + TUS_CHUNK, size) - 1;
    const chunk = await download(ctx, o, [offset, end]);
    offset = await ctx.standby.tusPatch(t.url, offset, chunk);
    await ctx.persist();
  }
  delete state.tus[key];
  return true;
}

export async function syncObjects(ctx: StorageCtx, state: StorageState, stats: StorageStats): Promise<boolean> {
  const { p, s } = await listObjects(ctx);
  const plan = planObjects(p, s);
  stats.primaryObjects = p.length;
  stats.primaryBytes = p.reduce((a, o) => a + Number(o.s), 0);
  stats.standbyObjects = s.length;

  // Standby-only files.
  const byBucket = new Map<string, string[]>();
  for (const o of plan.remove) byBucket.set(o.b, [...(byBucket.get(o.b) ?? []), o.n]);
  for (const [bucket, names] of byBucket) {
    try { await ctx.standby.removeObjects(bucket, names); stats.removed += names.length; }
    catch (e) { state.failures[`remove:${bucket}`] = (e as Error).message.slice(0, 300); }
  }

  const fixes: Obj[] = [...plan.fixMeta];
  let pending = 0;
  for (const o of plan.copy) {
    const key = okey(o);
    if ((state.attempts[key] ?? 0) >= MAX_ATTEMPTS) continue;
    const remaining = ctx.deadline - Date.now();
    if (remaining < 15_000) { pending++; continue; }
    const large = Number(o.s) > LARGE_FILE;
    if (large && remaining < 40_000 && !state.tus[key]) { pending++; continue; }
    state.attempts[key] = (state.attempts[key] ?? 0) + 1;
    try {
      let done = true;
      if (large) {
        done = await copyLarge(ctx, o, state);
        if (!done) state.attempts[key]--; // partial progress is not a failed attempt
      } else {
        const bytes = await download(ctx, o);
        await ctx.standby.upload(o.b, o.n, bytes, o.m ?? "application/octet-stream", o.c);
      }
      if (done) {
        stats.copied++;
        stats.copiedBytes += Number(o.s);
        delete state.attempts[key];
        delete state.failures[key];
        fixes.push(o);
      } else pending++;
    } catch (e) {
      state.failures[key] = (e as Error).message.slice(0, 300);
      if ((state.attempts[key] ?? 0) < MAX_ATTEMPTS) pending++;
    }
  }

  // Owner / metadata alignment (also for freshly copied files).
  for (let i = 0; i < fixes.length; i += 100) {
    try {
      await ctx.standby.run(fixes.slice(i, i + 100).map(metaFixSql));
      stats.metaFixed += Math.min(100, fixes.length - i);
    } catch (e) {
      state.failures["metadata"] = (e as Error).message.slice(0, 300);
    }
  }

  stats.failed = Object.keys(state.attempts).filter((k) => state.attempts[k] >= MAX_ATTEMPTS).length;
  stats.remaining = pending;
  return pending === 0;
}
