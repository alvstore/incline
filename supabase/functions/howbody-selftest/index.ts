// v1.0.0 — TEMPORARY: authenticated smoke test for HOWBODY webhook receivers.
// Reads the stored App Key server-side (never returned) and replays synthetic
// payloads against both receivers so the authenticated path can be verified
// without exposing the credential. Safe: uses an unknown thirdUid, so no member
// data is written. Delete after validation.
import { corsHeaders, json, getExpectedWebhookAppKey } from "../_shared/howbody.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const appKey = await getExpectedWebhookAppKey();
    if (!appKey) return json({ ok: false, error: "no app key configured" }, 500);

    const base = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
    const dataKey = `selftest-${crypto.randomUUID()}`;
    const results: Record<string, unknown>[] = [];

    const cases = [
      { name: "body:auth-ok/unknown-member", fn: "howbody-body-webhook", key: appKey,
        body: { thirdUid: "SELFTEST-UNKNOWN", dataKey, equipmentNo: "HD102026048117", weight: 70 } },
      { name: "body:bad-appkey", fn: "howbody-body-webhook", key: `${appKey}x`,
        body: { thirdUid: "SELFTEST-UNKNOWN", dataKey, equipmentNo: "HD102026048117" } },
      { name: "body:missing-datakey", fn: "howbody-body-webhook", key: appKey,
        body: { thirdUid: "SELFTEST-UNKNOWN", equipmentNo: "HD102026048117" } },
      { name: "posture:auth-ok/unknown-member", fn: "howbody-posture-webhook", key: appKey,
        body: { thirdUid: "SELFTEST-UNKNOWN", dataKey: `${dataKey}-p`, equipmentNo: "HD102026048117" } },
      { name: "posture:bad-appkey", fn: "howbody-posture-webhook", key: `${appKey}x`,
        body: { thirdUid: "SELFTEST-UNKNOWN", dataKey: `${dataKey}-p` } },
    ];

    for (const c of cases) {
      const res = await fetch(`${base}/${c.fn}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", appkey: c.key },
        body: JSON.stringify(c.body),
      });
      const text = await res.text();
      results.push({ case: c.name, status: res.status, body: text.slice(0, 200) });
    }

    return json({ ok: true, results }, 200);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "error" }, 500);
  }
});
