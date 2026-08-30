// v1.2.0 — Sarvam Voice AI control plane (owner/admin only).
//
// Actions: get_state | get_readiness | run_eligibility_check | save_config |
//          save_automation | set_active | test_connection | test_call
//
// The Sarvam API key lives in public.voice_provider_secrets, which has no
// grants and no policies — only this function (service role) can read it.
// It is never returned to the browser and never written to a log.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  admin,
  AGENT_INPUT_VARIABLES,
  AGENT_OUTPUT_VARIABLES,
  checkConnection,
  corsHeaders,
  buildAgentVariables,
  createOutboundCall,
  isOutboundCapable,
  json,
  maskKey,
  redact,
  SarvamError,
  type SarvamConfig,
} from "../_shared/sarvam.ts";
import { normalizePhone, isValidIndianMobile } from "../_shared/phone.ts";


const PROVIDER = "sarvam";

const DEFAULT_CONFIG: SarvamConfig = {
  telephony_provider: "sarvam_vobiz",
  timezone: "Asia/Kolkata",
  window_start: "10:00",
  window_end: "19:00",
  max_concurrent_calls: 1,
  daily_call_cap: 25,
  retry_enabled: false,
};

/** Minutes since midnight in Asia/Kolkata. */
function istMinutesNow(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h * 60 + m;
}

function hhmmToMinutes(v: string | undefined, fallback: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v ?? "");
  if (!m) return fallback;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Only these keys are ever persisted; anything else the client sends is dropped. */
function sanitizeConfig(input: Record<string, unknown>, current: SarvamConfig): SarvamConfig {
  const str = (k: keyof SarvamConfig) =>
    typeof input[k] === "string" ? String(input[k]).trim() : (current[k] as string | undefined);
  const num = (k: keyof SarvamConfig, min: number, max: number) => {
    const raw = input[k];
    if (raw === null || raw === undefined || raw === "") return current[k] as number | undefined;
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n)) return current[k] as number | undefined;
    return Math.min(max, Math.max(min, n));
  };
  return {
    org_id: str("org_id"),
    workspace_id: str("workspace_id"),
    app_id: str("app_id"),
    app_version: num("app_version", 1, 100000) ?? null,
    connection_id: str("connection_id"),
    agent_phone_number: str("agent_phone_number")
      ? normalizePhone(str("agent_phone_number"))
      : current.agent_phone_number,
    telephony_provider: str("telephony_provider") || DEFAULT_CONFIG.telephony_provider,
    timezone: "Asia/Kolkata",
    window_start: str("window_start") || DEFAULT_CONFIG.window_start,
    window_end: str("window_end") || DEFAULT_CONFIG.window_end,
    max_concurrent_calls: num("max_concurrent_calls", 1, 10) ?? DEFAULT_CONFIG.max_concurrent_calls,
    daily_call_cap: num("daily_call_cap", 1, 5000) ?? DEFAULT_CONFIG.daily_call_cap,
    retry_enabled: typeof input.retry_enabled === "boolean" ? input.retry_enabled : (current.retry_enabled ?? false),
    test_phone: str("test_phone") ? normalizePhone(str("test_phone")) : current.test_phone,
    webhook_token: current.webhook_token || crypto.randomUUID().replace(/-/g, ""),
    tool_token: current.tool_token || crypto.randomUUID().replace(/-/g, ""),
  };
}

function publicConfig(cfg: SarvamConfig) {
  const { webhook_token: _t, tool_token: _tt, ...rest } = cfg;
  return rest;
}

export interface SarvamReadiness {
  connected: boolean;
  api_key_configured: boolean;
  agent_configured: boolean;
  agent_version: string | null;
  agent_committed: boolean;
  /** Deployments are an INBOUND/campaign concept — advisory only for outbound. */
  deployment_configured: boolean;
  deployment_active: boolean;
  outbound_enabled: boolean;
  phone_number_configured: boolean;
  phone_number_active: boolean;
  phone_number_assigned: boolean;

  test_call_available: boolean;
  successful_test_call: boolean;
  integration_enabled: boolean;
  production_ready: boolean;
  probe_error: string | null;
  deployment: Record<string, unknown> | null;
  blockers: string[];
  /** Non-blocking advisories (deployment mismatches, inbound not configured). */
  warnings: string[];
}

/** Single source of truth for "can we call". Never optimistic: every positive
 *  flag is derived from a real Sarvam response or stored configuration.
 *
 *  Gate matches the documented Instant Outbound contract exactly
 *  (docs.sarvam.ai/conversations/api/instant-outbound/create): app_id,
 *  app_version, connection_id, agent_phone_number. A deployment record is NOT
 *  part of that contract — it only binds an agent to a number for inbound
 *  calls and campaigns, so it is reported as a warning, never a blocker. */
/** First blocker that actually prevents dialling (ignores post-call gates). */
function setupBlocker(r: { blockers: string[] }): string | null {
  const ignore = ["No successful test call", "master switch is off"];
  return r.blockers.find((b) => !ignore.some((i) => b.includes(i))) ?? null;
}

async function computeReadiness(
  sb: ReturnType<typeof admin>,
  row: { id?: string; is_active?: boolean; api_key_last4?: string | null } | null,
  cfg: SarvamConfig,
  apiKey: string | null,
  probe: boolean,
): Promise<SarvamReadiness> {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const api_key_configured = !!row?.api_key_last4 && !!apiKey;
  if (!api_key_configured) blockers.push("Sarvam API key is not stored.");

  const agent_configured = !!cfg.org_id && !!cfg.workspace_id && !!cfg.app_id;
  if (!cfg.org_id || !cfg.workspace_id) blockers.push("Organization ID / Workspace ID missing.");
  if (!cfg.app_id) blockers.push("Sarvam Agent ID (app_id) is not configured.");

  const agent_version = cfg.app_version ? String(cfg.app_version) : null;
  if (!agent_version) blockers.push("Agent version is not set — Sarvam's outbound API requires a committed version.");

  const phone_number_configured = !!cfg.agent_phone_number && !!cfg.connection_id;
  if (!cfg.agent_phone_number) blockers.push("Agent phone number is not configured.");
  if (!cfg.connection_id) blockers.push("Telephony connection ID is not configured.");

  let connected = false;
  let probe_error: string | null = null;
  let deployment: Record<string, unknown> | null = null;
  let deployment_configured = false;
  let outbound_enabled = false;
  let deployment_active = false;
  let phone_number_assigned = false;
  let agent_committed = !!agent_version;

  if (api_key_configured && cfg.org_id && cfg.workspace_id && probe) {
    try {
      const res = await checkConnection(apiKey!, cfg);
      connected = true;
      deployment = (res.deployment as Record<string, unknown> | null) ?? null;
      deployment_configured = !!deployment;
      if (!deployment_configured) {
        warnings.push(
          "No inbound deployment matches this Agent ID. Not required for outbound calls — only for answering inbound calls or running campaigns.",
        );
      } else {
        const status = String(deployment!.status ?? "").toLowerCase();
        const direction = String(deployment!.channel_direction ?? "").toLowerCase();
        const numbers = (Array.isArray(deployment!.phone_numbers) ? deployment!.phone_numbers : []).map((n) =>
          normalizePhone(String(n))
        );
        if (agent_version && String(deployment!.app_version) !== agent_version) {
          warnings.push(
            `Configured agent version (${agent_version}) differs from the deployed version (${deployment!.app_version}). Outbound calls use the configured version.`,
          );
        }
        deployment_active = status === "active";
        if (!deployment_active) {
          warnings.push(`Deployment status is "${status || "unknown"}" — inbound calls will not be answered.`);
        }
        outbound_enabled = isOutboundCapable(direction);
        if (!outbound_enabled) {
          warnings.push(`Deployment channel direction is "${direction || "unknown"}".`);
        }

        const wanted = normalizePhone(cfg.agent_phone_number ?? "");
        phone_number_assigned = !!wanted && numbers.includes(wanted);
        if (!phone_number_assigned) {
          warnings.push("The configured agent phone number is not attached to this deployment.");
        }
      }
    } catch (e) {
      const err = e instanceof SarvamError ? e : new SarvamError(redact((e as Error).message), "sarvam_unknown");
      probe_error = `${err.code}: ${err.message}`;
      blockers.push(`Sarvam check failed — ${err.message}`);
    }
  } else if (!probe) {
    probe_error = "not_probed";
  }

  let successful_test_call = false;
  {
    const { count } = await sb
      .from("voice_call_attempts")
      .select("id", { count: "exact", head: true })
      .eq("provider", PROVIDER)
      .eq("source", "manual_test")
      .in("status", ["connected", "answered", "completed"]);
    successful_test_call = (count ?? 0) > 0;
  }

  // Documented Instant Outbound requirements only.
  const test_call_available = connected && agent_configured && !!agent_version && phone_number_configured;

  const integration_enabled = !!row?.is_active;
  const production_ready = test_call_available && successful_test_call && integration_enabled;
  if (test_call_available && !integration_enabled) {
    blockers.push("Sarvam Voice AI master switch is off.");
  }
  if (!successful_test_call) blockers.push("No successful test call has been completed yet.");

  return {
    connected,
    api_key_configured,
    agent_configured,
    agent_version,
    agent_committed,
    deployment_configured,
    deployment_active,
    outbound_enabled,
    phone_number_configured,
    phone_number_active: deployment_active,
    phone_number_assigned,
    test_call_available,
    successful_test_call,
    integration_enabled,
    production_ready,
    probe_error,
    deployment,
    blockers,
    warnings,
  };
}

/** Agent context for one member: the exact input variables the Sarvam agent
 *  expects, sourced live from the CRM (no cached copies). */
async function memberCallContext(
  sb: ReturnType<typeof admin>,
  memberId: string,
): Promise<{ phone: string; branch_id: string | null; vars: Record<string, string> } | null> {
  const { data: m } = await sb
    .from("members")
    .select("id, member_code, branch_id, user_id, assigned_trainer_id")
    .eq("id", memberId)
    .maybeSingle();
  if (!m) return null;

  const [{ data: profile }, { data: branch }, { data: membership }, { data: lastVisit }] = await Promise.all([
    m.user_id
      ? sb.from("profiles").select("full_name, phone, gender").eq("id", m.user_id).maybeSingle()
      : Promise.resolve({ data: null }),
    m.branch_id ? sb.from("branches").select("name").eq("id", m.branch_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("memberships")
      .select("end_date, plan_id, membership_plans(name)")
      .eq("member_id", memberId)
      .eq("status", "active")
      .order("end_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb.from("member_attendance")
      .select("check_in")
      .eq("member_id", memberId)
      .order("check_in", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  let trainerName = "";
  if (m.assigned_trainer_id) {
    const { data: t } = await sb.from("trainers").select("user_id").eq("id", m.assigned_trainer_id).maybeSingle();
    const tUser = (t as { user_id?: string } | null)?.user_id;
    if (tUser) {
      const { data: tp } = await sb.from("profiles").select("full_name").eq("id", tUser).maybeSingle();
      trainerName = (tp as { full_name?: string } | null)?.full_name ?? "";
    }
  }

  const lastCheckIn = (lastVisit as { check_in?: string } | null)?.check_in ?? null;
  const daysAbsent = lastCheckIn
    ? Math.max(0, Math.floor((Date.now() - new Date(lastCheckIn).getTime()) / 86_400_000))
    : 0;
  const planRel = (membership as { membership_plans?: unknown } | null)?.membership_plans;
  const planName = Array.isArray(planRel)
    ? ((planRel[0] as { name?: string })?.name ?? "")
    : ((planRel as { name?: string } | null)?.name ?? "");

  return {
    phone: (profile as { phone?: string } | null)?.phone ?? "",
    branch_id: (m.branch_id as string) ?? null,
    vars: {
      member_name: (profile as { full_name?: string } | null)?.full_name ?? "",
      member_code: (m.member_code as string) ?? "",
      branch_name: (branch as { name?: string } | null)?.name ?? "Incline",
      days_absent: String(daysAbsent),
      last_visit_date: lastCheckIn ? new Date(lastCheckIn).toISOString().slice(0, 10) : "",
      plan_name: planName,
      plan_expiry: String((membership as { end_date?: string } | null)?.end_date ?? ""),
      trainer_name: trainerName,
      gender: (profile as { gender?: string } | null)?.gender ?? "",
      preferred_language: "Hindi",
    },
  };
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = admin();
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = String(body.action || "get_state");
    const branchId: string | null = body.branch_id && body.branch_id !== "all" ? body.branch_id : null;

    // ---- current row -------------------------------------------------------
    const baseQuery = sb
      .from("voice_provider_integrations")
      .select("*")
      .eq("provider", PROVIDER);
    const { data: row } = branchId
      ? await baseQuery.eq("branch_id", branchId).maybeSingle()
      : await baseQuery.is("branch_id", null).maybeSingle();

    const cfg: SarvamConfig = { ...DEFAULT_CONFIG, ...((row?.config as SarvamConfig) || {}) };

    // ---- authorization -----------------------------------------------------
    // Two accepted identities:
    //  1. Owner/admin JWT (the Settings UI and the Voice AI console).
    //  2. The internal shared key (X-Incline-Tool-Key) for server-side
    //     operator runs. It can only reach the read + call-placement actions,
    //     never configuration or the retention master switch.
    const SYSTEM_ACTIONS = new Set([
      "get_state",
      "get_readiness",
      "run_eligibility_check",
      "place_call",
      "run_batch",
      "metrics",
    ]);
    const systemKey = req.headers.get("x-incline-tool-key") ?? "";
    const isSystem = !!cfg.tool_token && systemKey.length === cfg.tool_token.length &&
      systemKey === cfg.tool_token;

    let userId: string | null = null;
    if (isSystem) {
      if (!SYSTEM_ACTIONS.has(action)) {
        return json({ ok: false, error: "Forbidden — system key cannot perform this action" }, 403);
      }
    } else {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) return json({ ok: false, error: "Unauthorized" }, 401);
      const sbAuth = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const token = authHeader.replace("Bearer ", "");
      const { data: claims } = await sbAuth.auth.getClaims(token);
      userId = (claims?.claims?.sub as string | undefined) ?? null;
      if (!userId) return json({ ok: false, error: "Unauthorized" }, 401);
      const { data: roleRows } = await sb.from("user_roles").select("role").eq("user_id", userId);
      const roles = (roleRows || []).map((r: { role: string }) => r.role);
      if (!roles.some((r) => r === "owner" || r === "admin")) {
        return json({ ok: false, error: "Forbidden — owner or admin only" }, 403);
      }
    }


    const loadKey = async (): Promise<string | null> => {
      if (!row?.id) return null;
      const { data } = await sb
        .from("voice_provider_secrets")
        .select("api_key")
        .eq("integration_id", row.id)
        .maybeSingle();
      return data?.api_key ?? null;
    };

    const stateResponse = async (extra: Record<string, unknown> = {}) => {
      const { data: fresh } = branchId
        ? await sb.from("voice_provider_integrations").select("*").eq("provider", PROVIDER).eq("branch_id", branchId).maybeSingle()
        : await sb.from("voice_provider_integrations").select("*").eq("provider", PROVIDER).is("branch_id", null).maybeSingle();
      const freshCfg: SarvamConfig = { ...DEFAULT_CONFIG, ...((fresh?.config as SarvamConfig) || {}) };
      return json({
        ok: true,
        configured: !!fresh?.api_key_last4 && !!freshCfg.org_id && !!freshCfg.workspace_id && !!freshCfg.app_id,
        integration: fresh
          ? {
            id: fresh.id,
            branch_id: fresh.branch_id,
            is_active: fresh.is_active,
            api_key_masked: fresh.api_key_last4 ? `${"•".repeat(8)}${fresh.api_key_last4}` : "",
            has_api_key: !!fresh.api_key_last4,
            api_key_set_at: fresh.api_key_set_at,
            last_check_at: fresh.last_check_at,
            last_check_status: fresh.last_check_status,
            last_check_error: fresh.last_check_error,
            retention_automation: fresh.retention_automation,
            updated_at: fresh.updated_at,
          }
          : null,
        config: publicConfig(freshCfg),
        ...extra,
      });
    };

    // ---- actions -----------------------------------------------------------
    if (action === "get_state") return await stateResponse();

    // Owner/admin only: the URLs + shared tokens to paste into the Sarvam
    // dashboard (webhook receiver and agent tool endpoint).
    if (action === "get_endpoints") {
      const base = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
      return json({
        ok: true,
        endpoints: {
          webhook_url: `${base}/sarvam-voice-webhook?t=${encodeURIComponent(cfg.webhook_token ?? "")}`,
          tools_url: `${base}/sarvam-agent-tools`,
          tools_header: "X-Incline-Tool-Key",
          tools_token: cfg.tool_token ?? "",
          agent_input_variables: AGENT_INPUT_VARIABLES,
          agent_output_variables: AGENT_OUTPUT_VARIABLES,
        },
      });
    }

    // Structured backend readiness — the ONLY thing the UI may gate on.
    if (action === "get_readiness" || action === "get_sarvam_voice_readiness") {
      const probe = body.probe !== false;
      const key = row?.id ? await loadKey() : null;
      const readiness = await computeReadiness(sb, row ?? null, cfg, key, probe);
      if (row?.id && probe) {
        await sb.from("voice_provider_integrations").update({
          last_check_at: new Date().toISOString(),
          last_check_status: readiness.connected ? "connected" : "error",
          last_check_error: readiness.probe_error === "not_probed" ? null : readiness.probe_error,
        }).eq("id", row.id);
      }
      return await stateResponse({ readiness });
    }

    // Read-only eligibility preview. Places no calls, contacts nobody.
    if (action === "run_eligibility_check") {
      const a = ((row?.retention_automation || {}) as Record<string, unknown>) ?? {};
      const branchIds = Array.isArray(a.branch_ids) && a.branch_ids.length ? a.branch_ids : null;
      const { data, error } = await sb.rpc("voice_retention_eligibility", {
        _min_absent_days: Number(a.min_absent_days ?? 7),
        _cooldown_days: Number(a.cooldown_days ?? 7),
        _daily_cap: Number(a.max_calls_per_day ?? 25),
        _window_start: String(a.window_start ?? cfg.window_start ?? "10:00"),
        _window_end: String(a.window_end ?? cfg.window_end ?? "19:00"),
        _branch_ids: branchIds,
      });
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, eligibility: data });
    }


    if (action === "save_config") {
      const nextCfg = sanitizeConfig((body.config || {}) as Record<string, unknown>, cfg);
      const apiKey = typeof body.api_key === "string" ? body.api_key.trim() : "";

      const payload: Record<string, unknown> = {
        provider: PROVIDER,
        branch_id: branchId,
        config: nextCfg,
        updated_by: userId,
      };
      if (apiKey) {
        payload.api_key_last4 = apiKey.slice(-4);
        payload.api_key_set_at = new Date().toISOString();
      }

      let integrationId = row?.id as string | undefined;
      if (integrationId) {
        const { error } = await sb.from("voice_provider_integrations").update(payload).eq("id", integrationId);
        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await sb
          .from("voice_provider_integrations")
          .insert({ ...payload, created_by: userId, is_active: false })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        integrationId = data.id;
      }

      if (apiKey && integrationId) {
        const { error } = await sb
          .from("voice_provider_secrets")
          .upsert({ integration_id: integrationId, api_key: apiKey, updated_at: new Date().toISOString() });
        if (error) throw new Error(error.message);
      }
      return await stateResponse({ saved: true });
    }

    if (action === "save_automation") {
      if (!row?.id) return json({ ok: false, error: "Save the Sarvam configuration first.", code: "not_configured" });
      const a = (body.retention_automation || {}) as Record<string, unknown>;
      const current = (row.retention_automation || {}) as Record<string, unknown>;
      // Turning retention calls ON is the single most dangerous switch here:
      // it may only flip once the provider itself reports a working outbound
      // path AND a real test call has already succeeded.
      if (a.enabled === true && !current.enabled) {
        const key = await loadKey();
        const readiness = await computeReadiness(sb, row, cfg, key, true);
        if (!readiness.production_ready || !readiness.test_call_available || !readiness.successful_test_call) {
          return json({
            ok: false,
            error: "Complete Voice AI setup before enabling retention calls.",
            readiness,
          });
        }
      }

      const next = {
        ...current,
        enabled: typeof a.enabled === "boolean" ? a.enabled : !!current.enabled,
        min_absent_days: Math.min(365, Math.max(1, Number(a.min_absent_days ?? current.min_absent_days ?? 7))),
        timezone: "Asia/Kolkata",
        window_start: String(a.window_start ?? current.window_start ?? "10:00"),
        window_end: String(a.window_end ?? current.window_end ?? "19:00"),
        max_calls_per_day: Math.min(2000, Math.max(1, Number(a.max_calls_per_day ?? current.max_calls_per_day ?? 25))),
        cooldown_days: Math.min(90, Math.max(0, Number(a.cooldown_days ?? current.cooldown_days ?? 7))),
        require_active_membership: a.require_active_membership !== false,
        require_no_dnc: true,
        exclude_recent_human_contact_days: Math.min(
          90,
          Math.max(0, Number(a.exclude_recent_human_contact_days ?? current.exclude_recent_human_contact_days ?? 3)),
        ),
        branch_ids: Array.isArray(a.branch_ids) ? a.branch_ids : (current.branch_ids ?? []),
      };
      const { error } = await sb
        .from("voice_provider_integrations")
        .update({ retention_automation: next, updated_by: userId })
        .eq("id", row.id);
      if (error) throw new Error(error.message);
      return await stateResponse({ saved: true });
    }

    if (action === "set_active") {
      if (!row?.id) return json({ ok: false, error: "Save the Sarvam configuration first.", code: "not_configured" });
      const enable = body.is_active === true;
      if (enable) {
        const key = await loadKey();
        if (!key) return json({ ok: false, error: "Add the Sarvam API key before enabling.", code: "no_api_key" });
        const readiness = await computeReadiness(sb, row, cfg, key, true);
        if (!readiness.test_call_available) {
          return json({
            ok: false,
            error: setupBlocker(readiness) ?? "Sarvam is not ready for outbound calling.",
            code: "not_ready",
            readiness,
          });
        }
      }
      const { error } = await sb
        .from("voice_provider_integrations")
        .update({ is_active: enable, updated_by: userId })
        .eq("id", row.id);
      if (error) throw new Error(error.message);
      return await stateResponse({ saved: true });
    }

    if (action === "test_connection") {
      if (!row?.id) return json({ ok: false, error: "Save the Sarvam configuration first.", code: "not_configured" });
      const key = await loadKey();
      if (!key) return json({ ok: false, error: "No Sarvam API key stored.", code: "no_api_key" });
      try {
        const result = await checkConnection(key, cfg);
        await sb.from("voice_provider_integrations").update({
          last_check_at: new Date().toISOString(),
          last_check_status: "connected",
          last_check_error: null,
        }).eq("id", row.id);
        return await stateResponse({ test: { ...result, ok: true } });
      } catch (e) {
        const err = e instanceof SarvamError ? e : new SarvamError(redact((e as Error).message), "sarvam_unknown");
        await sb.from("voice_provider_integrations").update({
          last_check_at: new Date().toISOString(),
          last_check_status: "error",
          last_check_error: `${err.code}: ${err.message}`.slice(0, 500),
        }).eq("id", row.id);
        return await stateResponse({ test: { ok: false, code: err.code, error: err.message } });
      }
    }

    // ---- shared call-placement engine --------------------------------------
    // Every outbound call in the product funnels through here: readiness →
    // window → do-not-contact → atomic slot claim → Sarvam Instant Outbound →
    // ledger update. No other path may dial.
    type PlaceResult = {
      ok: boolean;
      error?: string;
      code?: string;
      attempt_id?: string;
      call_record_id?: string;
      phone?: string;
      member_id?: string | null;
    };

    const placeOne = async (
      opts: {
        to: string;
        source: string;
        reason: string;
        memberId?: string | null;
        branchIdForCall?: string | null;
        cooldownDays?: number;
        vars?: Record<string, string>;
        apiKey: string;
      },
    ): Promise<PlaceResult> => {
      const to = normalizePhone(opts.to);
      if (!isValidIndianMobile(to)) {
        return { ok: false, error: "Not a valid Indian mobile number.", code: "invalid_number", phone: to };
      }

      // Do-not-contact across members (via profile phone), leads and chat settings.
      const [{ data: dncProfiles }, { data: dncLead }, { data: dncChat }] = await Promise.all([
        sb.from("profiles").select("id, full_name, gender").eq("phone", to).limit(5),
        sb.from("leads").select("id").eq("phone", to).eq("do_not_contact", true).limit(1),
        sb.from("whatsapp_chat_settings").select("id").eq("phone_number", to).eq("do_not_contact", true).limit(1),
      ]);
      let memberBlocked = false;
      const profileIds = (dncProfiles || []).map((p: { id: string }) => p.id);
      if (profileIds.length) {
        const { data: mem } = await sb
          .from("members")
          .select("id")
          .in("user_id", profileIds)
          .eq("do_not_contact", true)
          .limit(1);
        memberBlocked = (mem?.length ?? 0) > 0;
      }
      if (memberBlocked || (dncLead?.length ?? 0) > 0 || (dncChat?.length ?? 0) > 0) {
        return { ok: false, error: "This number is marked do-not-contact.", code: "do_not_contact", phone: to };
      }

      // Atomic slot claim: daily cap + concurrency + duplicate live call.
      const { data: claim, error: claimErr } = await sb.rpc("voice_claim_call_slot", {
        _provider: PROVIDER,
        _branch_id: opts.branchIdForCall ?? branchId,
        _source: opts.source,
        _reason: opts.reason,
        _phone: to,
        _member_id: opts.memberId ?? null,
        _lead_id: null,
        _agent_id: cfg.app_id ?? null,
        _agent_version: cfg.app_version ?? null,
        _daily_cap: cfg.daily_call_cap ?? 25,
        _max_concurrent: cfg.max_concurrent_calls ?? 1,
        _cooldown_days: opts.cooldownDays ?? 0,
        _eligibility: {
          checked: ["readiness", "window", "do_not_contact", "daily_cap", "concurrency", "duplicate"],
          window: `${cfg.window_start}-${cfg.window_end} IST`,
        },
        _created_by: userId,
      });
      if (claimErr) return { ok: false, error: claimErr.message, code: "claim_failed", phone: to };
      const claimed = claim as { ok: boolean; attempt_row_id?: string; error?: string; error_code?: string };
      if (!claimed?.ok) {
        return { ok: false, error: claimed?.error ?? "Unable to start the call.", code: claimed?.error_code, phone: to };
      }
      const attemptRowId = claimed.attempt_row_id!;

      // Personalisation: greet the callee by name when the number is known.
      const callerProfile = (dncProfiles || [])[0] as
        | { id: string; full_name?: string | null; gender?: string | null }
        | undefined;
      let calleeName = opts.vars?.member_name || callerProfile?.full_name || "";
      let calleeCode = opts.vars?.member_code ?? "";
      let calleeBranch = opts.vars?.branch_name || "Incline";
      if (callerProfile && (!calleeCode || calleeBranch === "Incline")) {
        const { data: memberRow } = await sb
          .from("members")
          .select("member_code, branch_id")
          .eq("user_id", callerProfile.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        calleeCode = calleeCode || ((memberRow as { member_code?: string } | null)?.member_code ?? "");
        const bId = (memberRow as { branch_id?: string } | null)?.branch_id;
        if (bId && calleeBranch === "Incline") {
          const { data: br } = await sb.from("branches").select("name").eq("id", bId).maybeSingle();
          calleeBranch = (br as { name?: string } | null)?.name ?? calleeBranch;
        }
      }
      if (!calleeName) calleeName = "there";

      const webhookUrl =
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/sarvam-voice-webhook?t=${encodeURIComponent(cfg.webhook_token ?? "")}`;
      try {
        const { attempt_id } = await createOutboundCall(opts.apiKey, cfg, {
          to,
          agentVariables: buildAgentVariables({
            preferred_language: "Hindi",
            ...(opts.vars ?? {}),
            call_reason: opts.reason,
            branch_name: calleeBranch,
            phone: to,
            member_name: calleeName,
            member_code: calleeCode,
            gender: opts.vars?.gender || (callerProfile?.gender ?? ""),
          }),
          webhookUrl: cfg.webhook_token ? webhookUrl : undefined,
          webhookMetadata: { attempt_ref: attemptRowId, source: opts.source },
        });
        await sb.from("voice_call_attempts").update({
          provider_call_id: attempt_id,
          status: "initiated",
        }).eq("id", attemptRowId);
        return { ok: true, attempt_id, call_record_id: attemptRowId, phone: to, member_id: opts.memberId ?? null };
      } catch (e) {
        const err = e instanceof SarvamError ? e : new SarvamError(redact((e as Error).message), "sarvam_unknown");
        await sb.from("voice_call_attempts").update({
          status: "failed",
          error_code: err.code,
          error_message: err.message.slice(0, 500),
          ended_at: new Date().toISOString(),
        }).eq("id", attemptRowId);
        return { ok: false, error: err.message, code: err.code, phone: to, call_record_id: attemptRowId };
      }
    };

    /** Readiness + calling window gate shared by every dialling action. */
    const dialGate = async (): Promise<{ blocked?: Response; key?: string }> => {
      const key = await loadKey();
      const readiness = await computeReadiness(sb, row!, cfg, key, true);
      if (!readiness.test_call_available) {
        return {
          blocked: json({
            ok: false,
            error: setupBlocker(readiness) ?? "Sarvam is not ready for outbound calls.",
            code: "not_ready",
            readiness,
          }),
        };
      }
      const nowMin = istMinutesNow();
      const startMin = hhmmToMinutes(cfg.window_start, 600);
      const endMin = hhmmToMinutes(cfg.window_end, 1140);
      if (nowMin < startMin || nowMin >= endMin) {
        return {
          blocked: json({
            ok: false,
            error: `Outside the configured calling window (${cfg.window_start}–${cfg.window_end} IST).`,
            code: "outside_window",
          }),
        };
      }
      return { key: key! };
    };

    if (action === "test_call") {
      if (!row?.id) return json({ ok: false, error: "Save the Sarvam configuration first.", code: "not_configured" });
      if (body.confirmed !== true) {
        return json({ ok: false, error: "Confirmation is required before placing a test call.", code: "not_confirmed" });
      }
      const to = normalizePhone(String(body.to || ""));
      if (!isValidIndianMobile(to)) {
        return json({ ok: false, error: "Enter a valid Indian mobile number (+91XXXXXXXXXX).", code: "invalid_number" });
      }
      const gate = await dialGate();
      if (gate.blocked) return gate.blocked;
      const res = await placeOne({ to, source: "manual_test", reason: "manual_test", apiKey: gate.key! });
      return json(res);
    }

    // Operator-triggered single call to one member (no automation, no cron).
    if (action === "place_call") {
      if (!row?.id) return json({ ok: false, error: "Save the Sarvam configuration first.", code: "not_configured" });
      if (body.confirmed !== true) {
        return json({ ok: false, error: "Confirmation is required before placing a call.", code: "not_confirmed" });
      }
      const gate = await dialGate();
      if (gate.blocked) return gate.blocked;

      const memberId: string | null = typeof body.member_id === "string" ? body.member_id : null;
      let to = normalizePhone(String(body.to || ""));
      let vars: Record<string, string> = {};
      let callBranch: string | null = null;
      if (memberId) {
        const ctx = await memberCallContext(sb, memberId);
        if (!ctx) return json({ ok: false, error: "Member not found.", code: "not_found" });
        to = to || ctx.phone;
        vars = ctx.vars;
        callBranch = ctx.branch_id;
      }
      if (!isValidIndianMobile(to)) {
        return json({ ok: false, error: "No valid mobile number for this member.", code: "invalid_number" });
      }
      const res = await placeOne({
        to,
        source: memberId ? "member_retention" : "manual_test",
        reason: String(body.reason || (memberId ? "member_retention" : "manual_test")),
        memberId,
        branchIdForCall: callBranch,
        cooldownDays: memberId ? Number(body.cooldown_days ?? 7) : 0,
        vars,
        apiKey: gate.key!,
      });
      return json(res);
    }

    // Operator-triggered batch over the existing retention eligibility engine.
    // Nothing here runs on a schedule — a human must call it.
    if (action === "run_batch") {
      if (!row?.id) return json({ ok: false, error: "Save the Sarvam configuration first.", code: "not_configured" });
      if (body.confirmed !== true) {
        return json({ ok: false, error: "Confirmation is required before running a batch.", code: "not_confirmed" });
      }
      const gate = await dialGate();
      if (gate.blocked) return gate.blocked;

      const a = ((row.retention_automation || {}) as Record<string, unknown>) ?? {};
      // Retention runs obey the retention window, which is stricter than the
      // integration-wide calling window used for test calls.
      const rNow = istMinutesNow();
      const rStart = hhmmToMinutes(String(a.window_start ?? "10:00"), 600);
      const rEnd = hhmmToMinutes(String(a.window_end ?? "19:00"), 1140);
      // An operator may explicitly override the retention window for a
      // supervised run; the wider integration calling window (dialGate) and
      // every other safety check still apply.
      if ((rNow < rStart || rNow >= rEnd) && body.override_window !== true) {
        return json({
          ok: false,
          error: `Outside the retention calling window (${a.window_start ?? "10:00"}–${a.window_end ?? "19:00"} IST).`,
          code: "outside_window",
        });
      }
      const minAbsent = Number(body.min_absent_days ?? a.min_absent_days ?? 7);
      const cooldown = Number(body.cooldown_days ?? a.cooldown_days ?? 7);
      const limit = Math.min(50, Math.max(1, Number(body.limit ?? 5)));
      const branchIds = branchId
        ? [branchId]
        : (Array.isArray(a.branch_ids) && a.branch_ids.length ? a.branch_ids as string[] : null);

      const { data: candidates, error: candErr } = await sb.rpc("voice_retention_candidates", {
        _min_absent_days: minAbsent,
        _cooldown_days: cooldown,
        _branch_ids: branchIds,
      });
      if (candErr) return json({ ok: false, error: candErr.message, code: "candidates_failed" }, 500);

      const eligible = ((candidates || []) as Array<Record<string, unknown>>)
        .filter((c) =>
          !c.missing_phone && !c.dnd && !c.paused && !c.too_recent && !c.in_cooldown && !c.contacted_today
        )
        .slice(0, limit);

      const results: PlaceResult[] = [];
      for (const c of eligible) {
        const memberId = String(c.member_id);
        const ctx = await memberCallContext(sb, memberId);
        const res = await placeOne({
          to: String(ctx?.phone || c.phone || ""),
          source: "member_retention",
          reason: "member_retention",
          memberId,
          branchIdForCall: (c.branch_id as string) ?? null,
          cooldownDays: cooldown,
          vars: ctx?.vars ?? {},
          apiKey: gate.key!,
        });
        results.push(res);
        // Serialise: concurrency is capped at max_concurrent_calls anyway and
        // the slot claim will reject overshoot, so pace politely.
        await new Promise((r) => setTimeout(r, 1200));
      }
      const placed = results.filter((r) => r.ok).length;
      return json({
        ok: true,
        candidates: eligible.length,
        placed,
        skipped: results.length - placed,
        results,
      });
    }

    // Live success-ratio metrics straight off the ledger.
    if (action === "metrics") {
      const days = Math.min(90, Math.max(1, Number(body.days ?? 7)));
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const { data: rows, error } = await sb
        .from("voice_call_attempts")
        .select("status, source, disposition, duration_seconds, started_at, error_code")
        .eq("provider", PROVIDER)
        .gte("started_at", since)
        .order("started_at", { ascending: false })
        .limit(2000);
      if (error) return json({ ok: false, error: error.message }, 500);
      const list = (rows || []) as Array<Record<string, unknown>>;
      const byStatus: Record<string, number> = {};
      const byDisposition: Record<string, number> = {};
      const byError: Record<string, number> = {};
      let connected = 0;
      let durationTotal = 0;
      for (const r of list) {
        const s = String(r.status ?? "unknown");
        byStatus[s] = (byStatus[s] ?? 0) + 1;
        if (["connected", "answered", "completed"].includes(s)) connected++;
        if (r.disposition) {
          const d = String(r.disposition);
          byDisposition[d] = (byDisposition[d] ?? 0) + 1;
        }
        if (r.error_code) {
          const e = String(r.error_code);
          byError[e] = (byError[e] ?? 0) + 1;
        }
        durationTotal += Number(r.duration_seconds ?? 0) || 0;
      }
      return json({
        ok: true,
        window_days: days,
        total: list.length,
        connected,
        connect_rate: list.length ? Math.round((connected / list.length) * 1000) / 10 : 0,
        avg_duration_seconds: connected ? Math.round(durationTotal / connected) : 0,
        by_status: byStatus,
        by_disposition: byDisposition,
        by_error: byError,
      });
    }



    return json({ ok: false, error: `Unknown action: ${action}`, code: "unknown_action" });
  } catch (e) {
    console.error("sarvam-voice error:", redact((e as Error)?.message));
    return json({ ok: false, error: redact((e as Error)?.message || "Unexpected error") }, 500);
  }
});

// keep maskKey referenced for future masked echoes without leaking the key
export const _maskKey = maskKey;
