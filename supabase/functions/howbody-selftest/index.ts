// TEMPORARY diagnostic — verifies the stored HOWBODY credentials against the
// vendor API (getToken) and echoes only non-secret status information.
import { corsHeaders, getHowbodyCreds } from "../_shared/howbody.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const out: Record<string, unknown> = {};
  try {
    const { baseUrl, userName, appKey, source } = await getHowbodyCreds();
    out.base_url = baseUrl;
    out.creds_source = source;
    out.username_configured = Boolean(userName);
    out.appkey_configured = Boolean(appKey);
    out.appkey_fingerprint = appKey ? `${appKey.slice(0, 4)}…${appKey.slice(-4)}` : null;

    const res = await fetch(`${baseUrl}/openApi/getToken`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userName, appKey, timeStamp: Date.now() }),
    });
    const text = await res.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { /* non-JSON */ }
    out.getToken_status = res.status;
    out.getToken_code = parsed?.code ?? null;
    out.getToken_msg = parsed?.msg ?? parsed?.message ?? text.slice(0, 200);
    out.token_received = Boolean(parsed?.data?.token);
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  }

  return new Response(JSON.stringify(out, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
