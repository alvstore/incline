// v1.1.0 — only well-formed ids for feedback that was actually sent a review request are tracked.
// v1.0.0 — Public redirect endpoint. Records click then 302 to branch's
// Google review link. URL: /functions/v1/google-review-redirect?f={feedback_id}
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const feedbackId = url.searchParams.get("f");
    if (!feedbackId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(feedbackId)) {
      return new Response("Missing feedback id", { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: fb } = await supabase
      .from("feedback")
      .select("id, branch_id, google_review_requested_at")
      .eq("id", feedbackId)
      .maybeSingle();

    if (!fb || !fb.google_review_requested_at) return new Response("Not found", { status: 404, headers: corsHeaders });

    const { data: branch } = await supabase
      .from("branches")
      .select("google_review_link")
      .eq("id", fb.branch_id)
      .maybeSingle();

    if (!branch?.google_review_link) {
      return new Response("This branch has no Google review link configured.", {
        status: 412,
        headers: corsHeaders,
      });
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    const ipHash = ip ? await sha256(ip) : null;
    const userAgent = req.headers.get("user-agent") ?? null;

    // Fire-and-forget tracking; don't block redirect on errors
    void supabase.from("feedback_google_link_clicks").insert({
      feedback_id: fb.id,
      branch_id: fb.branch_id,
      ip_hash: ipHash,
      user_agent: userAgent,
    });

    void supabase
      .from("feedback")
      .update({ google_review_link_clicked_at: new Date().toISOString() })
      .eq("id", fb.id)
      .is("google_review_link_clicked_at", null);

    return new Response(null, {
      status: 302,
      headers: { ...corsHeaders, Location: branch.google_review_link },
    });
  } catch (err) {
    console.error("google-review-redirect error", err);
    return new Response("error", { status: 500, headers: corsHeaders });
  }
});
