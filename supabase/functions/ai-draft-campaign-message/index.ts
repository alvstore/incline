// v2.1.0 — Brand alignment: "Incline" + branded shell. AI email body_html is a FRAGMENT
//          (no <html>/<head>/<body>/<style>); the send-email branded shell wraps it.
//          Brand color gold #EAB308 on dark; allowed classes: cta-btn, kpi, kpi-label, kpi-value, details.
// v2.0.0 — SSOT: routes through ai-runtime.generateOnce (purpose='campaign_draft').
// v1.0.0 — AI campaign message drafter (WhatsApp / SMS / Email).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateOnce } from "../_shared/ai-runtime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Channel = "whatsapp" | "sms" | "email";
type CampaignType = "promotion" | "event" | "announcement" | "lead_reengagement";

interface Body {
  channel: Channel;
  campaign_type?: CampaignType;
  prompt: string;
  brand?: string;
  audience_hint?: string;
  event_meta?: { name?: string; date?: string; time?: string; venue?: string; rsvp_url?: string };
  tone?: "warm" | "urgent" | "professional" | "playful";
}

const CHANNEL_RULES: Record<Channel, string> = {
  whatsapp: `WhatsApp Business broadcast. Body ≤ 850 chars. Variables in {{snake_case}} (always include {{first_name}}). Max 1 tasteful emoji. No URLs in body unless given. Indian-English, premium fitness tone. Plain text only.`,
  sms: `Indian DLT-compliant SMS. Body ≤ 160 chars (max 320). No emojis. No URLs. Variables in {{snake_case}}. Always end promotional copy with "-INCLNE".`,
  email: `Marketing email for Incline (premium fitness & recovery club).
subject ≤ 70 chars (no clickbait, no ALL CAPS). preheader ≤ 110 chars.
body_html MUST be a BODY FRAGMENT ONLY — do NOT output <html>, <head>, <body>, <style>, <script>, <meta>, <link>, or <title>. The send-email service wraps your fragment inside the branded shell (black background, gold #EAB308 accents, INCLINE header with "Rise. Reflect. Repeat." tagline, "The Incline Life by Incline" footer). Do NOT repeat the brand header or footer in your output.
Allowed tags: <h1>, <h2>, <h3>, <p>, <a>, <strong>, <em>, <ul>, <ol>, <li>, <br>, <hr>, <table>, <tr>, <td>, <img>.
Allowed shell classes (use them — no inline color overrides):
  • <a class="cta-btn" href="…">…</a>   single primary CTA
  • <div class="kpi"><p class="kpi-label">…</p><p class="kpi-value">…</p></div>
  • <table class="details"><tr><td>Label</td><td>Value</td></tr>…</table>
Do NOT set inline color/background styles — the shell handles theming.
body_text fallback (plain). Variables {{snake_case}}, always include {{first_name}}.`,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    // Provider/key handled by ai-runtime → ai-dispatcher.


    // Auth gate
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: Body = await req.json();
    if (!body.channel || !body.prompt?.trim()) {
      return new Response(JSON.stringify({ error: "channel and prompt required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const brand = body.brand ?? "Incline";
    const tone = body.tone ?? "warm";
    const eventLine = body.event_meta?.name
      ? `Event: ${body.event_meta.name}${body.event_meta.date ? " on " + body.event_meta.date : ""}${body.event_meta.time ? " at " + body.event_meta.time : ""}${body.event_meta.venue ? " · " + body.event_meta.venue : ""}${body.event_meta.rsvp_url ? " · RSVP: " + body.event_meta.rsvp_url : ""}.`
      : "";

    const systemOverride = `You draft ${body.channel} marketing/comms copy for ${brand}, a premium Indian gym brand.
${CHANNEL_RULES[body.channel]}
Tone: ${tone}. Campaign type: ${body.campaign_type ?? "announcement"}.
${body.audience_hint ? "Audience: " + body.audience_hint + "." : ""}
${eventLine}
Output ONLY via the propose_message tool — no prose.`;

    const props: Record<string, unknown> = {
      body: { type: "string", description: "Plain-text body. For email = text fallback." },
      variables: { type: "array", items: { type: "string" } },
    };
    if (body.channel === "email") {
      props.subject = { type: "string" };
      props.preheader = { type: "string" };
      props.body_html = { type: "string", description: "Inline-styled responsive HTML, ≤600px wide." };
    }
    const required = body.channel === "email"
      ? ["subject", "body", "body_html", "variables"]
      : ["body", "variables"];

    try {
      const r = await generateOnce({
        purpose: "campaign_draft",
        userMessage: body.prompt,
        systemOverride,
        supabase,
        tools: [{
          type: "function",
          function: {
            name: "propose_message",
            description: `Return a single ${body.channel} message draft.`,
            parameters: { type: "object", properties: props, required, additionalProperties: false },
          },
        }],
        toolChoice: { type: "function", function: { name: "propose_message" } },
      });

      const parsed = r.toolCallArgs ?? {};
      return new Response(JSON.stringify({ proposal: parsed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "AI gateway error";
      const status = /rate limit|429/i.test(msg) ? 429 : /credits|402/i.test(msg) ? 402 : 500;
      return new Response(JSON.stringify({ error: msg }), {
        status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (e) {
    console.error("ai-draft-campaign-message error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
