// renewal-engine-tick v1.1.0 — Phase 2 renewal orchestrator.
// Passive until renewal_engine_config.enabled = true (global row default false).
// - single-flight lease (renewal_engine_acquire_lease)
// - bounded batch per run + per-day cap
// - all sending routed through dispatch-communication (never a send-* fn)
// - stage dedupe enforced in DB (renewal_case_events unique index)
// - circuit breaker: pauses the engine after repeated dispatch failures
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureEdgeError } from "../_shared/capture-edge-error.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BATCH_LIMIT = 50;

interface DueCase {
  case_id: string;
  branch_id: string;
  member_id: string;
  membership_id: string;
  stage_key: string;
  days_to_expiry: number;
  expiry_date: string;
  member_name: string;
  phone: string | null;
  email: string | null;
  plan_name: string | null;
  attempts_count: number;
  channel: string;
  voice_escalate_after: number;
}

function buildMessage(c: DueCase) {
  const plan = c.plan_name || "your membership";
  if (c.days_to_expiry > 0) {
    return `Hi ${c.member_name}, ${plan} at The Incline Life by Incline expires in ${c.days_to_expiry} day${c.days_to_expiry > 1 ? "s" : ""} (${c.expiry_date}). Reply here and we'll get your renewal sorted in a minute.`;
  }
  if (c.days_to_expiry === 0) {
    return `Hi ${c.member_name}, ${plan} expires today. Reply here and we'll renew it right away so your access stays on.`;
  }
  return `Hi ${c.member_name}, ${plan} expired on ${c.expiry_date}. We'd love to have you back — reply here and we'll reactivate you today.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    // Cron-only auth (same contract as the other automation-brain workers).
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const apikey = req.headers.get("apikey") || "";
    const sysCall = req.headers.get("x-system-call") || "";
    const isSystem = bearer === serviceKey || (apikey === serviceKey && sysCall === "automation-brain");
    if (!isSystem) return json({ error: "Unauthorized" }, 401);

    const dryRun = new URL(req.url).searchParams.get("dry_run") === "1";

    // Entry guard: paused / globally disabled → do nothing.
    const { data: state } = await admin
      .from("renewal_engine_state").select("paused, paused_reason, sent_today, sent_date").eq("id", "global").maybeSingle();
    if (state?.paused) {
      return json({ success: true, skipped: "paused", reason: state.paused_reason ?? null });
    }

    const { data: configs } = await admin
      .from("renewal_engine_config").select("branch_id, enabled, daily_cap, voice_auto_call_enabled, voice_stage_offsets");
    const anyEnabled = (configs || []).some((c) => c.enabled);
    if (!anyEnabled) return json({ success: true, skipped: "engine_disabled", sent: 0 });

    const globalCap = (configs || []).find((c) => c.branch_id === null)?.daily_cap ?? 100;
    const istToday = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const sentToday = state?.sent_date === istToday ? (state?.sent_today ?? 0) : 0;
    if (sentToday >= globalCap) return json({ success: true, skipped: "daily_cap_reached", sent_today: sentToday });

    // Single-flight lease
    const { data: leased } = await admin.rpc("renewal_engine_acquire_lease", {
      _ttl_seconds: 300, _holder: "renewal-engine-tick",
    });
    if (!leased) return json({ success: true, skipped: "already_running" });

    let sent = 0, failed = 0, skipped = 0, voiceCalls = 0;
    let pause = false, pauseReason: string | null = null;
    let lastError: string | null = null;

    try {
      const batch = Math.max(0, Math.min(BATCH_LIMIT, globalCap - sentToday));
      const { data: due, error: dueErr } = await admin.rpc("renewal_due_cases", { _limit: batch });
      if (dueErr) throw dueErr;

      const cases = (due || []) as DueCase[];
      if (dryRun) {
        await admin.rpc("renewal_engine_release_lease", { _status: "success", _error: null, _sent: 0 });
        return json({ success: true, dry_run: true, due_count: cases.length, cases: cases.slice(0, 10) });
      }

      for (const c of cases) {
        const channel = c.channel || "whatsapp";
        const recipient = channel === "email" ? c.email : c.phone;
        if (!recipient) { skipped++; continue; }

        const message = buildMessage(c);
        let status = "failed";
        let detail: string | null = null;

        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/dispatch-communication`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
            body: JSON.stringify({
              branch_id: c.branch_id,
              channel,
              category: "membership_reminder",
              recipient,
              member_id: c.member_id,
              payload: {
                subject: c.days_to_expiry >= 0 ? "Your membership is expiring" : "Come back to The Incline",
                body: message,
                variables: {
                  member_name: c.member_name,
                  plan_name: c.plan_name || "your membership",
                  expiry_date: c.expiry_date,
                  days_to_expiry: String(c.days_to_expiry),
                },
                use_branded_template: channel === "email",
              },
              dedupe_key: `renewal:${c.case_id}:${c.stage_key}`,
              ttl_seconds: 30 * 24 * 60 * 60,
            }),
          });
          const body = await res.json().catch(() => ({}));
          status = res.ok ? (body?.status || "sent") : "failed";
          detail = body?.error || body?.reason || null;
        } catch (e) {
          status = "failed";
          detail = e instanceof Error ? e.message : String(e);
        }

        await admin.rpc("renewal_mark_contacted", {
          _case_id: c.case_id,
          _stage_key: c.stage_key,
          _channel: channel,
          _status: status,
          _detail: detail,
          _payload: { days_to_expiry: c.days_to_expiry },
        });

        if (status === "sent" || status === "queued") sent++;
        else if (status === "skipped" || status === "suppressed") skipped++;
        else { failed++; lastError = detail; }
      }

      // Optional voice escalation: only for branches that switched it on, and
      // only on the configured day offsets. The single Ananya agent places the
      // call; cooldown + call windows stay owned by sarvam-voice.
      for (const c of cases) {
        const cfg = (configs || []).find((x: Record<string, unknown>) => x.branch_id === c.branch_id)
          ?? (configs || []).find((x: Record<string, unknown>) => x.branch_id === null);
        const voiceOn = Boolean((cfg as Record<string, unknown> | undefined)?.voice_auto_call_enabled);
        const offsets = ((cfg as Record<string, unknown> | undefined)?.voice_stage_offsets as number[] | null) ?? [-3, 0];
        // stage offsets are stored expiry-relative (negative = before expiry)
        if (!voiceOn || !c.phone) continue;
        if (!offsets.includes(-c.days_to_expiry)) continue;

        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/sarvam-voice`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
            body: JSON.stringify({
              action: "place_call",
              confirmed: true,
              member_id: c.member_id,
              reason: "member_renewal",
              cooldown_days: 3,
            }),
          });
          const body = await res.json().catch(() => ({}));
          if (body?.call_record_id) {
            await admin.rpc("renewal_link_voice_call", {
              _case_id: c.case_id,
              _attempt_id: body.call_record_id,
            });
            voiceCalls++;
          }
        } catch (e) {
          await captureEdgeError("renewal-engine-tick", e, { severity: "warning" });
        }
      }

      // Circuit breaker: an all-failure batch means the channel is broken.
      if (cases.length >= 5 && failed === cases.length) {
        pause = true;
        pauseReason = `All ${failed} dispatches failed: ${lastError ?? "unknown error"}`;
      }

    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      await admin.rpc("renewal_engine_release_lease", { _status: "error", _error: lastError, _sent: sent });
      await captureEdgeError("renewal-engine-tick", lastError, { severity: "error" });
      return json({ success: false, error: lastError, sent, failed }, 500);
    }

    await admin.rpc("renewal_engine_release_lease", {
      _status: failed > 0 ? "warning" : "success",
      _error: lastError,
      _sent: sent,
      _pause: pause,
      _pause_reason: pauseReason,
    });

    return json({ success: true, sent, failed, skipped, voice_calls: voiceCalls, paused: pause, paused_reason: pauseReason });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await captureEdgeError("renewal-engine-tick", e, { severity: "error" });
    return json({ success: false, error: msg }, 500);
  }
});
