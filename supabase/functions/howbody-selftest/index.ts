// TEMPORARY diagnostic — verifies the stored HOWBODY credentials against the
// vendor API (getToken) and echoes only non-secret status information.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const base = (Deno.env.get("HOWBODY_BASE_URL") || "").replace(/\/+$/, "");
  const userName = Deno.env.get("HOWBODY_USERNAME") || "";
  const appKey = Deno.env.get("HOWBODY_APPKEY") || "";

  const out: Record<string, unknown> = {
    base_url: base,
    username_configured: Boolean(userName),
    appkey_configured: Boolean(appKey),
    appkey_fingerprint: appKey ? `${appKey.slice(0, 4)}…${appKey.slice(-4)}` : null,
  };

  try {
    const res = await fetch(`${base}/openApi/getToken`, {
      method: "POST",
      headers: { "Content-Type": "application/json", appkey: appKey },
      body: JSON.stringify({ userName, appkey: appKey }),
    });
    const text = await res.text();
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    out.getToken_status = res.status;
    out.getToken_code = parsed?.code ?? null;
    out.getToken_msg = parsed?.msg ?? parsed?.message ?? text.slice(0, 200);
    out.token_received = Boolean(parsed?.data?.token || parsed?.token || parsed?.data);
  } catch (e) {
    out.getToken_error = e instanceof Error ? e.message : String(e);
  }

  return new Response(JSON.stringify(out, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
