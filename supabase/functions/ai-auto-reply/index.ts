// v3.0.0 — Thin shim. Routes through ai-runtime.generateOnce (purpose='whatsapp_reply').
// Used by WhatsAppChat "AI Suggest" button. Does NOT mutate state — just returns a draft.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateOnce } from "../_shared/ai-runtime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Body {
  contact_name?: string | null;
  phone_number?: string | null;
  branch_id?: string | null;
  recent_messages?: Array<{ content: string; direction: "in" | "out" | string }>;
  context_type?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const body = (await req.json()) as Body;
    const transcript = (body.recent_messages ?? [])
      .map((m) => `${m.direction === "in" ? "Member" : "Staff"}: ${m.content}`)
      .join("\n");

    const userMsg = [
      body.contact_name ? `Contact: ${body.contact_name}` : "",
      body.phone_number ? `Phone: ${body.phone_number}` : "",
      "Recent conversation:",
      transcript || "(no prior messages)",
      "",
      "Suggest the next reply (one short message, max 3 sentences). Output the message only.",
    ].filter(Boolean).join("\n");

    const r = await generateOnce({
      purpose: "whatsapp_reply",
      branchId: body.branch_id ?? null,
      userMessage: userMsg,
      supabase: sb,
    });

    return new Response(
      JSON.stringify({ suggested_reply: r.content?.trim() ?? "" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
