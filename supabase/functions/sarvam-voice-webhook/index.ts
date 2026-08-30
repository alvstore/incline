// v1.1.0 — Sarvam Instant Outbound webhook receiver.
//
// Public endpoint, authenticated by the ?t=<webhook_token> shared secret stored
// in the integration config (constant-time compared). Persists the full
// documented payload — status, channel_info, duration, interaction_id,
// failure_reason, final_agent_variables, transcript — onto the call ledger and
// turns the agent's structured outcome into CRM follow-up.
//
// Payload reference: docs.sarvam.ai/conversations/api/instant-outbound/webhook
import { admin, corsHeaders, json, normalizeCallStatus, redact } from "../_shared/sarvam.ts";

/** Length-safe constant-time comparison. */
function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

type Vars = Record<string, unknown>;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
    const token = new URL(req.url).searchParams.get("t") || "";
    if (!token) return json({ ok: false, error: "Unauthorized" }, 401);

    const sb = admin();
    const { data: rows } = await sb
      .from("voice_provider_integrations")
      .select("id, config")
      .eq("provider", "sarvam");
    const match = (rows || []).find((r: { config: Record<string, unknown> }) => {
      const stored = (r.config as { webhook_token?: string })?.webhook_token;
      return !!stored && timingSafeEqual(stored, token);
    });
    if (!match) return json({ ok: false, error: "Unauthorized" }, 401);

    const payload = await req.json().catch(() => ({}));
    const attemptId = payload?.attempt_id ? String(payload.attempt_id) : null;
    const ref = payload?.webhook_config?.metadata?.attempt_ref
      ? String(payload.webhook_config.metadata.attempt_ref)
      : null;
    if (!attemptId && !ref) return json({ ok: false, error: "Missing attempt identifiers" }, 400);

    // Locate the ledger row first so we can merge (never clobber) context.
    const finder = sb.from("voice_call_attempts").select(
      "id, branch_id, member_id, lead_id, phone, context_payload",
    );
    const { data: existing } = ref
      ? await finder.eq("id", ref).maybeSingle()
      : await finder.eq("provider_call_id", attemptId!).maybeSingle();
    if (!existing) return json({ ok: true, ignored: "no matching attempt" });

    const vars = (payload?.final_agent_variables ?? {}) as Vars;
    const providerStatus = payload?.status ? String(payload.status) : null;
    const disposition = typeof vars.call_disposition === "string" && vars.call_disposition
      ? String(vars.call_disposition)
      : providerStatus;

    const context = {
      ...((existing.context_payload as Vars) || {}),
      channel_info: payload?.channel_info ?? null,
      final_agent_variables: vars,
      transcript: payload?.interaction_transcript ?? payload?.transcript ?? null,
      provider_status: providerStatus,
      webhook_received_at: new Date().toISOString(),
    };

    const { error } = await sb.from("voice_call_attempts").update({
      status: normalizeCallStatus(providerStatus),
      disposition,
      duration_seconds: typeof payload?.duration === "number" ? payload.duration : null,
      provider_interaction_id: payload?.interaction_id ? String(payload.interaction_id) : null,
      provider_call_id: attemptId ?? undefined,
      error_message: payload?.failure_reason ? redact(String(payload.failure_reason)) : null,
      error_code: payload?.failure_reason ? "provider_failure" : null,
      ended_at: new Date().toISOString(),
      context_payload: context,
    }).eq("id", existing.id);
    if (error) throw new Error(error.message);

    // ---- structured outcome → CRM follow-up -------------------------------
    try {
      const branchId = existing.branch_id as string | null;
      const phone = String(existing.phone);
      const callback = typeof vars.callback_datetime === "string" ? vars.callback_datetime : null;
      const reason = typeof vars.reason_for_absence === "string" ? vars.reason_for_absence : null;
      const summary = typeof vars.call_summary === "string" ? vars.call_summary.slice(0, 600) : null;
      const nextStep = typeof vars.next_step_agreed === "string" ? vars.next_step_agreed.slice(0, 400) : null;
      const trail = [
        summary ? `Summary: ${summary}` : null,
        reason ? `Reason given: ${reason}` : null,
        nextStep ? `Next step: ${nextStep}` : null,
      ].filter(Boolean).join(" ");

      const makeTask = async (title: string, description: string, priority: string) => {
        if (!branchId) return;
        await sb.from("tasks").insert({
          branch_id: branchId,
          title,
          description,
          priority,
          due_date: (callback ? new Date(callback) : new Date()).toISOString().slice(0, 10),
          linked_entity_type: existing.member_id ? "member" : existing.lead_id ? "lead" : null,
          linked_entity_id: (existing.member_id ?? existing.lead_id) as string | null,
        });
      };

      if (disposition === "callback_requested") {
        await makeTask(
          "Voice AI: member requested a callback",
          `Retention call outcome: callback requested${callback ? ` for ${callback}` : ""}. Phone ${phone}. ${trail}`,
          "high",
        );
      } else if (disposition === "complaint") {
        await makeTask(
          "Voice AI: complaint raised on retention call",
          `The member raised a complaint during the Voice AI retention call. Phone ${phone}. ${trail}`,
          "urgent",
        );
      } else if (disposition === "needs_human") {
        await makeTask(
          "Voice AI: human follow-up needed",
          `The agent could not resolve the member's request on the call. Phone ${phone}. ${trail}`,
          "high",
        );
      } else if (disposition === "wrong_person") {
        await sb.rpc("mark_do_not_contact", {
          p_phone: phone,
          p_branch_id: branchId,
          p_reason: "voice_ai_wrong_person",
          p_source: "sarvam_voice",
        });
      }
      // "not_interested" and "no_clear_outcome" intentionally trigger no CRM
      // action: the attempt row itself enforces the retention cooldown. Opting
      // a member out of every channel is a decision only a human should make.
    } catch (followUpError) {
      console.error("sarvam-voice-webhook follow-up failed:", redact((followUpError as Error)?.message));
    }

    return json({ ok: true });
  } catch (e) {
    console.error("sarvam-voice-webhook error:", redact((e as Error)?.message));
    return json({ ok: false, error: "Webhook processing failed" }, 500);
  }
});
