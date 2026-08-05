// doc v1.0.0 — Public short-link resolver.
// Usage: /functions/v1/doc?c=<code>  → 302 to the stored target URL.
// Used so member-facing WhatsApp/SMS messages carry a short branded link
// instead of a 400-character signed storage URL.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const code = (url.searchParams.get("c") || url.pathname.split("/").pop() || "").trim();
    if (!code || code === "doc") {
      return new Response("Missing link code", { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: link } = await supabase
      .from("short_links")
      .select("id, target_url, clicks, expires_at")
      .eq("code", code)
      .maybeSingle();

    if (!link) return new Response("Link not found", { status: 404, headers: corsHeaders });
    if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
      return new Response("This link has expired. Please ask the team to resend it.", {
        status: 410,
        headers: corsHeaders,
      });
    }

    await supabase
      .from("short_links")
      .update({ clicks: (link.clicks ?? 0) + 1 })
      .eq("id", link.id);

    return new Response(null, { status: 302, headers: { Location: link.target_url } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return new Response(`Error: ${msg}`, { status: 500, headers: corsHeaders });
  }
});
