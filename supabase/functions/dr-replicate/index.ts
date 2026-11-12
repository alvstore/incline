// supabase/functions/dr-replicate/index.ts
// v2.3.0 — honest verify reasons (refused writes, deduped links, jobs cause), unique-slot retry, access probe. v2.2.0 — helper install over encrypted Postgres only; verify self-heals helpers. v2.1.0 — standby details from Settings + owner connection test. 1:1 standby copy worker (structure, sign-in users, rows, buckets/files, jobs).
//
// Modes (POST JSON body):
//   { "mode": "tick", "budgetMs"?: number }  advance the active copy run (pg_cron every 2 min)
//   { "mode": "probe" }                     connectivity + helper status
//   { "mode": "status" }                    latest run (operators)
//   { "mode": "queue", "kind"?: "full"|"verify" }  queue a run (same as the owner button)
//   { "mode": "bootstrap" }                 (re)install the standby helper functions
// Runs are queued by pg_cron (02:30 IST) or by owners via public.dr_request_sync().
// Auth: x-dr-secret (private.dr_config token) or the service-role bearer.
// Standby traffic is HTTPS only; the primary is read inside READ ONLY transactions.

import postgres from "npm:postgres@3.4.4";
import { crypto as stdCrypto } from "jsr:@std/crypto@1.0.3";
import { encodeHex } from "jsr:@std/encoding@1.0.5/hex";
import { connectPrimary, readOne } from "./primary.ts";
import { tick } from "./run.ts";
import { BOOTSTRAP_SQL, STANDBY_ACCESS_SQL, Standby } from "./standby.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dr-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Standby details come from Settings → Disaster Recovery (private.dr_config); the old
// function secrets remain only as a fallback. Resolved per request in loadStandbyConfig().
let DR_URL = (Deno.env.get("DR_URL") ?? "https://api.joinincline.in").replace(/\/+$/, "");
let DR_KEY: string | undefined = Deno.env.get("DR_SERVICE_ROLE_KEY");
let DR_DB: string | undefined = Deno.env.get("DR_DB_URL");

async function loadStandbyConfig(primary: ReturnType<typeof connectPrimary>): Promise<void> {
  const raw = await readOne(primary, `SELECT json_build_object('u', standby_url, 'k', standby_service_key, 'd', standby_db_url)::text FROM private.dr_config WHERE id = true`);
  const c = raw ? (JSON.parse(raw) as { u?: string; k?: string; d?: string }) : {};
  if (c.u) DR_URL = c.u.replace(/\/+$/, "");
  if (c.k) DR_KEY = c.k;
  if (c.d) DR_DB = c.d;
}

/** Install the two standby helpers over the direct DB port (function code only, no data). */
async function bootstrapStandby(): Promise<void> {
  const raw = DR_DB;
  if (!raw) throw new Error("DR_DB_URL not configured");
  const u = new URL(raw);
  if (u.hostname !== new URL(DR_URL).hostname) throw new Error("refusing: DR_DB_URL is not the standby host");
  u.searchParams.delete("sslmode");
  u.searchParams.delete("pgbouncer");
  // DDL must go to Postgres itself, never the pooler: the standby's pooler (6543) runs an
  // auth query that its database refuses ("permission denied for schema pgbouncer").
  // Try the direct port first; fall back to the configured URL only if direct is unreachable.
  const direct = new URL(u.toString());
  direct.port = "5432";
  const candidates = [...new Set([direct.toString(), u.toString()])];
  let lastErr: unknown;
  // Preferred: the standby's admin query endpoint over HTTPS (service key), which needs no
  // pooler login at all and keeps traffic encrypted.
  const drKey = DR_KEY;
  if (drKey) {
    try {
      const r = await fetch(`${DR_URL}/pg/query`, {
        method: "POST",
        headers: { apikey: drKey, Authorization: `Bearer ${drKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: BOOTSTRAP_SQL }),
        signal: AbortSignal.timeout(60_000),
      });
      const text = await r.text();
      if (r.ok) return;
      lastErr = new Error(`standby admin endpoint ${r.status}: ${text.slice(0, 300)}`);
      console.error("dr-replicate bootstrap via https failed", r.status, text.slice(0, 300));
    } catch (e) {
      lastErr = e;
      console.error("dr-replicate bootstrap via https failed", (e as Error).message);
    }
  }
  for (const url of candidates) {
    const sql = postgres(url, { ssl: "require", max: 1, prepare: false, connect_timeout: 15, idle_timeout: 5 });
    try {
      await sql.unsafe(BOOTSTRAP_SQL);
      return;
    } catch (e) {
      lastErr = e;
      console.error("dr-replicate bootstrap attempt failed", new URL(url).port, (e as Error).message);
    } finally {
      await sql.end({ timeout: 5 }).catch(() => {});
    }
  }
  throw lastErr;
}

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

/** Start the next worker run (fire-and-forget: the worker answers 202 immediately). */
async function wakeSelf(primaryUrl: string, token: string): Promise<void> {
  try {
    const r = await fetch(`${primaryUrl.replace(/\/+$/, "")}/functions/v1/dr-replicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-dr-secret": token },
      body: JSON.stringify({ mode: "tick" }),
      signal: AbortSignal.timeout(20_000),
    });
    await r.body?.cancel().catch(() => {});
  } catch (e) {
    // The hourly watchdog restarts a stalled copy.
    console.error("dr-replicate wake failed", (e as Error).message);
  }
}

type Check = { ok: boolean; detail: string; ms?: number };
/** Read-only reachability checks against the saved standby (no data written). */
async function testStandby(primaryUrl: string) {
  const timed = async (fn: () => Promise<string>): Promise<Check> => {
    const t = Date.now();
    try { return { ok: true, detail: await fn(), ms: Date.now() - t }; }
    catch (e) { return { ok: false, detail: (e as Error).message.slice(0, 200), ms: Date.now() - t }; }
  };
  const key = DR_KEY;
  const h: Record<string, string> = key ? { apikey: key, Authorization: `Bearer ${key}` } : {};
  const sameAsLive = (() => { try { return new URL(DR_URL).hostname === new URL(primaryUrl).hostname; } catch { return true; } })();
  const checks: Record<string, Check> = {
    address: sameAsLive ? { ok: false, detail: "This is the live server, not a standby" } : { ok: true, detail: DR_URL },
    secretKey: key ? { ok: true, detail: "Saved" } : { ok: false, detail: "Not saved" },
    api: await timed(async () => {
      const r = await fetch(`${DR_URL}/rest/v1/`, { headers: h, signal: AbortSignal.timeout(15_000) });
      await r.body?.cancel().catch(() => {});
      if (r.status === 401 || r.status === 403) throw new Error("Secret key was refused");
      if (!r.ok) throw new Error(`Replied ${r.status}`);
      return "Records service reachable";
    }),
    auth: await timed(async () => {
      const r = await fetch(`${DR_URL}/auth/v1/health`, { headers: h, signal: AbortSignal.timeout(15_000) });
      await r.body?.cancel().catch(() => {});
      if (!r.ok) throw new Error(`Replied ${r.status}`);
      return "Sign-in service reachable";
    }),
    storage: await timed(async () => {
      const r = await fetch(`${DR_URL}/storage/v1/bucket`, { headers: h, signal: AbortSignal.timeout(15_000) });
      const t = await r.text();
      if (!r.ok) throw new Error(`Replied ${r.status}`);
      const n = (() => { try { return (JSON.parse(t) as unknown[]).length; } catch { return 0; } })();
      return `File storage reachable · ${n} folders`;
    }),
    helpers: await timed(async () => {
      if (!key) throw new Error("Needs the secret key");
      const ready = await new Standby(DR_URL, key).helpersReady();
      return ready ? "Copy helpers installed" : "Copy helpers missing — the next copy installs them";
    }),
  };
  const ok = Object.values(checks).every((c) => c.ok);
  return { ok, checkedAt: new Date().toISOString(), standbyUrl: DR_URL, checks };
}

const STATUS_SQL = `SELECT coalesce((SELECT to_jsonb(x) FROM (SELECT id, kind, trigger, status, step, report, ticks, created_at,
  started_at, heartbeat_at, finished_at, lease_until FROM private.dr_sync_runs ORDER BY created_at DESC LIMIT 1) x), 'null'::jsonb)::text`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const primary = connectPrimary();
  let background = false;
  try {
    const body = (await req.json().catch(() => ({}))) as { mode?: string; budgetMs?: number; wait?: boolean; kind?: string };
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const primaryUrl = Deno.env.get("SUPABASE_URL")!;
    await loadStandbyConfig(primary);

    const token = await readOne(primary, "SELECT token FROM private.dr_config WHERE id = true");
    const secret = req.headers.get("x-dr-secret") ?? "";
    const authHeader = req.headers.get("authorization") ?? "";
    const isService = authHeader === `Bearer ${serviceKey}`;

    // Owner "Test connection" from the Disaster Recovery settings (user sign-in, capability-checked).
    if (body.mode === "test" && !isService && authHeader.startsWith("Bearer ")) {
      const userRes = await fetch(`${primaryUrl}/auth/v1/user`, {
        headers: { Authorization: authHeader, apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? serviceKey },
      });
      const user = userRes.ok ? ((await userRes.json()) as { id?: string }) : null;
      if (!user?.id) return json({ error: "Unauthorized" }, 401);
      const [cap] = await primary`select public.has_capability(${user.id}::uuid, 'manage_standby_copy') as ok`;
      if (!cap?.ok) return json({ error: "Only the owner can test the standby server" }, 403);
      const result = await testStandby(primaryUrl);
      await primary`update private.dr_config set last_test = ${primary.json(result)} where id = true`;
      return json({ ok: true, result });
    }

    if (!isService && !(token && secret.length >= 32 && secret === token)) return json({ error: "Unauthorized" }, 401);
    const drKey = DR_KEY;
    if (!drKey) throw new Error("Standby secret key is not set — add it in Settings → Disaster Recovery");
    if (new URL(DR_URL).hostname === new URL(primaryUrl).hostname) throw new Error("refusing: standby URL points at the live project");

    const standby = new Standby(DR_URL, drKey);
    const mode = body.mode ?? "tick";

    if (mode === "probe") {
      const [ready, storage] = await Promise.all([
        standby.helpersReady().catch((e) => `error: ${(e as Error).message}`),
        fetch(`${DR_URL}/storage/v1/version`).then((r) => r.text()).catch(() => null),
      ]);
      const [primaryUser] = await primary`select current_user as u`;
      const access = ready === true ? await standby.one(STANDBY_ACCESS_SQL).catch((e) => `error: ${(e as Error).message}`) : null;
      return json({ ok: true, primary: primaryUser.u, standbyHelpers: ready, standbyAccess: access ? JSON.parse(String(access).startsWith("error") ? JSON.stringify(access) : String(access)) : null, standbyStorageVersion: storage });
    }
    if (mode === "status") {
      return json({ ok: true, run: JSON.parse((await readOne(primary, STATUS_SQL)) ?? "null") });
    }
    if (mode === "checksum") {
      // Byte-level comparison of up to 5 files (returns only MD5s and sizes).
      const list = Array.isArray((body as { objects?: unknown }).objects) ? (body as { objects: Array<{ bucket: string; name: string }> }).objects.slice(0, 5) : [];
      const objUrl = (base: string, b: string, n: string) =>
        `${base}/storage/v1/object/authenticated/${encodeURIComponent(b)}/${n.split("/").map(encodeURIComponent).join("/")}`;
      const md5Of = async (url: string, key: string) => {
        const r = await fetch(url, { headers: { Authorization: `Bearer ${key}`, apikey: key }, signal: AbortSignal.timeout(110_000) });
        if (!r.ok || !r.body) return { error: `${r.status}` };
        let size = 0;
        const counted = r.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(c, ctl) { size += c.byteLength; ctl.enqueue(c); } }));
        const digest = await stdCrypto.subtle.digest("MD5", counted as unknown as AsyncIterable<Uint8Array<ArrayBuffer>>);
        return { md5: encodeHex(digest), size };
      };
      const out = [];
      for (const o of list) {
        if (typeof o?.bucket !== "string" || typeof o?.name !== "string") continue;
        const [p, sb] = await Promise.all([
          md5Of(objUrl(primaryUrl.replace(/\/+$/, ""), o.bucket, o.name), serviceKey),
          md5Of(objUrl(DR_URL, o.bucket, o.name), drKey),
        ]);
        out.push({ object: `${o.bucket}/${o.name}`, primary: p, standby: sb, identical: "md5" in p && "md5" in sb && p.md5 === sb.md5 && p.size === sb.size });
      }
      return json({ ok: true, files: out });
    }
    if (mode === "queue") {
      const kind = body.kind === "verify" ? "verify" : "full";
      const [row] = await primary.unsafe("SELECT private.dr_queue_run($1, 'manual', NULL)::text AS id", [kind]);
      return json({ ok: true, runId: (row as unknown as { id: string }).id });
    }
    if (mode === "bootstrap") {
      await bootstrapStandby();
      return json({ ok: true, helpers: await standby.helpersReady() });
    }
    if (mode === "tick") {
      const budget = Math.max(15_000, Math.min(130_000, Number(body.budgetMs ?? 100_000)));
      const work = async () => {
        const result = await tick({ primary, standby, primaryUrl, serviceKey, bootstrap: bootstrapStandby }, budget);
        // Keep going while there is work: each run hands over to a fresh worker.
        if (result.state === "progress" && token) await wakeSelf(primaryUrl, token);
        return result;
      };
      if (body.wait === true || typeof EdgeRuntime === "undefined") return json({ ok: true, ...(await work()) });
      background = true;
      EdgeRuntime.waitUntil(
        work()
          .catch((e) => console.error("dr-replicate tick", (e as Error).message))
          .finally(() => primary.end({ timeout: 5 }).catch(() => {})),
      );
      return json({ ok: true, accepted: true }, 202);
    }
    return json({ error: `Mode "${mode}" was retired — copies now run as resumable steps from the Disaster Recovery card.` }, 410);
  } catch (e) {
    console.error("dr-replicate", (e as Error).message);
    return json({ ok: false, error: (e as Error).message }, 500);
  } finally {
    if (!background) await primary.end({ timeout: 5 }).catch(() => {});
  }
});
