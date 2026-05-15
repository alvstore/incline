// v3.0.0 — SSOT: routes through ai-runtime.generateOnce (purpose='template_generate').
// v2.3.0 — Document events now PREFER header_type='document' with a sample PDF URL.
// v2.2.0 — Multi-channel AI template generator (WhatsApp / SMS / Email)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateOnce } from "../_shared/ai-runtime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface EventSpec { event: string; label?: string; hint?: string }
type Channel = 'whatsapp' | 'sms' | 'email';
interface Body {
  branch_id: string;
  channel?: Channel; // default 'whatsapp'
  events: EventSpec[];
  existing?: Array<{ name: string; body: string }>;
  brand?: string;
}

// Events that carry a PDF/document attachment. For these we MUST NOT use
// header_type='document' (Meta would require a pre-uploaded media handle
// during template review). Instead the AI must reference {{document_link}}
// in the body — dispatcher v1.6.0 substitutes the real PDF at send time.
const DOCUMENT_EVENTS = new Set([
  'invoice_generated', 'receipt_generated', 'pos_order_completed',
  'body_scan_ready', 'diet_plan_ready', 'workout_plan_ready',
  'contract_signed',
]);

const SYSTEM_PROMPTS: Record<Channel, string> = {
  whatsapp: `You write WhatsApp Business message templates for a premium Indian gym brand "Incline Fitness".
Rules:
- Output ONLY via the propose_templates tool. No prose.
- Each body ≤ 850 chars; named variables in {{snake_case}}; never duplicate the existing list.
- Categories: UTILITY (transactional/lifecycle), MARKETING (promo/birthday/referral/offer), AUTHENTICATION (OTPs only).
- No emojis on UTILITY; max 1 tasteful emoji on MARKETING; no URLs / phone numbers in body.
- Tone: warm, concise, Indian-English, premium fitness.
- Names: lower_snake_case ≤ 50 chars, descriptive.
- For events tagged "[DOCUMENT]" PREFER header_type='document' with header_sample_url='https://www.africau.edu/images/default/sample.pdf' (the platform auto-uploads it to Meta as the approval handle). Body must NOT include {{document_link}} — the file is delivered natively as the header attachment.
- For other attachment events (e.g. flyers, posters) header_type='image' is allowed with header_sample_url='https://placehold.co/600x400.png'.
- One template per event.`,
  sms: `You write Indian-DLT-compliant transactional/promotional SMS for "Incline Fitness".
Rules:
- Output ONLY via the propose_templates tool. No prose.
- Each body ≤ 160 chars (single segment) unless absolutely needed (max 320 chars).
- No emojis. No URLs. No phone numbers in body.
- Variable placeholders use {{snake_case}}; later mapped to {#var#}.
- End every promotional SMS with the suffix "-INCLNE" (DLT entity tag) — do not add it for transactional.
- Categories map to dlt_category: TRANSACTIONAL (utility/booking/payment/expiry), SERVICE_IMPLICIT (lifecycle confirmations), SERVICE_EXPLICIT (rich utility w/ promo cross-sell), PROMOTIONAL (offers/marketing/birthday).
- For events tagged "[DOCUMENT]" reference {{document_link}} (a short URL) in the body and include "document_link" in variables.
- Names: lower_snake_case ≤ 30 chars.
- One template per event.`,
  email: `You write transactional & marketing emails for "Incline Fitness", a premium Indian gym brand.
Rules:
- Output ONLY via the propose_templates tool. No prose.
- For each event return: subject (≤ 70 chars, no clickbait), preheader (≤ 110 chars), body_html (clean, mobile-first, inline styles, max 600px width, no external CSS, brand color #6d28d9), body_text fallback.
- Variables in {{snake_case}}.
- Tone: warm, premium, friendly. Add a single primary CTA when relevant ("Renew Membership", "View Receipt", "Book Class").
- Categories: UTILITY (receipts/lifecycle), MARKETING (offers/newsletter/birthday).
- For events tagged "[DOCUMENT]" set header_type='none' and include a CTA button linking to {{document_link}} (also include "document_link" in variables). Do NOT attempt to embed the PDF.
- One template per event.`,
};

function buildToolSchema(channel: Channel) {
  const itemProps: Record<string, unknown> = {
    event: { type: "string" },
    name: { type: "string" },
    category: { type: "string" },
    language: { type: "string" },
    body_text: { type: "string" },
    variables: { type: "array", items: { type: "string" } },
    header_type: { type: "string", enum: ["none", "image", "document", "video"] },
    header_sample_url: { type: "string" },
    rationale: { type: "string" },
  };
  const required = ["event", "name", "category", "body_text", "variables"];
  if (channel === 'email') {
    itemProps.subject = { type: "string" };
    itemProps.preheader = { type: "string" };
    itemProps.body_html = { type: "string" };
    required.push("subject", "body_html");
  }
  if (channel === 'sms') {
    itemProps.dlt_category = { type: "string", enum: ["TRANSACTIONAL", "SERVICE_IMPLICIT", "SERVICE_EXPLICIT", "PROMOTIONAL"] };
  }
  return {
    type: "function",
    function: {
      name: "propose_templates",
      description: `Return clean ${channel.toUpperCase()} template proposals.`,
      parameters: {
        type: "object",
        properties: {
          templates: {
            type: "array",
            items: { type: "object", properties: itemProps, required, additionalProperties: false },
          },
        },
        required: ["templates"],
        additionalProperties: false,
      },
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: claims, error: cErr } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (cErr || !claims?.claims) return json({ error: "Unauthorized" }, 401);

    const body = (await req.json()) as Body;
    if (!body.branch_id || !Array.isArray(body.events) || body.events.length === 0) {
      return json({ error: "Missing branch_id or events[]" }, 400);
    }
    if (body.events.length > 60) return json({ error: "Max 60 events per call" }, 400);

    const channel: Channel = (body.channel === 'sms' || body.channel === 'email') ? body.channel : 'whatsapp';
    // Provider/key handled by ai-runtime → ai-dispatcher (per active provider config).

    const TOOL_SCHEMA = buildToolSchema(channel);

    // Chunk into batches of 20 for reliability.
    const BATCH = 20;
    const allTemplates: any[] = [];
    for (let i = 0; i < body.events.length; i += BATCH) {
      const slice = body.events.slice(i, i + BATCH);
      const userPrompt = [
        `Brand: ${body.brand || "Incline Fitness"}`,
        `Channel: ${channel}`,
        "",
        "Events to generate templates for:",
        ...slice.map((e) => `- ${e.event}${DOCUMENT_EVENTS.has(e.event) ? ' [DOCUMENT]' : ''}${e.label ? ` (${e.label})` : ""}${e.hint ? ` — hint: ${e.hint}` : ""}`),
        "",
        "Existing templates (avoid duplicates):",
        (body.existing || []).slice(0, 60).map((e) => `• ${e.name}: ${e.body.slice(0, 140).replace(/\n/g, " ")}`).join("\n") || "(none)",
      ].join("\n");

      try {
        const r = await generateOnce({
          purpose: "template_generate",
          userMessage: userPrompt,
          systemOverride: SYSTEM_PROMPTS[channel],
          tools: [TOOL_SCHEMA],
          toolChoice: { type: "function", function: { name: "propose_templates" } },
        });
        const parsed = r.toolCallArgs;
        if (!parsed) continue;
        const templates = Array.isArray(parsed?.templates) ? parsed.templates : [];
        for (const t of templates) allTemplates.push(t);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "AI gateway error";
        if (/429|rate/i.test(msg)) return json({ error: "AI rate-limited. Try again in a moment." }, 429);
        if (/402|credits/i.test(msg)) return json({ error: "AI credits exhausted — top up Lovable AI usage." }, 402);
        return json({ error: "AI gateway error", details: msg.slice(0, 400) }, 502);
      }
    }

    // Document events: prefer native document header. If the model returned
    // header_type='none' (no native delivery), fall back to {{document_link}} in
    // the body so the file still reaches the member. If header_type='document'
    // is set, ensure a sample URL exists so manage-whatsapp-templates can
    // upload it and obtain an approval handle.
    for (const t of allTemplates) {
      if (!DOCUMENT_EVENTS.has(t.event)) continue;
      const ht = (t.header_type ?? 'none').toLowerCase();
      if (ht === 'document') {
        if (!t.header_sample_url) {
          // Plain, public sample PDF used only at template-approval time.
          t.header_sample_url = 'https://www.africau.edu/images/default/sample.pdf';
        }
        // Body must NOT carry {{document_link}} — the doc is the header.
        if (typeof t.body_text === 'string') {
          t.body_text = t.body_text.replace(/\s*Document:\s*\{\{\s*document_link\s*\}\}\s*/gi, '').trim();
        }
        if (Array.isArray(t.variables)) {
          t.variables = t.variables.filter((v: string) => v !== 'document_link');
        }
      } else {
        // Legacy text/link fallback path.
        const vars: string[] = Array.isArray(t.variables) ? t.variables : [];
        if (!vars.includes('document_link')) vars.push('document_link');
        t.variables = vars;
        if (typeof t.body_text === 'string' && !t.body_text.includes('{{document_link}}')) {
          t.body_text = `${t.body_text.trim()}\n\nDocument: {{document_link}}`;
        }
        if (typeof t.body_html === 'string' && !t.body_html.includes('{{document_link}}')) {
          t.body_html = `${t.body_html}\n<p style="margin-top:16px"><a href="{{document_link}}" style="background:#6d28d9;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Open Document</a></p>`;
        }
      }
    }

    if (allTemplates.length === 0) return json({ error: "AI returned no proposals" }, 500);
    return json({ success: true, channel, templates: allTemplates });
  } catch (e) {
    console.error("ai-generate-whatsapp-templates error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
