// supabase/functions/dr-replicate/index.ts
// v2.0.0 — 1:1 standby copy worker (structure, sign-in users, rows, buckets/files, jobs).
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
import { BOOTSTRAP_SQL, Standby } from "./standby.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dr-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const DR_URL = (Deno.env.get("DR_URL") ?? "https://api.joinincline.in").replace(/\/+$/, "");

/** Install the two standby helpers over the direct DB port (function code only, no data). */
async function bootstrapStandby(): Promise<void> {
  const raw = Deno.env.get("DR_DB_URL");
  if (!raw) throw new Error("DR_DB_URL not configured");
  const u = new URL(raw);
  if (u.hostname !== new URL(DR_URL).hostname) throw new Error("refusing: DR_DB_URL is not the standby host");
  u.searchParams.delete("sslmode");
  const sql = postgres(u.toString(), { ssl: false, max: 1, prepare: false, connect_timeout: 15, idle_timeout: 5 });
  try {
    await sql.unsafe(BOOTSTRAP_SQL);
  } finally {
    await sql.end();
  }
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
    const drKey = Deno.env.get("DR_SERVICE_ROLE_KEY");
    if (!drKey) throw new Error("DR_SERVICE_ROLE_KEY not configured");
    if (new URL(DR_URL).hostname === new URL(primaryUrl).hostname) throw new Error("refusing: standby URL points at the live project");

    const token = await readOne(primary, "SELECT token FROM private.dr_config WHERE id = true");
    const secret = req.headers.get("x-dr-secret") ?? "";
    const isService = (req.headers.get("authorization") ?? "") === `Bearer ${serviceKey}`;
    if (!isService && !(token && secret.length >= 32 && secret === token)) return json({ error: "Unauthorized" }, 401);

    const standby = new Standby(DR_URL, drKey);
    const mode = body.mode ?? "tick";

    if (mode === "probe") {
      const [ready, storage] = await Promise.all([
        standby.helpersReady().catch((e) => `error: ${(e as Error).message}`),
        fetch(`${DR_URL}/storage/v1/version`).then((r) => r.text()).catch(() => null),
      ]);
      const [primaryUser] = await primary`select current_user as u`;
      return json({ ok: true, primary: primaryUser.u, standbyHelpers: ready, standbyStorageVersion: storage });
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
