// v6.0.0 — SSOT: routes through `runUnifiedAgent` from _shared/ai-agent-brain.ts.
//          Deletes the 800-line duplicate brain (system prompt, tool loop,
//          summarizer, lead-capture parsing) — all of that is now centralized
//          and configurable via the `ai_purposes` table from the AI Control
//          Center UI. Member context, deterministic non-fitness guard, tool
//          gating, and lead capture are all handled inside the shared brain.
// v5.3.0 — Hotfix: deterministic non-fitness intent guard (now in shared brain).
// v5.2.0 — Variant-aware phone matching, member-first dedupe guard.
// v5.1.0 — Phase G: pinned to shared META_API_BASE (v25.0).
// v5.0.0 — Transactional AI Agent: 25+ self-service tools, payments, IG/FB parity
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { META_API_BASE, computeAppSecretProof } from "../_shared/meta-config.ts";
import { phoneVariants } from "../_shared/phone.ts";
import { runUnifiedAgent } from "../_shared/ai-agent-brain.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, x-hub-signature, x-hub-signature-256",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type WhatsAppIntegration = {
  id: string;
  branch_id: string | null;
  config: Record<string, unknown>;
  credentials: Record<string, unknown>;
};

const integrationCache = new Map<string, WhatsAppIntegration | null>();
let fallbackBranchIdCache: string | null = null;
let fallbackBranchIdFetched = false;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method === "GET") {
      return await handleVerification(req);
    }

    if (req.method === "POST") {
      return await handleEvent(req);
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json", Allow: "GET, POST, OPTIONS" },
    });
  } catch (error) {
    console.error("whatsapp-webhook error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─── Verification ──────────────────────────────────────────────────────────────

async function handleVerification(req: Request) {
  const url = new URL(req.url);
  const modeRaw = getQueryParam(url, ["hub.mode", "hub_mode", "mode"]);
  const verifyToken = getQueryParam(url, ["hub.verify_token", "hub_verify_token", "verify_token"]);
  const challenge = getQueryParam(url, ["hub.challenge", "hub_challenge", "challenge"]);
  const mode = modeRaw?.toLowerCase();

  if (mode !== "subscribe" || !verifyToken || !challenge) {
    const missingParams = [
      !modeRaw ? "hub.mode" : null,
      !verifyToken ? "hub.verify_token" : null,
      !challenge ? "hub.challenge" : null,
    ].filter(Boolean);

    return new Response(
      JSON.stringify({ error: "Invalid verification request", expected_mode: "subscribe", received_mode: modeRaw, missing_params: missingParams }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { data: integration, error } = await supabase
    .from("integration_settings")
    .select("id")
    .eq("integration_type", "whatsapp")
    .eq("is_active", true)
    .eq("config->>webhook_verify_token", verifyToken)
    .limit(1)
    .maybeSingle();

  if (error || !integration) {
    console.error("Invalid verify token", error);
    return new Response(JSON.stringify({ error: "Verification token not recognized" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(challenge, { status: 200, headers: { ...corsHeaders, "Content-Type": "text/plain" } });
}

function getQueryParam(url: URL, keys: string[]) {
  for (const key of keys) {
    const value = url.searchParams.get(key)?.trim();
    if (value) return value;
  }
  return null;
}

// ─── Event Handling ────────────────────────────────────────────────────────────

async function handleEvent(req: Request) {
  const bodyText = await req.text();
  let payload: any;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (payload?.object && payload.object !== "whatsapp_business_account") {
    return new Response(JSON.stringify({ status: "ignored" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Signature verification
  const phoneNumberIds = extractPhoneNumberIds(payload);
  const candidateIntegrations = await Promise.all(phoneNumberIds.map((id) => findIntegrationByPhoneNumberId(id)));
  const signatureSecrets: string[] = Array.from(
    new Set(
      candidateIntegrations
        .map(getWebhookSignatureSecret)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  );

  if (signatureSecrets.length > 0) {
    const signatureHeader = req.headers.get("x-hub-signature-256") ?? req.headers.get("x-hub-signature");
    if (!signatureHeader) {
      return new Response(JSON.stringify({ error: "Missing webhook signature" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const isValidSignature = await verifyWebhookSignature(bodyText, signatureHeader, signatureSecrets);
    if (!isValidSignature) {
      return new Response(JSON.stringify({ error: "Invalid webhook signature" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  if (entries.length === 0) {
    return new Response(JSON.stringify({ status: "ignored" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  for (const entry of entries) {
    if (!Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      const value = change?.value;
      const field = change?.field;

      if (field === "message_template_status_update") {
        await processTemplateStatusUpdate(value);
        continue;
      }

      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      const integration = await findIntegrationByPhoneNumberId(String(phoneNumberId));
      const resolvedBranchId = await resolveBranchId(integration, value);
      if (!resolvedBranchId) {
        console.warn("Unable to resolve branch_id for WhatsApp webhook event", phoneNumberId);
      }

      const insertedMessageIds = await processIncomingMessages(value, resolvedBranchId, integration);
      await processStatusUpdates(value, resolvedBranchId);

      if (insertedMessageIds.length > 0 && resolvedBranchId) {
        for (const { id: msgId, phone_number } of insertedMessageIds) {
          try {
            await triggerAiAutoReply(msgId, phone_number, resolvedBranchId);
          } catch (err) {
            console.error("AI auto-reply error (non-blocking):", err);
          }
        }
      }
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── Template Status Updates ───────────────────────────────────────────────────

async function processTemplateStatusUpdate(value: any) {
  if (!value) return;
  const templateName = value.message_template_name;
  const templateStatus = value.event;
  const reason = value.reason || value.rejected_reason || null;

  if (!templateName || !templateStatus) return;

  const { error } = await supabase
    .from("whatsapp_templates")
    .update({
      status: templateStatus,
      rejected_reason: reason,
      synced_at: new Date().toISOString(),
    })
    .eq("name", templateName);

  if (error) {
    console.error("Failed to update whatsapp_templates status:", error);
  }

  await supabase
    .from("templates")
    .update({
      meta_template_status: templateStatus,
      meta_rejection_reason: reason,
    })
    .eq("meta_template_name", templateName)
    .not("meta_template_name", "is", null);
}

// ─── Incoming Messages ─────────────────────────────────────────────────────────

async function processIncomingMessages(value: any, branchId: string | null, integration: WhatsAppIntegration | null): Promise<{ id: string; phone_number: string }[]> {
  if (!branchId) return [];

  const messages = Array.isArray(value.messages) ? value.messages : [];
  const contactName = value.contacts?.[0]?.profile?.name ?? null;
  const insertedItems: { id: string; phone_number: string }[] = [];

  for (const message of messages) {
    if (!message?.from || !message?.id) continue;

    const { data: existing } = await supabase
      .from("whatsapp_messages")
      .select("id")
      .eq("whatsapp_message_id", message.id)
      .maybeSingle();

    if (existing) continue;

    // Download inbound media (PDF/image/video/audio) from Meta to our storage.
    // Meta only stores raw IDs and gives 5-min signed URLs; we persist a copy
    // and store the storage path in media_url + metadata in media_meta.
    const mediaResolved = await resolveInboundMedia(message, integration);

    const msgPayload = {
      branch_id: branchId,
      phone_number: message.from,
      contact_name: contactName,
      message_type: message.type ?? "text",
      content: extractMessageContent(message),
      media_url: mediaResolved?.storage_path ?? null,
      media_meta: mediaResolved?.meta ?? null,
      direction: "inbound",
      status: "received",
      whatsapp_message_id: message.id,
    };

    const { data, error } = await supabase.from("whatsapp_messages").insert(msgPayload).select("id").single();
    if (error) {
      console.error("Failed to insert WhatsApp inbound message", error);
    } else if (data) {
      insertedItems.push({ id: data.id, phone_number: message.from });
      await supabase.from("whatsapp_chat_settings").upsert(
        {
          branch_id: branchId,
          phone_number: message.from,
          is_unread: true,
        },
        { onConflict: "branch_id,phone_number" },
      );

      // Meta Ads attribution: extract referral data if present
      if (message.referral) {
        try {
          const adId = message.referral.source_id || message.referral.ad_id || null;
          const campaignName = message.referral.headline || message.referral.body || null;
          const sourceUrl = message.referral.source_url || null;
          if (adId || campaignName) {
            // Store attribution on any existing lead with this phone
            await supabase
              .from("leads")
              .update({
                ad_id: adId,
                campaign_name: campaignName,
                source: sourceUrl ? "meta_ad" : "whatsapp_ad",
              })
              .eq("phone", message.from)
              .is("ad_id", null);
            console.log("Meta ad attribution captured:", { phone: message.from, adId, campaignName });
          }
        } catch (refErr) {
          console.warn("Failed to extract Meta referral data:", refErr);
        }
      }
    }
  }

  return insertedItems;
}

// ─── Status Updates ────────────────────────────────────────────────────────────
// Mirrors Meta delivery callbacks (sent → delivered → read → failed) onto BOTH
// `whatsapp_messages` (CRM inbox) AND `communication_logs` (dispatcher audit
// trail) so Templates Health and per-template delivery stats stay accurate.

async function processStatusUpdates(value: any, branchId: string | null) {
  const statuses = Array.isArray(value.statuses) ? value.statuses : [];

  for (const status of statuses) {
    if (!status?.id) continue;
    const newStatus = String(status.status ?? "sent").toLowerCase();
    const errMsg = Array.isArray(status.errors) && status.errors.length
      ? `${status.errors[0]?.code ?? ''}: ${status.errors[0]?.title ?? status.errors[0]?.message ?? ''}`.trim()
      : null;

    // 1. WhatsApp inbox row
    let updateQuery = supabase
      .from("whatsapp_messages")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("whatsapp_message_id", status.id);
    if (branchId) updateQuery = updateQuery.eq("branch_id", branchId);
    const { error } = await updateQuery;
    if (error) console.error("Failed to update WhatsApp message status", error);

    // 2. Dispatcher audit trail — match by provider_message_id (wamid).
    //    `delivery_status` enum only has sent/failed; richer WhatsApp
    //    lifecycle (delivered/read) is stashed under delivery_metadata.
    try {
      const { data: log } = await supabase
        .from("communication_logs")
        .select("id, delivery_metadata")
        .eq("provider_message_id", status.id)
        .maybeSingle();
      if (log?.id) {
        const meta = (log.delivery_metadata as Record<string, unknown>) || {};
        const patch: Record<string, unknown> = {
          delivery_metadata: {
            ...meta,
            wa_status: newStatus,
            wa_status_at: new Date().toISOString(),
          },
        };
        if (newStatus === "failed") {
          patch.delivery_status = "failed";
          if (errMsg) patch.error_message = errMsg;
        }
        await supabase.from("communication_logs").update(patch).eq("id", log.id);
      }
    } catch (e) {
      console.warn("[whatsapp-webhook] communication_logs update failed:", e);
    }
  }
}

// ─── AI Auto-Reply (thin wrapper around shared brain) ─────────────────────────
// All system prompt, lead capture, member-tool gating, non-fitness redirect,
// summarizer, and tool-call loop logic lives in `_shared/ai-agent-brain.ts`
// and is configured via the `ai_purposes` table from the AI Control Center UI.
// This function only:
//   1. Loads the inbound row to get phone/contact name + content
//   2. Calls runUnifiedAgent
//   3. Pipes the resulting reply through sendAiReply (which understands
//      interactive JSON payloads for buttons/lists)

async function triggerAiAutoReply(messageId: string, phoneNumber: string, branchId: string) {
  const { data: inboundMsg } = await supabase
    .from("whatsapp_messages")
    .select("phone_number, contact_name, content")
    .eq("id", messageId)
    .single();

  if (!inboundMsg?.content) return;

  try {
    const result = await runUnifiedAgent(
      supabase,
      SUPABASE_URL!,
      SUPABASE_SERVICE_ROLE_KEY!,
      {
        senderId: inboundMsg.phone_number,
        branchId,
        platform: "whatsapp",
        messageId,
        messageContent: inboundMsg.content,
        contactName: inboundMsg.contact_name ?? null,
        messageType: "text",
      },
    );

    if (result.skipped || !result.replyText) {
      if (result.skipReason) {
        console.log(`[whatsapp-webhook] AI skipped: ${result.skipReason}`);
      }
      return;
    }

    await sendAiReply(
      result.replyText,
      { phone_number: inboundMsg.phone_number, contact_name: inboundMsg.contact_name },
      branchId,
    );
  } catch (err) {
    console.error("[whatsapp-webhook] runUnifiedAgent failed:", err);
  }
}


// ─── Send AI Reply via Meta API ────────────────────────────────────────────────

async function sendAiReply(
  replyText: string,
  inboundMsg: { phone_number: string; contact_name: string | null },
  branchId: string,
) {
  let interactivePayload: any = null;

  // Extract interactive JSON from mixed prose — handles nested JSON via brace-balanced scan.
  // v2 — fixes a bug where the prior regex `[^{}]*` could not match nested objects
  // (e.g. interactive_list with sections[].rows[]) so payloads leaked as raw text.
  function tryExtractInteractiveJson(text: string): { parsed: any; cleanText: string } | null {
    // Try 1: whole string is the JSON
    const trimmed = text.trim();
    if (trimmed.startsWith("{") && trimmed.includes('"type"')) {
      try {
        const p = JSON.parse(trimmed);
        if (p.type === "interactive" || p.type === "interactive_list") return { parsed: p, cleanText: p.body || "" };
      } catch {}
    }
    // Try 2: JSON block in markdown fences
    const fenceMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (fenceMatch) {
      try {
        const p = JSON.parse(fenceMatch[1]);
        if (p.type === "interactive" || p.type === "interactive_list") {
          const prose = text.replace(fenceMatch[0], "").trim();
          return { parsed: p, cleanText: prose || p.body || "" };
        }
      } catch {}
    }
    // Try 3: brace-balanced extractor — finds an embedded {"type":"interactive…"} object
    // even when it contains nested objects/arrays. Walks the string tracking string
    // literals + escapes so braces inside strings don't fool the counter.
    const typeMarkerRe = /\{[\s\n]*"type"\s*:\s*"interactive(?:_list)?"/;
    const m = text.match(typeMarkerRe);
    if (m && typeof m.index === "number") {
      const start = m.index;
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (escape) { escape = false; continue; }
        if (ch === "\\") { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            const slice = text.slice(start, i + 1);
            try {
              const p = JSON.parse(slice);
              if (p.type === "interactive" || p.type === "interactive_list") {
                const prose = (text.slice(0, start) + text.slice(i + 1)).trim();
                return { parsed: p, cleanText: prose || p.body || "" };
              }
            } catch {}
            break;
          }
        }
      }
    }
    return null;
  }

  const extraction = tryExtractInteractiveJson(replyText);
  if (extraction) {
    const parsed = extraction.parsed;
    if (parsed.type === "interactive" && parsed.buttons?.length) {
      const opts: string[] = parsed.buttons;
      if (opts.length > 3) {
        // SAFETY NET: Meta caps reply buttons at 3 — auto-promote to a list block
        // so we never silently drop options 4+. Single section, one row per option.
        interactivePayload = {
          type: "list",
          body: { text: parsed.body || "Please select an option:" },
          action: {
            button: "Select",
            sections: [{
              title: "Choose one",
              rows: opts.slice(0, 10).map((title, i) => ({
                id: `opt_${i + 1}`,
                title: String(title).substring(0, 24),
              })),
            }],
          },
        };
      } else {
        interactivePayload = {
          type: "button",
          body: { text: parsed.body || "Please select an option:" },
          action: {
            buttons: opts.slice(0, 3).map((btn: string, i: number) => ({
              type: "reply",
              reply: { id: `btn_${i}`, title: String(btn).substring(0, 20) },
            })),
          },
        };
      }
      replyText = `${parsed.body}\n${opts.map((b: string, i: number) => `${i + 1}. ${b}`).join("\n")}`;
    } else if (parsed.type === "interactive_list" && parsed.sections?.length) {
      interactivePayload = {
        type: "list",
        body: { text: parsed.body || "Please select an option:" },
        action: {
          button: (parsed.button || "Select").substring(0, 20),
          sections: parsed.sections,
        },
      };
      const allRows = parsed.sections.flatMap((s: any) => s.rows || []);
      replyText = `${parsed.body}\n${allRows.map((r: any) => `• ${r.title}`).join("\n")}`;
    }
  }

  // SAFETY NET — plan/duration question normalization.
  // Guarantees the 4 canonical durations (Monthly, Quarterly, Half-Yearly, Annual) are
  // always present, and strips any Day Pass / price-mentioning rows so the bot never
  // leaks pricing or an off-menu option.
  // Strict: must mention plan/duration/membership context — avoids false-positive on "monthly budget".
  const PLAN_BODY_RE = /\b(plan|duration|membership)\b/i;
  const PRICE_DAYPASS_RE = /day\s*pass|₹|\bRs\.?\b|\/-|price|fee|cost|inr/i;
  const CANONICAL_PLAN_LIST = {
    type: "list",
    body: { text: "Which membership duration suits you best?" },
    action: {
      button: "View Plans",
      sections: [{
        title: "Choose your plan",
        rows: [
          { id: "plan_monthly", title: "📅 Monthly", description: "Flexible — try us out, no commitment" },
          { id: "plan_quarterly", title: "⚡ Quarterly", description: "3 months — most popular starter" },
          { id: "plan_halfyearly", title: "💪 Half-Yearly", description: "6 months — better value, real results" },
          { id: "plan_annual", title: "🏆 Annual", description: "12 months — our most committed members" },
        ],
      }],
    },
  };

  const looksLikePlanQuestion = (body: string) => PLAN_BODY_RE.test(body || "");

  if (interactivePayload) {
    const bodyText = interactivePayload?.body?.text || "";
    if (looksLikePlanQuestion(bodyText)) {
      // Force canonical 4-row list whenever a plan question is detected.
      interactivePayload = { ...CANONICAL_PLAN_LIST, body: { text: bodyText || CANONICAL_PLAN_LIST.body.text } };
      const rows = CANONICAL_PLAN_LIST.action.sections[0].rows;
      replyText = `${interactivePayload.body.text}\n${rows.map(r => `• ${r.title}`).join("\n")}`;
    } else if (interactivePayload.type === "list") {
      // Strip Day Pass / price-mentioning rows from any other list as a final guard.
      for (const section of interactivePayload.action?.sections || []) {
        section.rows = (section.rows || []).filter((r: any) =>
          !PRICE_DAYPASS_RE.test(`${r.title || ""} ${r.description || ""}`)
        );
      }
    }
  } else if (looksLikePlanQuestion(replyText)) {
    // Model emitted plan question as plain text — promote to canonical list.
    interactivePayload = CANONICAL_PLAN_LIST;
    const rows = CANONICAL_PLAN_LIST.action.sections[0].rows;
    replyText = `${CANONICAL_PLAN_LIST.body.text}\n${rows.map(r => `• ${r.title}`).join("\n")}`;
  }

  const { data: aiMsg, error: insertErr } = await supabase
    .from("whatsapp_messages")
    .insert({
      branch_id: branchId,
      phone_number: inboundMsg.phone_number,
      contact_name: inboundMsg.contact_name,
      content: replyText,
      direction: "outbound",
      status: "pending",
      message_type: interactivePayload ? "interactive" : "text",
    })
    .select("id")
    .single();

  if (insertErr || !aiMsg) {
    console.error("Failed to insert AI auto-reply message", insertErr);
    return;
  }

  const integration = await getWhatsAppIntegration(branchId);
  if (!integration) return;

  const accessToken = integration.credentials?.access_token as string;
  const phoneNumberId = integration.config?.phone_number_id as string;
  const appSecret = (integration.credentials?.app_secret as string) || null;
  if (!accessToken || !phoneNumberId) return;

  const cleanPhone = inboundMsg.phone_number.replace(/[\s\-\+]/g, "");

  // Send-time race lock: prevents two parallel webhook invocations from
  // sending duplicate replies to the same phone within 8 seconds.
  try {
    const { data: gotLock } = await supabase.rpc("try_whatsapp_send_lock", {
      _phone: cleanPhone,
      _ttl_seconds: 8,
    });
    if (gotLock === false) {
      console.log(`[sendAiReply] skip — another send in flight for ${cleanPhone}`);
      await supabase.from("whatsapp_messages").update({ status: "failed", error_message: "duplicate suppressed" }).eq("id", aiMsg.id);
      return;
    }
  } catch (lockErr) {
    console.warn("send-lock RPC failed, proceeding without lock:", lockErr);
  }

  let metaUrl = `${META_API_BASE}/${phoneNumberId}/messages`;
  if (appSecret) {
    const proof = await computeAppSecretProof(accessToken, appSecret);
    metaUrl += `?appsecret_proof=${proof}`;
  }

  const metaBody: any = {
    messaging_product: "whatsapp",
    to: cleanPhone,
  };

  if (interactivePayload) {
    metaBody.type = "interactive";
    metaBody.interactive = interactivePayload;
  } else {
    metaBody.type = "text";
    metaBody.text = { body: replyText };
  }

  const metaResponse = await fetch(metaUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(metaBody),
  });

  const metaData = await metaResponse.json();

  if (metaResponse.ok) {
    await supabase
      .from("whatsapp_messages")
      .update({
        status: "sent",
        whatsapp_message_id: metaData?.messages?.[0]?.id || null,
      })
      .eq("id", aiMsg.id);

    // Repeat-question guard: track last 3 AI questions; if same question 3×, force handoff.
    try {
      const firstQ = (replyText.match(/[^?!.]*\?/) || [])[0]?.trim().toLowerCase().slice(0, 200);
      if (firstQ) {
        const { data: state } = await supabase
          .from("whatsapp_conversation_state")
          .select("last_questions")
          .eq("phone_number", cleanPhone)
          .maybeSingle();
        const prev: string[] = (state?.last_questions as string[]) || [];
        const next = [...prev, firstQ].slice(-3);
        await supabase.from("whatsapp_conversation_state").upsert(
          { phone_number: cleanPhone, branch_id: branchId, last_questions: next, updated_at: new Date().toISOString() },
          { onConflict: "phone_number" },
        );
        if (next.length === 3 && next[0] === next[1] && next[1] === next[2]) {
          await supabase.from("whatsapp_chat_settings").upsert(
            { branch_id: branchId, phone_number: cleanPhone, bot_active: false, paused_at: new Date().toISOString() },
            { onConflict: "branch_id,phone_number" },
          );
          await supabase.from("automation_diagnostics").insert({
            phone_number: cleanPhone, branch_id: branchId,
            kind: "repeat_question_handoff", payload: { question: firstQ },
          });
        }
      }
    } catch (guardErr) {
      console.warn("repeat-question guard failed:", guardErr);
    }
  } else {
    console.error("AI auto-reply Meta send failed:", JSON.stringify(metaData));
    await supabase.from("whatsapp_messages").update({ status: "failed" }).eq("id", aiMsg.id);
  }
}

async function getWhatsAppIntegration(branchId: string): Promise<WhatsAppIntegration | null> {
  const { data: branchInt } = await supabase
    .from("integration_settings")
    .select("id, branch_id, config, credentials")
    .eq("branch_id", branchId)
    .eq("integration_type", "whatsapp")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (branchInt) return branchInt as WhatsAppIntegration;

  const { data: globalInt } = await supabase
    .from("integration_settings")
    .select("id, branch_id, config, credentials")
    .is("branch_id", null)
    .eq("integration_type", "whatsapp")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  return (globalInt as WhatsAppIntegration) || null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function findIntegrationByPhoneNumberId(phoneNumberId: string): Promise<WhatsAppIntegration | null> {
  if (integrationCache.has(phoneNumberId)) {
    return integrationCache.get(phoneNumberId)!;
  }

  const { data, error } = await supabase
    .from("integration_settings")
    .select("id, branch_id, config, credentials")
    .eq("integration_type", "whatsapp")
    .eq("is_active", true)
    .eq("config->>phone_number_id", phoneNumberId)
    .limit(1)
    .maybeSingle();

  if (error) console.error("Error fetching integration for webhook", error);

  const result = (data as WhatsAppIntegration | null) ?? null;
  integrationCache.set(phoneNumberId, result);
  return result;
}

async function resolveBranchId(integration: WhatsAppIntegration | null, value: any): Promise<string | null> {
  if (!integration) return null;
  if (integration.branch_id) return integration.branch_id;

  const configuredDefaultBranch = integration.config?.default_branch_id;
  if (typeof configuredDefaultBranch === "string" && configuredDefaultBranch.trim().length > 0) {
    return configuredDefaultBranch.trim();
  }

  const firstStatusId = Array.isArray(value?.statuses) ? value.statuses?.[0]?.id : null;
  if (typeof firstStatusId === "string" && firstStatusId.trim().length > 0) {
    const { data: statusMsg } = await supabase
      .from("whatsapp_messages")
      .select("branch_id")
      .eq("whatsapp_message_id", firstStatusId)
      .not("branch_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (statusMsg?.branch_id) return statusMsg.branch_id;
  }

  const inboundPhone = Array.isArray(value?.messages) ? value.messages?.[0]?.from : null;
  if (typeof inboundPhone === "string" && inboundPhone.trim().length > 0) {
    const { data: lastConversation } = await supabase
      .from("whatsapp_messages")
      .select("branch_id")
      .eq("phone_number", inboundPhone)
      .not("branch_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastConversation?.branch_id) return lastConversation.branch_id;
  }

  return await getFallbackBranchId();
}

async function getFallbackBranchId(): Promise<string | null> {
  if (fallbackBranchIdFetched) {
    return fallbackBranchIdCache;
  }

  const { data: branch } = await supabase
    .from("branches")
    .select("id")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  fallbackBranchIdCache = branch?.id ?? null;
  fallbackBranchIdFetched = true;
  return fallbackBranchIdCache;
}

function extractMessageContent(message: any): string | null {
  // Handle interactive button replies (user tapped a quick-reply button)
  if (message?.interactive?.button_reply?.title) return message.interactive.button_reply.title;
  // Handle interactive list replies (user selected from a list)
  if (message?.interactive?.list_reply?.title) return message.interactive.list_reply.title;
  if (message?.text?.body) return message.text.body;
  if (message?.caption) return message.caption;
  if (message?.image?.caption) return message.image.caption;
  if (message?.document?.filename) return message.document.filename;
  if (message?.template?.name) return message.template.name;
  return null;
}

function extractMediaUrl(message: any): string | null {
  return message?.image?.id ?? message?.video?.id ?? message?.document?.id ?? message?.audio?.id ?? null;
}

// Download an inbound WA media object from Meta and persist into the
// `whatsapp-media` storage bucket. Returns a storage_path + filename/mime
// metadata that the chat UI uses to render an attachment tile.
async function resolveInboundMedia(
  message: any,
  integration: WhatsAppIntegration | null,
): Promise<{ storage_path: string; meta: Record<string, unknown> } | null> {
  const mediaObj =
    message?.image ?? message?.video ?? message?.document ?? message?.audio ?? message?.sticker ?? null;
  if (!mediaObj?.id) return null;

  const mediaId = String(mediaObj.id);
  const baseMeta: Record<string, unknown> = {
    meta_id: mediaId,
    filename: mediaObj.filename ?? null,
    mime_type: mediaObj.mime_type ?? null,
    kind: message.type ?? null,
  };

  const accessToken = integration?.credentials?.access_token as string | undefined;
  if (!accessToken) {
    return { storage_path: mediaId, meta: { ...baseMeta, error: "no_access_token" } };
  }

  try {
    // Step 1: Get short-lived signed URL from Graph API.
    const metaRes = await fetch(`${META_API_BASE}/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!metaRes.ok) {
      const text = await metaRes.text().catch(() => "");
      console.error("Meta media metadata fetch failed", metaRes.status, text);
      return { storage_path: mediaId, meta: { ...baseMeta, error: `meta_fetch_${metaRes.status}` } };
    }
    const metaJson = await metaRes.json();
    const downloadUrl = metaJson?.url as string | undefined;
    const mimeType = (metaJson?.mime_type as string | undefined) ?? (mediaObj.mime_type as string | undefined) ?? "application/octet-stream";
    if (!downloadUrl) {
      return { storage_path: mediaId, meta: { ...baseMeta, error: "no_download_url" } };
    }

    // Step 2: Download binary with bearer token.
    const binRes = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!binRes.ok) {
      console.error("Meta media binary download failed", binRes.status);
      return { storage_path: mediaId, meta: { ...baseMeta, error: `download_${binRes.status}` } };
    }
    const blob = await binRes.blob();

    // Step 3: Upload into our storage bucket.
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const safeName = (mediaObj.filename ?? mediaId)
      .toString()
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 120);
    const ext = safeName.includes(".") ? "" : guessExtension(mimeType);
    const path = `${yyyy}/${mm}/${mediaId}-${safeName}${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from("whatsapp-media")
      .upload(path, blob, { contentType: mimeType, upsert: true });
    if (uploadErr) {
      console.error("WA media storage upload failed", uploadErr);
      return { storage_path: mediaId, meta: { ...baseMeta, error: "upload_failed", mime_type: mimeType } };
    }

    return {
      storage_path: path,
      meta: {
        ...baseMeta,
        mime_type: mimeType,
        size: blob.size,
        bucket: "whatsapp-media",
      },
    };
  } catch (err) {
    console.error("resolveInboundMedia exception", err);
    return { storage_path: mediaId, meta: { ...baseMeta, error: String(err) } };
  }
}

function guessExtension(mime: string): string {
  if (!mime) return "";
  if (mime.includes("pdf")) return ".pdf";
  if (mime.includes("jpeg")) return ".jpg";
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("mp4")) return ".mp4";
  if (mime.includes("ogg")) return ".ogg";
  if (mime.includes("mpeg")) return ".mp3";
  return "";
}

function extractPhoneNumberIds(payload: any): string[] {
  const ids = new Set<string>();
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const id = change?.value?.metadata?.phone_number_id;
      if (id) ids.add(String(id));
    }
  }
  return Array.from(ids);
}

function getWebhookSignatureSecret(integration: WhatsAppIntegration | null): string | null {
  if (!integration) return null;
  const appSecret = integration.credentials?.app_secret;
  if (typeof appSecret === "string" && appSecret.trim().length > 0) return appSecret.trim();
  const apiKey = integration.credentials?.api_key;
  if (typeof apiKey === "string" && apiKey.trim().length > 0) return apiKey.trim();
  return null;
}

function parseSignatureHeader(signatureHeader: string): string | null {
  const trimmed = signatureHeader.trim();
  if (!trimmed) return null;
  if (trimmed.includes("=")) {
    const [algorithm, value] = trimmed.split("=", 2);
    if (algorithm.toLowerCase() !== "sha256") return null;
    return value?.trim().toLowerCase() ?? null;
  }
  return trimmed.toLowerCase();
}

async function verifyWebhookSignature(body: string, signatureHeader: string, secrets: string[]) {
  const expectedSignature = parseSignatureHeader(signatureHeader);
  if (!expectedSignature) return false;
  for (const secret of secrets) {
    const computed = await computeHmacSha256(body, secret);
    if (computed === expectedSignature) return true;
  }
  return false;
}

async function computeHmacSha256(message: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
