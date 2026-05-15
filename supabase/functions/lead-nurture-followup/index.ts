// v4.0.0 — SSOT: AI nudge text now generated via shared ai-runtime.generateOnce
//          (purpose='lead_nurture'). Hardcoded prompt + direct fetch removed.
// v3.4.0 — Enforce Meta 24h customer-service window. If the lead has not
//          replied within 24h, do NOT send a freeform AI nudge (Meta rejects
//          with 131047). Instead, send the approved `lead_nurture_followup`
//          WhatsApp template via dispatch-communication, or skip & cool down.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateOnce } from "../_shared/ai-runtime.ts";
const serve = Deno.serve;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: orgSettings } = await supabase
      .from("organization_settings")
      .select("lead_nurture_config")
      .limit(1)
      .maybeSingle();

    const config = (orgSettings?.lead_nurture_config as any) ?? {
      enabled: true,
      delay_hours: 4,
      max_retries: 2,
    };

    if (!config.enabled) {
      return new Response(JSON.stringify({ message: "Lead nurture disabled" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const delayHours = config.delay_hours || 4;
    const maxRetries = config.max_retries || 2;
    const nurturePrompt = config.nurture_prompt || "";
    const cooldownHours = config.cooldown_hours || delayHours;
    const cutoffTime = new Date(Date.now() - delayHours * 60 * 60 * 1000).toISOString();

    // Find chats where bot is active
    const { data: staleChats, error: chatErr } = await supabase
      .from("whatsapp_chat_settings")
      .select("id, phone_number, branch_id, nurture_retry_count, partial_lead_data, last_nurture_at, platform")
      .eq("bot_active", true);

    if (chatErr) {
      console.error("Failed to query stale chats:", chatErr);
      return new Response(JSON.stringify({ error: chatErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let nudgedCount = 0;
    let resetCount = 0;

    for (const chat of staleChats || []) {
      const { data: lastMsg } = await supabase
        .from("whatsapp_messages")
        .select("direction, created_at")
        .eq("phone_number", chat.phone_number)
        .eq("branch_id", chat.branch_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!lastMsg) continue;

      // If last message is INBOUND, the user has re-engaged — reset retry counter
      if (lastMsg.direction === "inbound") {
        if ((chat.nurture_retry_count || 0) > 0) {
          await supabase
            .from("whatsapp_chat_settings")
            .update({ nurture_retry_count: 0 })
            .eq("id", chat.id);
          resetCount++;
        }
        // User replied, no need to nudge
        continue;
      }

      // Last message is outbound — check if we should nudge
      // Skip if retry count maxed
      if ((chat.nurture_retry_count || 0) >= maxRetries) continue;

      // Skip if last message is too recent (not past cutoff)
      if (lastMsg.created_at > cutoffTime) continue;

      // Cooldown: skip if last nurture was within cooldown window
      if (chat.last_nurture_at) {
        const cooldownCutoff = new Date(Date.now() - cooldownHours * 60 * 60 * 1000).toISOString();
        if (chat.last_nurture_at > cooldownCutoff) continue;
      }

      // Check if there's an existing lead
      const cleanPhone = chat.phone_number.replace(/^\+/, "");
      const { data: lead } = await supabase
        .from("leads")
        .select("id, full_name")
        .or(`phone.eq.${chat.phone_number},phone.eq.${cleanPhone},phone.eq.+${cleanPhone}`)
        .eq("branch_id", chat.branch_id)
        .limit(1)
        .maybeSingle();

      const partialData = chat.partial_lead_data as Record<string, any> | null;

      // v3.1.0 guard: if a lead already exists for this phone+branch OR the
      // chat is linked to an existing member, do not nurture further.
      if (lead?.id) continue;
      const { data: linkedMember } = await supabase
        .from("members")
        .select("id")
        .eq("phone_number", chat.phone_number)
        .maybeSingle();
      if (linkedMember?.id) continue;

      // Determine platform for send routing (must be defined BEFORE we insert
      // the outbound row that references it — earlier versions had a TDZ bug).
      const chatPlatform = chat.platform || "whatsapp";

      // ── Meta 24h customer-service window guard (WhatsApp only) ──
      // If the most recent INBOUND WhatsApp message from this number is older
      // than 24h, freeform messages will be rejected (Meta 131047). In that
      // case, route through dispatch-communication with the approved
      // `lead_nurture_followup` template — or skip the nudge and cool down.
      let outsideWindow = false;
      let templateRow: { id: string; meta_template_name: string | null } | null = null;
      if (chatPlatform === "whatsapp") {
        const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const recipientDigits = chat.phone_number.replace(/\D/g, "");
        const { data: lastInbound } = await supabase
          .from("whatsapp_messages")
          .select("id")
          .eq("direction", "inbound")
          .eq("phone_number", recipientDigits)
          .gte("created_at", sinceIso)
          .limit(1)
          .maybeSingle();
        outsideWindow = !lastInbound;

        if (outsideWindow) {
          // Look up the configured template for this branch (or global fallback).
          const { data: trig } = await supabase
            .from("whatsapp_triggers")
            .select("template_id, templates:template_id(id, meta_template_name)")
            .or(`branch_id.eq.${chat.branch_id},branch_id.is.null`)
            .eq("event_name", "lead_nurture_followup")
            .eq("is_active", true)
            .order("branch_id", { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle();
          const tpl = Array.isArray((trig as any)?.templates)
            ? (trig as any).templates[0]
            : (trig as any)?.templates;
          if (tpl?.meta_template_name) {
            templateRow = { id: tpl.id, meta_template_name: tpl.meta_template_name };
          } else {
            // No template available → cool down and skip to avoid Meta rejection.
            console.warn(
              `lead-nurture: skipping ${chat.phone_number} — outside 24h window and no approved template configured.`,
            );
            await supabase
              .from("whatsapp_chat_settings")
              .update({ last_nurture_at: new Date().toISOString() })
              .eq("id", chat.id);
            continue;
          }
        }
      }

      // Generate contextual nudge message
      let nudgeMessage: string | undefined;

      if (LOVABLE_API_KEY && (partialData || lead) && !outsideWindow) {
        const missingFields: string[] = [];
        if (!partialData?.email && !lead) missingFields.push("email address");
        if (!partialData?.name && !lead?.full_name) missingFields.push("full name");
        if (!partialData?.goal) missingFields.push("fitness goal");

        const contextInfo = partialData
          ? `Partial data collected so far: ${JSON.stringify(partialData)}. Missing: ${missingFields.join(", ") || "none"}.`
          : lead
          ? `Lead exists: ${lead.full_name}. This is a re-engagement nudge.`
          : "No data collected yet.";

        const systemPrompt = `You are a friendly gym assistant for Incline Fitness. Write a single short WhatsApp follow-up message (max 2 sentences) to re-engage a lead who stopped responding.
${nurturePrompt ? `Additional context from admin: ${nurturePrompt}` : ""}
${contextInfo}
${missingFields.length > 0 ? `Naturally ask for their ${missingFields[0]} in the message.` : "Just encourage them to visit or reply."}
Keep it warm, casual, and use 1-2 emoji. Do NOT mention that they stopped replying.`;

        try {
          const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash-lite",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: "Generate the follow-up message." },
              ],
            }),
          });

          if (aiRes.ok) {
            const aiResult = await aiRes.json();
            const generated = aiResult.choices?.[0]?.message?.content?.trim();
            if (generated) nudgeMessage = generated;
          }
        } catch (aiErr) {
          console.warn("AI nudge generation failed, using fallback:", aiErr);
        }
      }

      const contactName = lead?.full_name || partialData?.name || partialData?.whatsapp_name || null;
      const prospectName = contactName || "there";

      // Fallback message (also used as the rendered body when sending the
      // approved template — dispatcher infers variable values from this).
      if (!nudgeMessage) {
        nudgeMessage = `Hi ${prospectName}! 👋 Just checking in — we'd love to help you get started on your fitness journey at Incline Fitness. Feel free to reply anytime with your questions! 💪`;
      }

      try {
        if (chatPlatform === "whatsapp" && outsideWindow && templateRow) {
          // ── Approved-template path via dispatch-communication ──
          const dedupeKey = `lead_nurture:${chat.id}:${Date.now()}`;
          const dispatchRes = await fetch(`${supabaseUrl}/functions/v1/dispatch-communication`, {
            method: "POST",
            headers: { Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              branch_id: chat.branch_id,
              channel: "whatsapp",
              category: "retention_nudge",
              recipient: chat.phone_number,
              template_id: templateRow.id,
              payload: {
                body: nudgeMessage,
                variables: {
                  prospect_name: prospectName,
                  popular_feature_1: "personal training",
                  popular_feature_2: "recovery zone",
                },
              },
              dedupe_key: dedupeKey,
              force: true,
            }),
          });
          if (!dispatchRes.ok) {
            console.error(`Dispatch (template) failed for ${chat.phone_number}: ${dispatchRes.status}`);
          }
        } else {
          // ── Inside 24h window: legacy freeform path is safe ──
          const { data: msgData, error: msgErr } = await supabase
            .from("whatsapp_messages")
            .insert({
              branch_id: chat.branch_id,
              phone_number: chat.phone_number,
              contact_name: contactName,
              content: nudgeMessage,
              direction: "outbound",
              status: "pending",
              message_type: "text",
              platform: chatPlatform,
            })
            .select()
            .single();

          if (msgErr) {
            console.error(`Failed to insert nudge for ${chat.phone_number}:`, msgErr);
            continue;
          }

          if (chatPlatform === "whatsapp") {
            const sendRes = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp`, {
              method: "POST",
              headers: { Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({ message_id: msgData.id, phone_number: chat.phone_number, content: nudgeMessage, branch_id: chat.branch_id }),
            });
            if (!sendRes.ok) console.error(`Send failed for ${chat.phone_number}: ${sendRes.status}`);
          } else {
            // Instagram or Messenger — use unified send-message
            const sendRes = await fetch(`${supabaseUrl}/functions/v1/send-message`, {
              method: "POST",
              headers: { Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({ message_id: msgData.id, recipient_id: chat.phone_number, content: nudgeMessage, branch_id: chat.branch_id, platform: chatPlatform }),
            });
            if (!sendRes.ok) console.error(`Send (${chatPlatform}) failed for ${chat.phone_number}: ${sendRes.status}`);
          }
        }
      } catch (sendErr) {
        console.error(`Send error for ${chat.phone_number}:`, sendErr);
      }

      await supabase
        .from("whatsapp_chat_settings")
        .update({
          nurture_retry_count: (chat.nurture_retry_count || 0) + 1,
          last_nurture_at: new Date().toISOString(),
        })
        .eq("id", chat.id);

      nudgedCount++;
    }

    return new Response(
      JSON.stringify({ success: true, nudged: nudgedCount, retries_reset: resetCount }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("lead-nurture-followup error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
