// v1.0.0 — Sarvam Instant Outbound webhook receiver.
// Public endpoint, authenticated by the ?t=<webhook_token> shared secret stored
// in the integration config. Updates the voice_call_attempts ledger only.
import { admin, corsHeaders, json, normalizeCallStatus, redact } from "../_shared/sarvam.ts";

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
    const match = (rows || []).find(
      (r: { config: Record<string, unknown> }) => (r.config as { webhook_token?: string })?.webhook_token === token,
    );
    if (!match) return json({ ok: false, error: "Unauthorized" }, 401);

    const payload = await req.json().catch(() => ({}));
    const attemptId = payload?.attempt_id ? String(payload.attempt_id) : null;
    const ref = payload?.webhook_config?.metadata?.attempt_ref
      ? String(payload.webhook_config.metadata.attempt_ref)
      : null;
    if (!attemptId && !ref) return json({ ok: false, error: "Missing attempt identifiers" }, 400);

    const update = {
      status: normalizeCallStatus(payload?.status),
      disposition: payload?.status ? String(payload.status) : null,
      duration_seconds: typeof payload?.duration === "number" ? payload.duration : null,
      provider_interaction_id: payload?.interaction_id ? String(payload.interaction_id) : null,
      error_message: payload?.failure_reason ? redact(String(payload.failure_reason)) : null,
      error_code: payload?.failure_reason ? "provider_failure" : null,
      ended_at: new Date().toISOString(),
    };

    const q = sb.from("voice_call_attempts").update(update);
    const { error } = ref ? await q.eq("id", ref) : await q.eq("provider_call_id", attemptId!);
    if (error) throw new Error(error.message);

    return json({ ok: true });
  } catch (e) {
    console.error("sarvam-voice-webhook error:", redact((e as Error)?.message));
    return json({ ok: false, error: "Webhook processing failed" }, 500);
  }
});
