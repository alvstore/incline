// v1.0.0 — Admin test for HOWBODY API connectivity (calls getToken)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, getCachedToken } from "../_shared/howbody.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ ok: false, error: "Unauthorized" }, 401);
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims } = await sb.auth.getClaims(token);
    if (!claims?.claims?.sub) return json({ ok: false, error: "Unauthorized" }, 401);
    const { data: roleRows } = await sb.from("user_roles").select("role").eq("user_id", claims.claims.sub);
    const isAdmin = (roleRows ?? []).some((r: { role: string }) => r.role === "owner" || r.role === "admin");
    if (!isAdmin) return json({ ok: false, error: "Forbidden" }, 403);

    const t = await getCachedToken();
    return json({ ok: true, token_preview: t.token.slice(0, 16) + "…", expires_at: t.expires_at });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
