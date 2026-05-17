// v5.0.0 — Unified AI brain: Instagram/Messenger now use the same shared agent
//          as WhatsApp with full lead capture, partial data, story reply guard,
//          and consistent Ananya persona across all platforms.
// v4.5.0 — AI history strips "(via X)" channel tags
// v4.4.0 — Robust IG `message_edit` recovery
// v4.3.1 — Some Instagram Login deliveries arrive as messaging[].message_edit
//          /{ig_user_id}/conversations fallback, store a placeholder when
//          Meta refuses content, and log every outcome to webhook_processing_log.
// v4.3.1 — Some Instagram Login deliveries arrive as messaging[].message_edit
//          without messaging[].message. Resolve the mid via Graph and ingest.
// v4.3.0 — Instagram Login webhooks deliver DMs under entry.changes[] with
//          field="messages" (not entry.messaging[]). Parse that shape and
//          route through ingestMessagingEvent so inbound IG DMs reach the CRM.
//          Also handle messaging_postbacks/seen/referral/reactions/echoes.
//          Persist accepted ingress to webhook_ingress_log for audits.
// v4.2.0 — Rich one-line logging per POST, persist signature failures to
//          `webhook_failures` table with diagnostic reason for the UI.
// v4.1.0 — Recognize `instagram_login` provider alongside `instagram` and `messenger`
//          for page-id detection, integration lookup, and app_secret resolution.
// v4.0.0 — Phase F: pinned to META_GRAPH_VERSION (v25.0), HMAC signature
//                   verification, IG comments + mentions + story replies,
//                   Instagram sender profile resolution.
// v3.1.0 — IG-via-Page detection; cross-platform AI memory.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllToolDefinitions } from "../_shared/ai-tools.ts";
import { executeSharedToolCall } from "../_shared/ai-tool-executor.ts";
import { META_API_BASE, IG_API_BASE, detectMetaHost, metaFetchWithFallback, verifyXHubSignature } from "../_shared/meta-config.ts";
import { runUnifiedAgent } from "../_shared/ai-agent-brain.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, x-hub-signature, x-hub-signature-256",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type Platform = "whatsapp" | "instagram" | "messenger";

async function logProcessing(entry: {
  object_type?: string | null;
  event_kind: string;
  platform_message_id?: string | null;
  status: "stored" | "deduped" | "dropped" | "resolve_failed" | "placeholder_stored" | "ack" | "error";
  reason?: string | null;
  meta_error_code?: number | null;
  meta_error_subcode?: number | null;
  meta_error_message?: string | null;
  sample?: any;
}) {
  try {
    await supabase.from("webhook_processing_log").insert({
      source: "meta-webhook",
      object_type: entry.object_type ?? null,
      event_kind: entry.event_kind,
      platform_message_id: entry.platform_message_id ?? null,
      status: entry.status,
      reason: entry.reason ?? null,
      meta_error_code: entry.meta_error_code ?? null,
      meta_error_subcode: entry.meta_error_subcode ?? null,
      meta_error_message: entry.meta_error_message ?? null,
      sample: entry.sample ?? null,
    });
  } catch (e) {
    console.warn("[meta-webhook] logProcessing failed:", e);
  }
}

let _orgAiConfig: any = null;
let _orgAiConfigFetchedAt = 0;

async function getOrgAiConfig() {
  if (_orgAiConfig && Date.now() - _orgAiConfigFetchedAt < 60_000) return _orgAiConfig;
  const { data, error } = await supabase
    .from("organization_settings")
    .select("whatsapp_ai_config, name")
    .limit(1)
    .maybeSingle();
  if (error) console.error("[meta-webhook] getOrgAiConfig error:", error.message);
  _orgAiConfig = data ? { whatsapp_ai_config: (data as any).whatsapp_ai_config, gym_name: (data as any).name } : {};
  _orgAiConfigFetchedAt = Date.now();
  return _orgAiConfig;
}

// Cache active IG page IDs (refreshed every 60s) to detect IG-via-Page envelopes
let _igPageIds: Set<string> = new Set();
let _igPageIdsFetchedAt = 0;
async function getActiveIgPageIds(): Promise<Set<string>> {
  if (Date.now() - _igPageIdsFetchedAt < 60_000) return _igPageIds;
  const { data } = await supabase
    .from("integration_settings")
    .select("config")
    .in("integration_type", ["instagram", "instagram_login"])
    .eq("is_active", true);
  const set = new Set<string>();
  for (const row of data || []) {
    const cfg: any = (row as any).config || {};
    if (cfg.page_id) set.add(String(cfg.page_id));
    if (cfg.instagram_account_id) set.add(String(cfg.instagram_account_id));
  }
  _igPageIds = set;
  _igPageIdsFetchedAt = Date.now();
  return _igPageIds;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method === "GET") return await handleVerification(req);
    if (req.method === "POST") return await handleIncomingEvent(req);
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[meta-webhook] error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function handleVerification(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode")?.toLowerCase();
  const verifyToken = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode !== "subscribe" || !verifyToken || !challenge) {
    return new Response(JSON.stringify({ error: "Invalid verification request" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: integration } = await supabase
    .from("integration_settings")
    .select("id, integration_type")
    .in("integration_type", ["whatsapp", "instagram", "instagram_login", "messenger"])
    .eq("is_active", true)
    .eq("config->>webhook_verify_token", verifyToken)
    .limit(1)
    .maybeSingle();

  if (!integration) {
    return new Response(JSON.stringify({ error: "Verification token not recognized" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log(`[meta-webhook] verified for ${integration.integration_type}`);
  return new Response(challenge, { status: 200, headers: { ...corsHeaders, "Content-Type": "text/plain" } });
}

async function handleIncomingEvent(req: Request) {
  const bodyText = await req.text();

  // HMAC-SHA256 signature verification
  const sigHeader = req.headers.get("x-hub-signature-256");
  const sigCheck = await verifyAgainstAnyAppSecret(bodyText, sigHeader);

  // Pre-parse object type for logging even on signature failure
  let objectTypeForLog = "unknown";
  try { objectTypeForLog = JSON.parse(bodyText)?.object || "unknown"; } catch {}

  if (!sigCheck.accepted) {
    const reason = !sigHeader
      ? "missing_signature_header"
      : "signature_mismatch_likely_wrong_app_secret";
    console.error(
      `[meta-webhook] REJECTED object=${objectTypeForLog} sig=${sigHeader ? "present" : "missing"} reason=${reason} secrets_tried=${sigCheck.secretsTried}`,
    );
    try {
      await supabase.from("webhook_failures").insert({
        source: "meta-webhook",
        object_type: objectTypeForLog,
        reason,
        signature_present: !!sigHeader,
        metadata: { secrets_tried: sigCheck.secretsTried },
      });
    } catch (e) {
      console.error("[meta-webhook] failed to record webhook_failure:", e);
    }
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let payload: any;
  try { payload = JSON.parse(bodyText); }
  catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const objectType = payload?.object;
  // Collect a quick fingerprint of fields/messaging shapes for diagnostics
  const fingerprint = summarizePayload(payload);
  console.log(
    `[meta-webhook] ACCEPTED object=${objectType} entries=${payload?.entry?.length || 0} fields=${fingerprint.fields.join("|") || "-"} messaging_events=${fingerprint.messagingEvents} sig=${sigHeader ? (sigCheck.skipped ? "unsigned-backcompat" : "verified") : "missing"} matched_secret_prefix=${sigCheck.matchedPrefix || "n/a"}`,
  );

  // Persist accepted ingress for forensic auditing (best-effort)
  try {
    await supabase.from("webhook_ingress_log").insert({
      source: "meta-webhook",
      object_type: objectType || "unknown",
      fields: fingerprint.fields,
      entry_count: payload?.entry?.length || 0,
      messaging_count: fingerprint.messagingEvents,
      signature_verified: sigCheck.accepted && !sigCheck.skipped,
      sample: fingerprint.sample,
    });
  } catch (e) {
    console.warn("[meta-webhook] ingress log insert failed:", e);
  }

  if (objectType === "whatsapp_business_account") {
    console.log("[meta-webhook] routing → whatsapp-webhook");
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": req.headers.get("x-hub-signature-256") || "",
        },
        body: bodyText,
      });
    } catch (e) {
      console.error("[meta-webhook] forward to whatsapp-webhook failed:", e);
    }
  } else if (objectType === "instagram") {
    await processInstagramEvent(payload);
  } else if (objectType === "page") {
    await processPageEnvelopeEvent(payload);
  } else {
    console.log("[meta-webhook] unknown object type:", objectType);
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function summarizePayload(payload: any): { fields: string[]; messagingEvents: number; sample: any } {
  const fields = new Set<string>();
  let messagingEvents = 0;
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    if (Array.isArray(entry.messaging)) messagingEvents += entry.messaging.length;
    if (Array.isArray(entry.changes)) for (const c of entry.changes) if (c?.field) fields.add(String(c.field));
  }
  // Tiny sample (first entry, truncated) for forensic context
  let sample: any = null;
  try {
    sample = JSON.parse(JSON.stringify(entries[0] || {}));
  } catch { sample = null; }
  return { fields: Array.from(fields), messagingEvents, sample };
}

// ─── F2: signature verification helper ─────────────────────────────────────────

let _appSecretsCache: { secrets: string[]; fetchedAt: number } = { secrets: [], fetchedAt: 0 };
async function getActiveAppSecrets(): Promise<string[]> {
  if (Date.now() - _appSecretsCache.fetchedAt < 60_000 && _appSecretsCache.secrets.length) {
    return _appSecretsCache.secrets;
  }
  const { data } = await supabase
    .from("integration_settings")
    .select("credentials")
    .in("integration_type", ["whatsapp", "instagram", "instagram_login", "messenger"])
    .eq("is_active", true);
  const set = new Set<string>();
  for (const row of data || []) {
    const secret = (row as any).credentials?.app_secret;
    if (typeof secret === "string" && secret.length > 0) set.add(secret);
  }
  _appSecretsCache = { secrets: Array.from(set), fetchedAt: Date.now() };
  return _appSecretsCache.secrets;
}

async function verifyAgainstAnyAppSecret(
  rawBody: string,
  sigHeader: string | null,
): Promise<{ accepted: boolean; skipped: boolean; secretsTried: number; matchedPrefix?: string }> {
  const secrets = await getActiveAppSecrets();
  if (secrets.length === 0) {
    return { accepted: true, skipped: true, secretsTried: 0 };
  }
  if (!sigHeader) return { accepted: false, skipped: false, secretsTried: secrets.length };
  for (const s of secrets) {
    if (await verifyXHubSignature(rawBody, sigHeader, s)) {
      return { accepted: true, skipped: false, secretsTried: secrets.length, matchedPrefix: s.slice(0, 6) };
    }
  }
  return { accepted: false, skipped: false, secretsTried: secrets.length };
}

// ─── Page-envelope router (IG-via-Page OR pure Messenger) ─────────────────────

async function processPageEnvelopeEvent(payload: any) {
  const igPageIds = await getActiveIgPageIds();
  const entries = Array.isArray(payload.entry) ? payload.entry : [];

  for (const entry of entries) {
    const messaging = Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const event of messaging) {
      if (!event.message) continue;
      const recipientId = String(event.recipient?.id || "");
      const senderId = String(event.sender?.id || "");
      const isIg = igPageIds.has(recipientId) || igPageIds.has(senderId);
      const platform: Platform = isIg ? "instagram" : "messenger";
      console.log(`[${platform === "instagram" ? "IG" : "FB"}] event sender=${senderId} recipient=${recipientId} via=${platform}`);
      await ingestMessagingEvent(event, platform);
    }
  }
}

async function processInstagramEvent(payload: any) {
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    // F3a: DMs (incl. story replies under messaging[].message.reply_to.story)
    const messaging = Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const event of messaging) {
      if (event.message) {
        console.log(`[IG] direct-object event sender=${event.sender?.id} recipient=${event.recipient?.id}`);
        await ingestMessagingEvent(event, "instagram");
      } else if (event.message_edit?.mid) {
        console.log(`[IG] message_edit mid=${event.message_edit.mid} sender=${event.sender?.id || "?"} recipient=${event.recipient?.id || entry.id || "?"}`);
        await ingestInstagramMessageEdit(event, String(entry.id || ""));
      }
    }

    // F3b: Instagram Login + comments/mentions arrive under entry.changes[]
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      const igAccountId = String(entry.id || "");
      try {
        if (change.field === "comments") {
          await ingestInstagramComment(change.value, igAccountId);
        } else if (change.field === "mentions") {
          await ingestInstagramMention(change.value, igAccountId);
        } else if (change.field === "messages" || change.field === "message_echoes") {
          // Instagram Login API delivers DMs HERE, not in entry.messaging[]
          const v = change.value || {};
          const event = {
            sender: v.sender,
            recipient: v.recipient,
            timestamp: v.timestamp,
            message: v.message,
          };
          if (event.message && event.sender?.id && event.recipient?.id) {
            console.log(`[IG] changes-style DM field=${change.field} sender=${event.sender.id} recipient=${event.recipient.id}`);
            await ingestMessagingEvent(event, "instagram");
          } else {
            console.log(`[IG] changes-style ${change.field} missing fields, skipping`);
          }
        } else if (
          change.field === "messaging_postbacks" ||
          change.field === "messaging_seen" ||
          change.field === "messaging_referral" ||
          change.field === "message_reactions" ||
          change.field === "message_edit"
        ) {
          // Acknowledge silently — not surfaced in CRM yet
          console.log(`[IG] ack ${change.field} from=${change.value?.sender?.id || "?"}`);
        } else {
          console.log(`[IG] unhandled change field=${change.field}`);
        }
      } catch (e) {
        console.error(`[IG] change handler error field=${change.field}:`, e);
      }
    }
  }
}

async function ingestMessagingEvent(event: any, platform: Platform) {
  const senderId = event.sender?.id;
  const recipientId = event.recipient?.id;
  const message = event.message;
  if (!senderId || !recipientId || !message) return;

  const integration = await findIntegrationByPageId(recipientId, platform)
    || await findIntegrationByPageId(senderId, platform); // echo case
  const branchId = integration?.branch_id || await getFallbackBranchId();
  if (!branchId) {
    console.log(`[${platform}] no branch found, skipping`);
    return;
  }

  const isOutbound = message.is_echo === true;
  const contactId = isOutbound ? recipientId : senderId;

  // F3c: detect IG story reply (DM that quotes a story)
  const isStoryReply = !!(message.reply_to?.story || event.story);
  let messageType = message.attachments?.[0]?.type || "text";
  if (isStoryReply) messageType = "story_reply";

  const baseContent = message.text
    || (message.attachments?.[0]?.type === "image" ? "[Image]" : message.attachments?.[0]?.type ? `[${message.attachments[0].type}]` : "[Attachment]");
  const storyRef = message.reply_to?.story?.id || event.story?.id;
  const content = isStoryReply && storyRef
    ? `[Story reply → ${storyRef}] ${baseContent}`
    : baseContent;

  const mediaUrl = message.attachments?.[0]?.payload?.url || null;

  if (message.mid) {
    const { data: existing } = await supabase
      .from("whatsapp_messages")
      .select("id")
      .eq("platform_message_id", message.mid)
      .maybeSingle();
    if (existing) {
      console.log(`[${platform}] dedup hit mid=${message.mid}`);
      return;
    }
  }

// F4: resolve IG sender display name + avatar on first contact
  let contactName: string | null = null;
  let contactAvatarUrl: string | null = null;
  if (platform === "instagram" && !isOutbound && integration) {
    const profile = await resolveInstagramSenderProfile(contactId, integration);
    contactName = profile?.name ?? null;
    contactAvatarUrl = profile?.avatar_url ?? null;
  }

  const { data: inserted, error } = await supabase
    .from("whatsapp_messages")
    .insert({
      branch_id: branchId,
      phone_number: contactId,
      contact_name: contactName,
      contact_avatar_url: contactAvatarUrl,
      message_type: messageType,
      content,
      media_url: mediaUrl,
      direction: isOutbound ? "outbound" : "inbound",
      status: isOutbound ? "sent" : "received",
      platform: platform as any,
      platform_message_id: message.mid || null,
    })
    .select("id")
    .single();

  // Persist display name / avatar for IG (and any future platform with a
  // profile resolver) so the chat list/header stay populated even when the
  // most recent message row lacks them.
  if (!isOutbound && (contactName || contactAvatarUrl)) {
    try {
      await supabase.rpc("upsert_meta_contact_profile", {
        p_branch_id: branchId,
        p_phone: contactId,
        p_platform: platform,
        p_external_id: contactId,
        p_display_name: contactName,
        p_avatar_url: contactAvatarUrl,
      });
    } catch (profileErr) {
      console.warn(`[${platform}] profile upsert failed:`, profileErr);
    }
  }

  if (error) {
    console.error(`[${platform}] insert failed:`, error.message);
    return;
  }
  console.log(`[${platform}] stored ${isOutbound ? "outbound" : "inbound"} type=${messageType} msg id=${inserted?.id}`);

  if (!isOutbound && inserted) {
    await supabase.from("whatsapp_chat_settings").upsert(
      { branch_id: branchId, phone_number: contactId, is_unread: true, platform: platform as any },
      { onConflict: "branch_id,phone_number" }
    );
    await triggerAiReply(inserted.id, contactId, branchId, platform, integration);
  }
}

async function ingestInstagramMessageEdit(event: any, entryAccountId: string) {
  const mid = String(event.message_edit?.mid || "");
  if (!mid) {
    await logProcessing({ object_type: "instagram", event_kind: "message_edit", status: "dropped", reason: "missing_mid", sample: event });
    return;
  }
  const { data: existing } = await supabase
    .from("whatsapp_messages")
    .select("id")
    .eq("platform_message_id", mid)
    .maybeSingle();
  if (existing) {
    console.log(`[IG] message_edit dedup mid=${mid}`);
    await logProcessing({ object_type: "instagram", event_kind: "message_edit", platform_message_id: mid, status: "deduped" });
    return;
  }

  const integration = await findIntegrationByPageId(String(event.recipient?.id || entryAccountId), "instagram")
    || await findIntegrationByPageId(entryAccountId, "instagram");
  const businessId = String(integration?.config?.instagram_account_id || integration?.config?.page_id || entryAccountId || "");

  // 1. Try direct text from the webhook payload (some IG events do include it)
  let messageText: string | null = event.message_edit?.text || null;
  let fromId = String(event.sender?.id || "");
  let toId = String(event.recipient?.id || entryAccountId || "");
  let resolveError: any = null;

  // 2. Try /{mid} lookup
  if (!messageText || !fromId) {
    const resolved = integration ? await fetchInstagramMessageByMid(mid, integration) : null;
    if (resolved && !resolved.__error) {
      messageText = messageText || resolved.message || resolved.text || null;
      fromId = fromId || String(resolved.from?.id || "");
      toId = toId || String(resolved.to?.data?.[0]?.id || resolved.to?.id || "");
    } else if (resolved?.__error) {
      resolveError = resolved.__error;
    }
  }

  // 3. Conversation-API fallback: scan recent conversations for this mid
  if ((!messageText || !fromId) && integration && businessId) {
    const conv = await findInstagramMessageViaConversations(businessId, mid, integration);
    if (conv) {
      messageText = messageText || conv.message || null;
      fromId = fromId || String(conv.from?.id || "");
      toId = toId || String(conv.to?.data?.[0]?.id || conv.to?.id || "");
    }
  }

  const isOutbound = !!fromId && (fromId === businessId);
  const contactId = isOutbound ? toId : fromId;

  // 4. Last resort placeholder so the conversation still appears in CRM
  if (!contactId) {
    // We have nothing to attach this to. Record diagnostically.
    console.warn(`[IG] message_edit unresolved contact mid=${mid} resolveError=${resolveError?.message || "n/a"}`);
    await logProcessing({
      object_type: "instagram",
      event_kind: "message_edit",
      platform_message_id: mid,
      status: "resolve_failed",
      reason: "no_contact_after_mid_lookup_and_conversations_fallback",
      meta_error_code: resolveError?.code ?? null,
      meta_error_subcode: resolveError?.error_subcode ?? null,
      meta_error_message: resolveError?.message ?? null,
      sample: event,
    });
    return;
  }

  const finalText = messageText || "[Instagram message — content unavailable from Meta]";
  await ingestMessagingEvent({
    sender: { id: isOutbound ? businessId : contactId },
    recipient: { id: isOutbound ? contactId : businessId },
    timestamp: event.timestamp,
    message: { mid, text: finalText, is_echo: isOutbound },
  }, "instagram");

  await logProcessing({
    object_type: "instagram",
    event_kind: "message_edit",
    platform_message_id: mid,
    status: messageText ? "stored" : "placeholder_stored",
    reason: messageText ? null : "meta_did_not_return_text",
    meta_error_code: resolveError?.code ?? null,
    meta_error_subcode: resolveError?.error_subcode ?? null,
    meta_error_message: resolveError?.message ?? null,
  });
}

async function findInstagramMessageViaConversations(igUserId: string, mid: string, integration: any): Promise<any | null> {
  const accessToken = integration?.credentials?.access_token || integration?.credentials?.page_access_token;
  if (!accessToken) return null;
  const { isInstagramLogin } = detectMetaHost(accessToken);
  const base = isInstagramLogin ? IG_API_BASE : META_API_BASE;
  // List the most recent conversations and look for a message with this mid
  try {
    const convUrl = `${base}/${encodeURIComponent(igUserId)}/conversations?platform=instagram&fields=messages.limit(20){id,message,from,to,created_time}&limit=10&access_token=${encodeURIComponent(accessToken)}`;
    const resp = await metaFetchWithFallback(convUrl);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.warn(`[IG] conversations fallback failed: ${data?.error?.message || resp.status}`);
      return null;
    }
    const conversations: any[] = Array.isArray(data?.data) ? data.data : [];
    for (const c of conversations) {
      const messages: any[] = Array.isArray(c?.messages?.data) ? c.messages.data : [];
      const hit = messages.find((m: any) => String(m.id) === mid);
      if (hit) return hit;
    }
  } catch (e) {
    console.warn("[IG] conversations fallback error:", e instanceof Error ? e.message : e);
  }
  return null;
}

// ─── F3: Instagram comments + mentions ────────────────────────────────────────

async function ingestInstagramComment(value: any, igAccountId: string) {
  if (!value) return;
  const commentId = String(value.id || "");
  const fromId = String(value.from?.id || "");
  const fromUsername = value.from?.username ? `@${value.from.username}` : (fromId ? "Instagram User" : null);
  const text = String(value.text || "[no text]");
  const mediaId = String(value.media?.id || "");
  if (!commentId || !fromId) {
    console.log("[IG] comment missing id/from, skipping");
    return;
  }

  const integration = await findIntegrationByPageId(igAccountId, "instagram");
  const branchId = integration?.branch_id || await getFallbackBranchId();
  if (!branchId) return;

  // Dedup by platform_message_id = comment_id
  const { data: existing } = await supabase
    .from("whatsapp_messages")
    .select("id")
    .eq("platform_message_id", commentId)
    .maybeSingle();
  if (existing) {
    console.log(`[IG] dedup comment id=${commentId}`);
    return;
  }

  const content = `[Comment on ${mediaId || "media"}] ${text}`;
  const { data: inserted, error } = await supabase
    .from("whatsapp_messages")
    .insert({
      branch_id: branchId,
      phone_number: fromId,
      contact_name: fromUsername,
      message_type: "comment",
      content,
      direction: "inbound",
      status: "received",
      platform: "instagram" as any,
      platform_message_id: commentId,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[IG] comment insert failed:", error.message);
    return;
  }
  console.log(`[IG] stored comment id=${inserted?.id} from=${fromUsername || fromId}`);

  await supabase.from("whatsapp_chat_settings").upsert(
    { branch_id: branchId, phone_number: fromId, is_unread: true, platform: "instagram" as any },
    { onConflict: "branch_id,phone_number" }
  );

  // Auto-reply on comments only when explicitly enabled
  const orgConfig = await getOrgAiConfig();
  const aiConfig = orgConfig?.whatsapp_ai_config as any;
  if (aiConfig?.instagram_auto_reply_comments === true && inserted) {
    await triggerAiReply(inserted.id, fromId, branchId, "instagram", integration);
  }
}

async function ingestInstagramMention(value: any, igAccountId: string) {
  if (!value) return;
  const commentId = String(value.comment_id || value.media_id || "");
  const mediaId = String(value.media_id || "");
  const fromId = String(value.from?.id || "");
  const fromUsername = value.from?.username ? `@${value.from.username}` : (fromId ? "Instagram User" : null);
  if (!commentId) {
    console.log("[IG] mention missing id, skipping");
    return;
  }

  const integration = await findIntegrationByPageId(igAccountId, "instagram");
  const branchId = integration?.branch_id || await getFallbackBranchId();
  if (!branchId) return;

  const { data: existing } = await supabase
    .from("whatsapp_messages")
    .select("id")
    .eq("platform_message_id", commentId)
    .maybeSingle();
  if (existing) return;

  const content = `[@mention on ${mediaId || "media"}] (open Instagram to view context)`;
  const { error } = await supabase
    .from("whatsapp_messages")
    .insert({
      branch_id: branchId,
      phone_number: fromId || `mention:${commentId}`,
      contact_name: fromUsername,
      message_type: "mention",
      content,
      direction: "inbound",
      status: "received",
      platform: "instagram" as any,
      platform_message_id: commentId,
    });
  if (error) {
    console.error("[IG] mention insert failed:", error.message);
    return;
  }
  console.log(`[IG] stored mention id=${commentId} from=${fromUsername || fromId}`);
}

// ─── F4: Instagram sender profile resolution ──────────────────────────────────

type IgProfile = { name: string | null; avatar_url: string | null };
const _igProfileCache = new Map<string, { profile: IgProfile; ts: number }>();

async function resolveInstagramSenderProfile(igUserId: string, integration: any): Promise<IgProfile> {
  const cached = _igProfileCache.get(igUserId);
  if (cached && Date.now() - cached.ts < 24 * 60 * 60 * 1000) return cached.profile;

  const empty: IgProfile = { name: null, avatar_url: null };
  const accessToken = integration?.credentials?.access_token || integration?.credentials?.page_access_token;
  if (!accessToken) return empty;

  const { isInstagramLogin } = detectMetaHost(accessToken);
  const primaryBase = isInstagramLogin ? IG_API_BASE : META_API_BASE;
  const fallbackBase = isInstagramLogin ? META_API_BASE : IG_API_BASE;
  const fields = "name,username,profile_pic_url";

  async function attempt(base: string): Promise<{ ok: boolean; data: any; status: number }> {
    const url = `${base}/${encodeURIComponent(igUserId)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(accessToken)}`;
    try {
      const resp = await metaFetchWithFallback(url);
      const data = await resp.json().catch(() => ({}));
      return { ok: resp.ok, data, status: resp.status };
    } catch (e) {
      console.warn(`[IG profile] fetch threw on ${base}:`, e instanceof Error ? e.message : e);
      return { ok: false, data: {}, status: 0 };
    }
  }

  try {
    let result = await attempt(primaryBase);
    if (!result.ok) {
      console.warn(`[IG profile] primary (${primaryBase}) failed for ${igUserId}: ${result.data?.error?.message || result.status} — trying fallback`);
      result = await attempt(fallbackBase);
    }
    if (!result.ok) {
      _igProfileCache.set(igUserId, { profile: empty, ts: Date.now() });
      return empty;
    }
    const username = result.data.username ? `@${result.data.username}` : null;
    const display = result.data.name || username || null;
    const profile: IgProfile = { name: display, avatar_url: result.data.profile_pic_url || null };
    _igProfileCache.set(igUserId, { profile, ts: Date.now() });
    if (display) console.log(`[IG profile] resolved ${igUserId} → ${display}${profile.avatar_url ? ' (with avatar)' : ''}`);
    return profile;
  } catch (e) {
    console.warn(`[IG profile] error for ${igUserId}:`, e instanceof Error ? e.message : e);
    return empty;
  }
}

// Backward-compat shim
async function resolveInstagramSenderName(igUserId: string, integration: any): Promise<string | null> {
  return (await resolveInstagramSenderProfile(igUserId, integration)).name;
}

async function fetchInstagramMessageByMid(mid: string, integration: any): Promise<any | null> {
  const accessToken = integration?.credentials?.access_token || integration?.credentials?.page_access_token;
  if (!accessToken) return null;
  const { isInstagramLogin } = detectMetaHost(accessToken);
  const base = isInstagramLogin ? IG_API_BASE : META_API_BASE;
  const fields = "id,message,from,to,created_time,attachments";
  try {
    const url = `${base}/${encodeURIComponent(mid)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(accessToken)}`;
    const resp = await metaFetchWithFallback(url);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = data?.error || { message: `HTTP ${resp.status}` };
      console.warn(`[IG] fetch message failed mid=${mid}: ${err.message}`);
      return { __error: err };
    }
    return data;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`[IG] fetch message error mid=${mid}:`, message);
    return { __error: { message } };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function findIntegrationByPageId(pageId: string, integrationType: string) {
  // For Instagram, check both `instagram` (FB Page flow) and `instagram_login` providers.
  const types = integrationType === "instagram"
    ? ["instagram_login", "instagram"]
    : [integrationType];
  const { data } = await supabase
    .from("integration_settings")
    .select("id, branch_id, config, credentials, integration_type")
    .in("integration_type", types)
    .eq("is_active", true)
    .limit(50);
  if (!data) return null;
  const exact = data.find((i: any) =>
    String(i.config?.page_id) === pageId ||
    String(i.config?.instagram_account_id) === pageId
  );
  return exact || data[0] || null;
}

let _fallbackBranchId: string | null = null;
async function getFallbackBranchId(): Promise<string | null> {
  if (_fallbackBranchId) return _fallbackBranchId;
  const { data } = await supabase
    .from("branches")
    .select("id")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  _fallbackBranchId = data?.id || null;
  return _fallbackBranchId;
}

async function triggerAiReply(
  messageId: string,
  senderId: string,
  branchId: string,
  platform: Platform,
  _integration?: any
) {
  console.log(`[AI:${platform}] start sender=${senderId} branch=${branchId}`);

  // Load the inbound message content + type for story guard
  const { data: inboundMsg } = await supabase
    .from("whatsapp_messages")
    .select("content, contact_name, message_type")
    .eq("id", messageId)
    .single();

  // ── Do-Not-Contact opt-out gate (same behaviour as whatsapp-webhook) ─────
  try {
    const { detectOptOut } = await import("../_shared/optOutDetector.ts");
    const detection = detectOptOut(inboundMsg?.content || "");
    if (detection.optOut) {
      console.log(`[AI:${platform}] opt-out detected (${detection.reason}) for ${senderId}`);
      await supabase.rpc("mark_do_not_contact", {
        p_phone: senderId,
        p_branch_id: branchId,
        p_reason: detection.reason || "lead_request",
        p_until: null,
        p_source: "inbound_detector",
      });
      await supabase
        .from("whatsapp_chat_settings")
        .upsert(
          { branch_id: branchId, phone_number: senderId, bot_active: false },
          { onConflict: "branch_id,phone_number" },
        );
      // Note: meta/IG/FB freeform window rules differ — we just stop here.
      return;
    }
  } catch (gateErr) {
    console.warn(`[AI:${platform}] opt-out gate failed (continuing):`, gateErr);
  }

  const result = await runUnifiedAgent(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    senderId,
    branchId,
    platform,
    messageId,
    messageContent: inboundMsg?.content || "",
    contactName: inboundMsg?.contact_name || null,
    messageType: inboundMsg?.message_type || "text",
  });

  if (result.skipped || !result.replyText) {
    console.log(`[AI:${platform}] skipped: ${result.skipReason || "no_reply"}`);
    return;
  }

  // Store reply
  const { data: replyMsg } = await supabase
    .from("whatsapp_messages")
    .insert({
      branch_id: branchId,
      phone_number: senderId,
      content: result.replyText,
      direction: "outbound",
      status: "pending",
      message_type: "text",
      platform: platform as any,
    })
    .select("id")
    .single();

  if (!replyMsg) return;

  // Send via send-message edge function
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      body: JSON.stringify({
        message_id: replyMsg.id,
        recipient_id: senderId,
        content: result.replyText,
        branch_id: branchId,
        platform,
      }),
    });
  } catch (sendErr) {
    console.error(`[AI:${platform}] send reply failed:`, sendErr);
  }
}
