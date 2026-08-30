// v1.0.0 — Sarvam Voice AI control plane (owner/admin only).
//
// Actions: get_state | save_config | save_automation | set_active |
//          test_connection | test_call
//
// The Sarvam API key lives in public.voice_provider_secrets, which has no
// grants and no policies — only this function (service role) can read it.
// It is never returned to the browser and never written to a log.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  admin,
  checkConnection,
  corsHeaders,
  createOutboundCall,
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
  daily_call_cap: 50,
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

function istDayStartUtc(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - 5.5 * 3600_000).toISOString();
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
  };
}

function publicConfig(cfg: SarvamConfig) {
  const { webhook_token: _t, ...rest } = cfg;
  return rest;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ ok: false, error: "Unauthorized" }, 401);

    const sbAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims } = await sbAuth.auth.getClaims(token);
    const userId = claims?.claims?.sub as string | undefined;
    if (!userId) return json({ ok: false, error: "Unauthorized" }, 401);

    const sb = admin();
    const { data: roleRows } = await sb.from("user_roles").select("role").eq("user_id", userId);
    const roles = (roleRows || []).map((r: { role: string }) => r.role);
    if (!roles.some((r) => r === "owner" || r === "admin")) {
      return json({ ok: false, error: "Forbidden — owner or admin only" }, 403);
    }

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
      if (!row?.id) return json({ ok: false, error: "Save the Sarvam configuration first." }, 400);
      const a = (body.retention_automation || {}) as Record<string, unknown>;
      const current = (row.retention_automation || {}) as Record<string, unknown>;
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
      if (!row?.id) return json({ ok: false, error: "Save the Sarvam configuration first." }, 400);
      const enable = body.is_active === true;
      if (enable) {
        const key = await loadKey();
        if (!key) return json({ ok: false, error: "Add the Sarvam API key before enabling." }, 400);
        if (!cfg.org_id || !cfg.workspace_id || !cfg.app_id) {
          return json({ ok: false, error: "Organization, workspace and agent IDs are required before enabling." }, 400);
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
      if (!row?.id) return json({ ok: false, error: "Save the Sarvam configuration first." }, 400);
      const key = await loadKey();
      if (!key) return json({ ok: false, error: "No Sarvam API key stored." }, 400);
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

    if (action === "test_call") {
      if (!row?.id) return json({ ok: false, error: "Save the Sarvam configuration first." }, 400);
      if (!row.is_active) return json({ ok: false, error: "Enable the Sarvam integration before placing calls." }, 400);
      if (body.confirmed !== true) {
        return json({ ok: false, error: "Confirmation is required before placing a test call." }, 400);
      }
      const to = normalizePhone(String(body.to || ""));
      if (!isValidIndianMobile(to)) {
        return json({ ok: false, error: "Enter a valid Indian mobile number (+91XXXXXXXXXX)." }, 400);
      }

      // Calling window (Asia/Kolkata)
      const nowMin = istMinutesNow();
      const startMin = hhmmToMinutes(cfg.window_start, 600);
      const endMin = hhmmToMinutes(cfg.window_end, 1140);
      if (nowMin < startMin || nowMin >= endMin) {
        return json({
          ok: false,
          error: `Outside the configured calling window (${cfg.window_start}–${cfg.window_end} IST).`,
        }, 400);
      }

      // Do-not-contact
      const [{ data: dncMember }, { data: dncLead }] = await Promise.all([
        sb.from("members").select("id").eq("phone", to).eq("do_not_contact", true).limit(1),
        sb.from("leads").select("id").eq("phone", to).eq("do_not_contact", true).limit(1),
      ]);
      if ((dncMember?.length ?? 0) > 0 || (dncLead?.length ?? 0) > 0) {
        return json({ ok: false, error: "This number is marked do-not-contact." }, 400);
      }

      // Daily cap (IST day)
      const { count: todayCount } = await sb
        .from("voice_call_attempts")
        .select("id", { count: "exact", head: true })
        .eq("provider", PROVIDER)
        .gte("started_at", istDayStartUtc());
      if ((todayCount ?? 0) >= (cfg.daily_call_cap ?? 50)) {
        return json({ ok: false, error: "Daily call cap reached." }, 400);
      }

      // Concurrency guard
      const { count: liveCount } = await sb
        .from("voice_call_attempts")
        .select("id", { count: "exact", head: true })
        .eq("provider", PROVIDER)
        .in("status", ["queued", "ringing"]);
      if ((liveCount ?? 0) >= (cfg.max_concurrent_calls ?? 1)) {
        return json({ ok: false, error: "Another voice call is already in progress. Wait for it to finish." }, 409);
      }

      // Claim the phone number — partial unique index rejects a duplicate live call.
      const { data: attempt, error: claimErr } = await sb
        .from("voice_call_attempts")
        .insert({
          branch_id: branchId,
          provider: PROVIDER,
          source: "manual_test",
          phone: to,
          agent_id: cfg.app_id ?? null,
          agent_version: cfg.app_version ?? null,
          status: "queued",
          created_by: userId,
          eligibility_snapshot: {
            checked: ["window", "do_not_contact", "daily_cap", "concurrency"],
            window: `${cfg.window_start}-${cfg.window_end} IST`,
          },
        })
        .select("id")
        .single();
      if (claimErr) {
        const dup = /duplicate key|unique/i.test(claimErr.message);
        return json({
          ok: false,
          error: dup ? "A call to this number is already in progress." : claimErr.message,
        }, dup ? 409 : 500);
      }

      const key = await loadKey();
      if (!key) {
        await sb.from("voice_call_attempts").update({
          status: "failed",
          error_code: "config_incomplete",
          error_message: "No Sarvam API key stored.",
          ended_at: new Date().toISOString(),
        }).eq("id", attempt.id);
        return json({ ok: false, error: "No Sarvam API key stored." }, 400);
      }

      const webhookUrl =
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/sarvam-voice-webhook?t=${encodeURIComponent(cfg.webhook_token ?? "")}`;
      try {
        const { attempt_id } = await createOutboundCall(key, cfg, {
          to,
          agentVariables: { call_reason: "manual_test", source: "incline_crm" },
          webhookUrl: cfg.webhook_token ? webhookUrl : undefined,
          webhookMetadata: { attempt_ref: attempt.id, source: "manual_test" },
        });
        await sb.from("voice_call_attempts").update({
          provider_call_id: attempt_id,
          status: "ringing",
        }).eq("id", attempt.id);
        return json({ ok: true, attempt_id, call_record_id: attempt.id });
      } catch (e) {
        const err = e instanceof SarvamError ? e : new SarvamError(redact((e as Error).message), "sarvam_unknown");
        await sb.from("voice_call_attempts").update({
          status: "failed",
          error_code: err.code,
          error_message: err.message.slice(0, 500),
          ended_at: new Date().toISOString(),
        }).eq("id", attempt.id);
        return json({ ok: false, error: err.message, code: err.code }, 200);
      }
    }

    return json({ ok: false, error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("sarvam-voice error:", redact((e as Error)?.message));
    return json({ ok: false, error: redact((e as Error)?.message || "Unexpected error") }, 500);
  }
});

// keep maskKey referenced for future masked echoes without leaking the key
export const _maskKey = maskKey;
