// supabase/functions/dr-replicate/index.ts
// v2.0.0 — 1:1 standby copy worker (structure, sign-in users, rows, buckets/files, jobs).
//
// Modes (POST JSON body):
//   { "mode": "tick", "budgetMs"?: number }  advance the active copy run (pg_cron every 2 min)
//   { "mode": "probe" }                     connectivity + helper status
//   { "mode": "bootstrap" }                 (re)install the standby helper functions
// Runs are queued by pg_cron (02:30 IST) or by owners via public.dr_request_sync().
// Auth: x-dr-secret (private.dr_config token) or the service-role bearer.
// Standby traffic is HTTPS only; the primary is read inside READ ONLY transactions.

import postgres from "npm:postgres@3.4.4";
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  let primary: ReturnType<typeof connectPrimary> | null = null;
  try {
    const body = (await req.json().catch(() => ({}))) as { mode?: string; budgetMs?: number };
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const primaryUrl = Deno.env.get("SUPABASE_URL")!;
    const drKey = Deno.env.get("DR_SERVICE_ROLE_KEY");
    if (!drKey) throw new Error("DR_SERVICE_ROLE_KEY not configured");
    if (new URL(DR_URL).hostname === new URL(primaryUrl).hostname) throw new Error("refusing: standby URL points at the live project");

    primary = connectPrimary();
    const secret = req.headers.get("x-dr-secret") ?? "";
    const isService = (req.headers.get("authorization") ?? "") === `Bearer ${serviceKey}`;
    let authorized = isService;
    if (!authorized && secret.length >= 32) {
      const token = await readOne(primary, "SELECT token FROM private.dr_config WHERE id = true");
      authorized = !!token && token === secret;
    }
    if (!authorized) return json({ error: "Unauthorized" }, 401);

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
    if (mode === "bootstrap") {
      await bootstrapStandby();
      return json({ ok: true, helpers: await standby.helpersReady() });
    }
    if (mode === "tick") {
      const budget = Math.max(15_000, Math.min(130_000, Number(body.budgetMs ?? 100_000)));
      const result = await tick({ primary, standby, primaryUrl, serviceKey, bootstrap: bootstrapStandby }, budget);
      return json({ ok: true, ...result });
    }
    return json({ error: `Mode "${mode}" was retired — copies now run as resumable steps from the Disaster Recovery card.` }, 410);
  } catch (e) {
    console.error("dr-replicate", (e as Error).message);
    return json({ ok: false, error: (e as Error).message }, 500);
  } finally {
    await primary?.end({ timeout: 5 }).catch(() => {});
  }
});
