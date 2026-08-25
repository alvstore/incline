// v1.0.0 — Bounded Meta catalog monitor with a persisted lease and circuit breaker.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const JOB_KEY = "meta_template_manager";
const MAX_BRANCHES_PER_RUN = 3;
const LEASE_MINUTES = 10;

type JobState = {
  status: "idle" | "running" | "paused" | "failed";
  lease_until: string | null;
  consecutive_429: number;
  paused_reason: string | null;
  cursor_branch_id: string | null;
};

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const backendUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!backendUrl || !serviceKey) return response({ error: "Server configuration error" }, 500);

  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const isSystemCall = req.headers.get("x-system-call") === "automation-brain";
  if (bearer !== serviceKey || !isSystemCall) return response({ error: "Unauthorized" }, 401);

  const admin = createClient(backendUrl, serviceKey);
  const now = new Date();
  const { data: existing } = await admin
    .from("template_manager_state")
    .select("status, lease_until, consecutive_429, paused_reason, cursor_branch_id")
    .eq("job_key", JOB_KEY)
    .maybeSingle();
  const state = existing as JobState | null;

  if (state?.status === "running" && state.lease_until && new Date(state.lease_until) > now) {
    return response({ skipped: true, reason: "already_running" });
  }
  if (state?.status === "paused" && state.paused_reason && !state.paused_reason.startsWith("rate_limited")) {
    return response({ skipped: true, reason: state.paused_reason });
  }

  const leaseUntil = new Date(now.getTime() + LEASE_MINUTES * 60_000).toISOString();
  await admin.from("template_manager_state").upsert({
    job_key: JOB_KEY,
    status: "running",
    lease_until: leaseUntil,
    last_started_at: now.toISOString(),
    updated_at: now.toISOString(),
  });

  try {
    let branchQuery = admin.from("branches").select("id").eq("is_active", true).order("id").limit(MAX_BRANCHES_PER_RUN);
    if (state?.cursor_branch_id) branchQuery = branchQuery.gt("id", state.cursor_branch_id);
    let { data: branches, error: branchError } = await branchQuery;
    if (branchError) throw branchError;
    if (!branches?.length && state?.cursor_branch_id) {
      const retry = await admin.from("branches").select("id").eq("is_active", true).order("id").limit(MAX_BRANCHES_PER_RUN);
      if (retry.error) throw retry.error;
      branches = retry.data;
    }

    const results: Array<Record<string, unknown>> = [];
    let rateLimits = 0;
    for (const branch of branches ?? []) {
      const call = await fetch(`${backendUrl}/functions/v1/manage-whatsapp-templates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          "x-system-call": "template-manager-worker",
        },
        body: JSON.stringify({ action: "list", branch_id: branch.id }),
      });
      const body = await call.json().catch(() => ({}));
      results.push({ branch_id: branch.id, status: call.status, reconciliation: body?.reconciliation ?? null, error: body?.error ?? null });

      if (call.status === 402 || call.status === 403) {
        await admin.from("template_manager_state").upsert({
          job_key: JOB_KEY,
          status: "paused",
          lease_until: null,
          paused_reason: `provider_${call.status}`,
          last_result: { results },
          last_finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        return response({ paused: true, reason: `provider_${call.status}`, results }, call.status);
      }
      if (call.status === 429) {
        rateLimits += 1;
        if ((state?.consecutive_429 ?? 0) + rateLimits >= 3) break;
      }
    }

    const lastBranchId = branches?.at(-1)?.id ?? null;
    const shouldPark = (state?.consecutive_429 ?? 0) + rateLimits >= 3;
    await admin.from("template_manager_state").upsert({
      job_key: JOB_KEY,
      status: shouldPark ? "paused" : "idle",
      lease_until: null,
      consecutive_429: rateLimits ? (state?.consecutive_429 ?? 0) + rateLimits : 0,
      paused_reason: shouldPark ? "rate_limited_until_next_run" : null,
      cursor_branch_id: lastBranchId,
      last_result: { processed: results.length, results },
      last_finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return response({ ok: true, processed: results.length, parked: shouldPark, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await admin.from("template_manager_state").upsert({
      job_key: JOB_KEY,
      status: "failed",
      lease_until: null,
      paused_reason: message.slice(0, 500),
      last_result: { error: message },
      last_finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await admin.rpc("log_error_event", {
      p_source: "worker",
      p_severity: "error",
      p_message: `Template manager worker failed: ${message}`.slice(0, 1000),
      p_context: { job_key: JOB_KEY },
    });
    return response({ error: message }, 500);
  }
});