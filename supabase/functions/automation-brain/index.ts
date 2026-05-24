// automation-brain v2.0.0 — SSOT: AI message generation routed via ai-runtime (purpose='automation_rule')
// v1.4.0 — apikey must be ANON_KEY (gateway requirement); Authorization stays SERVICE_KEY for service-role bypass.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateOnce } from "../_shared/ai-runtime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
// AI provider/key resolved via ai-runtime → ai-dispatcher per active provider config.

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

// ---------- Minimal cron parser (5 fields: m h dom mon dow) ----------
function parseField(field: string, min: number, max: number): number[] {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    let step = 1;
    let range = part;
    if (part.includes("/")) {
      const [r, s] = part.split("/");
      range = r;
      step = parseInt(s, 10) || 1;
    }
    let from = min, to = max;
    if (range === "*" || range === "") {
      from = min; to = max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-").map((x) => parseInt(x, 10));
      from = a; to = b;
    } else {
      const v = parseInt(range, 10);
      from = v; to = v;
    }
    for (let i = from; i <= to; i += step) out.add(i);
  }
  return [...out].sort((a, b) => a - b);
}

function nextCron(expr: string, after: Date): Date {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return new Date(after.getTime() + 5 * 60 * 1000);
  const [mF, hF, domF, monF, dowF] = parts;
  const mins = parseField(mF, 0, 59);
  const hrs = parseField(hF, 0, 23);
  const doms = parseField(domF, 1, 31);
  const mons = parseField(monF, 1, 12);
  const dows = parseField(dowF, 0, 6);
  const t = new Date(after.getTime() + 60 * 1000);
  t.setSeconds(0, 0);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    const dow = t.getUTCDay();
    if (
      mons.includes(t.getUTCMonth() + 1) &&
      doms.includes(t.getUTCDate()) &&
      dows.includes(dow) &&
      hrs.includes(t.getUTCHours()) &&
      mins.includes(t.getUTCMinutes())
    ) return t;
    t.setUTCMinutes(t.getUTCMinutes() + 1);
  }
  return new Date(after.getTime() + 60 * 60 * 1000);
}

// ---------- Worker dispatch ----------
async function callEdge(name: string, payload: unknown): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `${SUPABASE_URL}/functions/v1/${name}`;
  // New signing-keys gateway rejects when both `apikey` and `Authorization`
  // are sb_ keys ("Conflicting API keys"). Send SERVICE_KEY in `apikey` only;
  // child functions detect the system call via a custom header.
  // v1.5.0 — one retry on 5xx / network failure (cold-start mitigation).
  const doFetch = async () =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_KEY,
        "x-system-call": "automation-brain",
      },
      body: JSON.stringify(payload ?? {}),
    });
  let r: Response;
  try {
    r = await doFetch();
    if (r.status >= 500 && r.status <= 599) {
      await new Promise((res) => setTimeout(res, 300));
      r = await doFetch();
    }
  } catch (_e) {
    await new Promise((res) => setTimeout(res, 300));
    r = await doFetch();
  }
  const body = await r.text();
  return { ok: r.ok, status: r.status, body: body.slice(0, 500) };
}

async function callRpc(fn: string): Promise<{ ok: boolean; body: string }> {
  const { data, error } = await admin.rpc(fn);
  if (error) return { ok: false, body: error.message };
  return { ok: true, body: JSON.stringify(data ?? null).slice(0, 500) };
}

// ---------- Built-in: birthday wishes ----------
async function runBirthdayWish(rule: any): Promise<{ dispatched: number; error?: string }> {
  const today = new Date();
  const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(today.getUTCDate()).padStart(2, "0");

  // Step 1 — active members with a user_id (no FK alias).
  const { data: members, error: mErr } = await admin
    .from("members")
    .select("id, branch_id, user_id")
    .eq("status", "active")
    .not("user_id", "is", null)
    .limit(2000);
  if (mErr) return { dispatched: 0, error: mErr.message };

  const userIds = Array.from(new Set((members ?? []).map((m: any) => m.user_id).filter(Boolean)));
  if (!userIds.length) return { dispatched: 0 };

  // Step 2 — profiles for those user_ids. profiles.id == auth.users.id, so we
  // join on `id`, not `user_id` (which doesn't exist on profiles).
  const { data: profiles, error: pErr } = await admin
    .from("profiles")
    .select("id, full_name, date_of_birth")
    .in("id", userIds);
  if (pErr) return { dispatched: 0, error: pErr.message };

  const profileByUser = new Map<string, { full_name: string | null; date_of_birth: string | null }>();
  for (const p of profiles ?? []) {
    profileByUser.set((p as any).id as string, { full_name: (p as any).full_name, date_of_birth: (p as any).date_of_birth });
  }

  const todays = (members ?? []).filter((m: any) => {
    const p = profileByUser.get(m.user_id);
    const dob = p?.date_of_birth;
    if (!dob) return false;
    const s = String(dob);
    return s.length >= 10 && s.slice(5, 7) === mm && s.slice(8, 10) === dd;
  });

  let count = 0;
  for (const m of todays) {
    const profile = profileByUser.get((m as any).user_id);
    const memberName = profile?.full_name ?? "there";
    let body = `Happy birthday, ${memberName}! 🎉 Wishing you an amazing year ahead from all of us at Incline.`;
    if (rule.use_ai) {
      try {
        const r = await generateOnce({
          purpose: "automation_rule",
          branchId: m.branch_id,
          userMessage: `Member name: ${memberName}`,
          systemOverride: `Compose a short, warm WhatsApp birthday message (under 280 chars) in a ${rule.ai_tone || "friendly"} tone. No emojis overload. Sign off as "Incline".`,
          supabase: admin,
        });
        const text = r.content?.trim();
        if (text) body = text;
      } catch (_) { /* fall back to default */ }
    }
    try {
      await callEdge("dispatch-communication", {
        member_id: m.id,
        branch_id: m.branch_id,
        event: "birthday_wish",
        category: "engagement",
        channels: ["whatsapp", "in_app"],
        body,
        dedupe_key: `birthday_wish:${m.id}:${today.toISOString().slice(0, 10)}`,
      });
      count++;
    } catch (_) { /* keep going */ }
  }
  return { dispatched: count };
}

// ---------- Process one rule ----------
async function processRule(rule: any) {
  const startedAt = new Date();
  const { data: runRow } = await admin
    .from("automation_runs")
    .insert({ rule_id: rule.id, branch_id: rule.branch_id, status: "running", payload: rule.worker_payload ?? {} })
    .select("id")
    .single();

  let status: "success" | "error" = "success";
  let dispatched = 0;
  let errorMsg: string | null = null;

  try {
    if (rule.worker.startsWith("edge:")) {
      const fn = rule.worker.slice(5);
      const r = await callEdge(fn, rule.worker_payload ?? {});
      if (!r.ok) { status = "error"; errorMsg = `HTTP ${r.status}: ${r.body}`; }
      else dispatched = 1;
    } else if (rule.worker.startsWith("rpc:")) {
      const fn = rule.worker.slice(4);
      const r = await callRpc(fn);
      if (!r.ok) { status = "error"; errorMsg = r.body; }
      else dispatched = 1;
    } else if (rule.worker === "builtin:birthday_wish") {
      const r = await runBirthdayWish(rule);
      dispatched = r.dispatched;
      if (r.error) { status = "error"; errorMsg = r.error; }
    } else {
      status = "error";
      errorMsg = `Unknown worker: ${rule.worker}`;
    }
  } catch (e) {
    status = "error";
    errorMsg = (e as Error).message ?? String(e);
  }

  const finishedAt = new Date();
  const next = nextCron(rule.cron_expression, finishedAt);

  await admin.from("automation_runs").update({
    finished_at: finishedAt.toISOString(),
    status,
    dispatched_count: dispatched,
    error_message: errorMsg,
  }).eq("id", runRow?.id);

  await admin.from("automation_rules").update({
    last_run_at: startedAt.toISOString(),
    next_run_at: next.toISOString(),
    last_status: status,
    last_error: errorMsg,
    last_dispatched_count: dispatched,
  }).eq("id", rule.id);

  if (status === "error" && errorMsg) {
    try {
      await admin.rpc("log_error_event", {
        p_source: "automation_brain",
        p_severity: "error",
        p_message: `Automation rule "${rule.key}" failed: ${errorMsg}`.slice(0, 1000),
        p_context: { rule_id: rule.id, rule_key: rule.key, worker: rule.worker, branch_id: rule.branch_id },
      });
    } catch (_) { /* swallow logging failures */ }
  }

  return { rule: rule.key, status, dispatched, error: errorMsg };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { data: rules, error } = await admin
      .from("automation_rules")
      .select("*")
      .eq("is_active", true)
      .lte("next_run_at", new Date().toISOString())
      .order("next_run_at", { ascending: true })
      .limit(50);
    if (error) throw error;

    const results: any[] = [];
    for (const r of rules ?? []) {
      results.push(await processRule(r));
    }
    return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
