// v5.7.0 — Flatten chat envelopes for IG/Messenger DMs. Brain replies that are
//          structured JSON ({"type":"interactive_list",…} for goal/plan steps,
//          or {"status":"lead_captured",…} control payloads) used to be sent
//          verbatim — IG users literally saw raw JSON in chat. We now route
//          result.replyText through flattenReplyForPlainText() before persist +
//          send, rendering interactive lists as numbered text and stripping
//          control payloads silently.
// v5.6.0 — Permanent IG thumbnail caching: download Meta CDN preview into
//   public `template-media/ig-cache/{media_id}.jpg` so the comment card
//   survives the ~24h Meta URL expiry. Falls back to ephemeral URL on failure.
// v5.5.0 — IG comments now resolve post/reel/ad media via Graph API +
//   ig_comment_campaigns cache; stores preview thumbnail + permalink in media_meta
//   so the chat UI shows the actual post instead of "[Comment on <media_id>]".
// v5.4.0 — Normalize Meta scoped sender IDs to `+<digits>` (phoneKey) before
//          ALL DB lookups in triggerAiReply (state gate, ai_memory, AI claim,
//          outbound dedupe, message insert, send-whatsapp body). Without this
//          the brain queried `1234…` while the DB normalizer stored `+1234…`
//          → empty history → AI re-asked "What's your name?" every turn.
//          Also: self-heal stuck IG/Messenger outbound rows by flipping them
//          to `failed` when send-fn returns non-OK or throws, so the inbox
//          stops showing an indefinite clock icon.
// v5.2.0 — Instagram duplicate-reply hardening:
//          (1) atomic per-contact AI claim via claim_meta_ai_reply RPC stops
//              double DMs when a long text + attachment arrive back-to-back or
//              when Meta retries the same envelope under multiple shapes.
//          (2) outbound echo events now UPDATE the local bot row instead of
//              inserting a second visible message (with hard unique index
//              fallback on (platform, platform_message_id)).
//          (3) attachment-only inbound IG/Messenger events no longer trigger
//              the lead-capture onboarding question.
// v5.1.0 — Persist IG profile pictures to Supabase Storage (avatars/meta/…)
//          + classify "User consent is required" responses so comment-only
//          contacts are not re-queried on every inbound message.
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
import { flattenReplyForPlainText } from "../_shared/chatEnvelope.ts";
import { runUnifiedAgent } from "../_shared/ai-agent-brain.ts";
import { persistMetaAvatar, isConsentBlockedError, type MetaPlatform } from "../_shared/metaAvatar.ts";

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

// SSOT: ops toggles come from ai_purposes.ops_config (purpose='whatsapp_reply', branch=NULL).
async function getOrgAiConfig() {
  if (_orgAiConfig && Date.now() - _orgAiConfigFetchedAt < 60_000) return _orgAiConfig;
  const [{ data: org }, { data: purpose }] = await Promise.all([
    supabase.from("organization_settings").select("name").limit(1).maybeSingle(),
    supabase
      .from("ai_purposes")
      .select("ops_config")
      .eq("purpose", "whatsapp_reply")
      .is("branch_id", null)
      .maybeSingle(),
  ]);
  _orgAiConfig = {
    gym_name: (org as any)?.name ?? null,
    ops: ((purpose as any)?.ops_config as Record<string, any>) ?? {},
  };
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
    const reason = sigCheck.secretsTried === 0
      ? "no_app_secret_configured"
      : !sigHeader
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

  // v4.4.0 — Acknowledge to Meta synchronously, then process in background.
  // Meta retries on slow/5xx responses; long AI runs were causing the same
  // inbound to be ingested 2-3x, producing the duplicate-reply bug.
  const processInBackground = (async () => {
    try {
      if (objectType === "whatsapp_business_account") {
        console.log("[meta-webhook] routing → whatsapp-webhook");
        await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-webhook`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-hub-signature-256": req.headers.get("x-hub-signature-256") || "",
          },
          body: bodyText,
        });
      } else if (objectType === "instagram") {
        await processInstagramEvent(payload);
      } else if (objectType === "page") {
        await processPageEnvelopeEvent(payload);
      } else {
        console.log("[meta-webhook] unknown object type:", objectType);
      }
    } catch (e) {
      console.error("[meta-webhook] background processing failed:", e);
    }
  })();

  // @ts-ignore — EdgeRuntime is available in Supabase Functions runtime
  if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any)?.waitUntil) {
    // @ts-ignore
    (EdgeRuntime as any).waitUntil(processInBackground);
  } else {
    await processInBackground;
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
    // Fail closed: without a configured app secret we cannot verify authenticity.
    return { accepted: false, skipped: false, secretsTried: 0 };
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

  // ── DEDUPE 1: by Meta mid when present ────────────────────────────────
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

  // ── DEDUPE 2: content-hash fallback for mid-less IG Login deliveries ──
  // Meta sometimes delivers the same DM on BOTH entry.messaging[] AND
  // entry.changes[] (field=messages) without mid. Hash = sha1 of
  // direction|content|timestamp-minute. Unique index prevents the 2nd insert.
  let dedupeHash: string | null = null;
  if (!message.mid) {
    try {
      const tsMinute = Math.floor((event.timestamp || Date.now()) / 60000);
      const raw = `${isOutbound ? "out" : "in"}|${content}|${tsMinute}`;
      const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(raw));
      dedupeHash = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch { /* fall through */ }
  }

// F4: resolve IG sender display name + avatar on first contact
  let contactName: string | null = null;
  let contactUsername: string | null = null;
  let contactAvatarUrl: string | null = null;
  let avatarSource: "storage" | "meta_cdn" | null = null;
  let avatarSyncedAt: string | null = null;
  let avatarConsentBlocked = false;
  if (platform === "instagram" && !isOutbound) {
    // Some Meta payloads include the sender username inline — capture it first.
    if (event.sender?.username) contactUsername = String(event.sender.username);
    if (integration) {
      const profile = await resolveInstagramSenderProfile(contactId, integration);
      contactName = profile?.name ?? contactName;
      contactUsername = profile?.username ?? contactUsername;
      avatarConsentBlocked = !!profile?.consent_blocked;
      // Persist Meta's short-lived CDN avatar into Storage so the URL never expires.
      if (profile?.avatar_url && !avatarConsentBlocked) {
        const persisted = await persistMetaAvatar({
          scopedId: contactId,
          platform: "instagram",
          cdnUrl: profile.avatar_url,
          serviceClient: supabase,
        });
        contactAvatarUrl = persisted.publicUrl;
        avatarSource = persisted.source === "storage" ? "storage" : "meta_cdn";
        avatarSyncedAt = persisted.syncedAt;
      }
    }
  }

  // ── ECHO DEDUPE: when Meta echoes the bot's own outbound message back,
  // update the local row we already inserted (which has platform_message_id=NULL)
  // instead of creating a second visible chat bubble.
  if (isOutbound && message.mid) {
    const { data: localPending } = await supabase
      .from("whatsapp_messages")
      .select("id, platform_message_id")
      .eq("branch_id", branchId)
      .eq("phone_number", contactId)
      .eq("platform", platform as any)
      .eq("direction", "outbound")
      .is("platform_message_id", null)
      .eq("content", content)
      .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (localPending?.id) {
      await supabase
        .from("whatsapp_messages")
        .update({ platform_message_id: message.mid, status: "sent" })
        .eq("id", localPending.id);
      console.log(`[${platform}] echo merged into local bot row id=${localPending.id} mid=${message.mid}`);
      return;
    }
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
      dedupe_hash: dedupeHash,
    })
    .select("id")
    .single();

  if (error) {
    // Unique-violation on dedupe_hash OR (platform, platform_message_id) → already ingested.
    if ((error as any).code === "23505") {
      console.log(`[${platform}] dedup hit (unique violation) mid=${message.mid || "-"} hash=${dedupeHash || "-"}`);
      return;
    }
    console.error(`[${platform}] insert failed:`, error.message);
    return;
  }
  console.log(`[${platform}] stored ${isOutbound ? "outbound" : "inbound"} type=${messageType} msg id=${inserted?.id}`);

  if (!isOutbound && inserted) {
    await supabase.from("whatsapp_chat_settings").upsert(
      { branch_id: branchId, phone_number: contactId, is_unread: true, platform: platform as any },
      { onConflict: "branch_id,phone_number" }
    );

    // Persist display name / username / avatar / provenance so the chat list/header
    // stay populated even when newer message rows lack them, and so consent-blocked
    // contacts aren't re-queried.
    if (contactName || contactUsername || contactAvatarUrl || avatarConsentBlocked) {
      try {
        await supabase.rpc("upsert_meta_contact_profile", {
          p_branch_id: branchId,
          p_phone: contactId,
          p_platform: platform,
          p_external_id: contactId,
          p_display_name: contactName,
          p_avatar_url: contactAvatarUrl,
          p_avatar_source: avatarSource,
          p_avatar_synced_at: avatarSyncedAt,
          p_avatar_consent_blocked: avatarConsentBlocked,
          p_external_username: contactUsername,
        });
      } catch (profileErr) {
        console.warn(`[${platform}] profile upsert failed:`, profileErr);
      }
    }

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

// Cache an IG CDN thumbnail to our own public bucket so it survives Meta's ~24h URL expiry.
async function cacheIgThumbnail(mediaId: string, sourceUrl: string): Promise<string | null> {
  if (!mediaId || !sourceUrl) return null;
  try {
    const path = `ig-cache/${mediaId}.jpg`;
    // Skip download if we already cached it.
    const { data: existing } = await supabase.storage.from("template-media").list("ig-cache", {
      search: `${mediaId}.jpg`,
      limit: 1,
    });
    if (existing && existing.length) {
      const { data: pub } = supabase.storage.from("template-media").getPublicUrl(path);
      return pub?.publicUrl || null;
    }
    const r = await fetch(sourceUrl);
    if (!r.ok) {
      console.log(`[IG] thumb download failed id=${mediaId} status=${r.status}`);
      return null;
    }
    const buf = new Uint8Array(await r.arrayBuffer());
    const contentType = r.headers.get("content-type") || "image/jpeg";
    const { error: upErr } = await supabase.storage.from("template-media").upload(path, buf, {
      contentType,
      upsert: true,
    });
    if (upErr) {
      console.log(`[IG] thumb upload failed id=${mediaId}: ${upErr.message}`);
      return null;
    }
    const { data: pub } = supabase.storage.from("template-media").getPublicUrl(path);
    return pub?.publicUrl || null;
  } catch (e) {
    console.log(`[IG] thumb cache error id=${mediaId}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

// In-memory cache for IG media lookups (dedupes Graph hits across same-burst comments).
const igMediaCache = new Map<string, { at: number; data: any }>();
async function fetchIgMediaPreview(mediaId: string, accessToken: string): Promise<any | null> {
  if (!mediaId || !accessToken) return null;
  const cached = igMediaCache.get(mediaId);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.data;
  const base = "https://graph.facebook.com/v21.0";
  const fields = "id,media_type,media_product_type,media_url,thumbnail_url,permalink,caption";
  try {
    const r = await fetch(`${base}/${encodeURIComponent(mediaId)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(accessToken)}`);
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.log(`[IG] media lookup failed id=${mediaId} status=${r.status} body=${txt.slice(0, 200)}`);
      igMediaCache.set(mediaId, { at: Date.now(), data: null });
      return null;
    }
    const j = await r.json();
    let children: any[] = [];
    if (j.media_type === "CAROUSEL_ALBUM") {
      try {
        const cr = await fetch(`${base}/${encodeURIComponent(mediaId)}/children?fields=media_url,thumbnail_url,media_type&access_token=${encodeURIComponent(accessToken)}`);
        if (cr.ok) {
          const cj = await cr.json();
          children = Array.isArray(cj.data) ? cj.data : [];
        }
      } catch (_) { /* ignore */ }
    }
    const productType = String(j.media_product_type || "").toUpperCase();
    const isReel = productType === "REELS" || j.media_type === "REELS";
    const kind: "image" | "video" | "reels" | "carousel" =
      j.media_type === "CAROUSEL_ALBUM" ? "carousel"
      : isReel ? "reels"
      : j.media_type === "VIDEO" ? "video"
      : "image";
    const ephemeralPreview =
      j.thumbnail_url
      || (kind === "carousel" ? (children[0]?.thumbnail_url || children[0]?.media_url) : null)
      || j.media_url
      || null;

    // Permanently cache the thumbnail into our public bucket so the chat card
    // still renders after Meta's CDN URL expires (~24h).
    const cachedUrl = ephemeralPreview ? await cacheIgThumbnail(mediaId, ephemeralPreview) : null;

    const data = {
      kind,
      media_id: j.id || mediaId,
      media_type: j.media_type || null,
      media_product_type: j.media_product_type || null,
      permalink: j.permalink || null,
      caption: j.caption || null,
      thumbnail_url: j.thumbnail_url || null,
      media_url: j.media_url || null,
      preview_url: cachedUrl || ephemeralPreview,
      cached_preview_url: cachedUrl,
      ephemeral_preview_url: ephemeralPreview,
      children: children.length ? children.slice(0, 10) : undefined,
      source: "ig_comment_media",
    };
    igMediaCache.set(mediaId, { at: Date.now(), data });
    return data;
  } catch (e) {
    console.log(`[IG] media lookup error id=${mediaId}: ${e instanceof Error ? e.message : e}`);
    igMediaCache.set(mediaId, { at: Date.now(), data: null });
    return null;
  }
}



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

  // Resolve post/reel/ad media — prefer cached campaign permalink, else Graph API.
  let mediaMeta: any = null;
  let mediaUrl: string | null = null;
  if (mediaId) {
    try {
      const { data: camp } = await supabase
        .from("ig_comment_campaigns")
        .select("ig_media_permalink")
        .eq("ig_media_id", mediaId)
        .maybeSingle();
      if (camp?.ig_media_permalink) {
        mediaMeta = { kind: "post", media_id: mediaId, permalink: camp.ig_media_permalink, source: "ig_campaign_cache" };
      }
    } catch (_) { /* non-fatal */ }

    const token = integration?.credentials?.page_access_token || integration?.credentials?.access_token;
    if (token) {
      const fetched = await fetchIgMediaPreview(mediaId, token);
      if (fetched) {
        mediaMeta = { ...(mediaMeta || {}), ...fetched };
        mediaUrl = fetched.preview_url || null;
      }
    }
    if (!mediaMeta) {
      mediaMeta = { kind: "comment_only", media_id: mediaId, source: "unresolved" };
    }
  }

  const content = text;
  const { data: inserted, error } = await supabase
    .from("whatsapp_messages")
    .insert({
      branch_id: branchId,
      phone_number: fromId,
      contact_name: fromUsername,
      message_type: "comment",
      content,
      media_url: mediaUrl,
      media_meta: mediaMeta,
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
  console.log(`[IG] stored comment id=${inserted?.id} from=${fromUsername || fromId} media_kind=${mediaMeta?.kind || "none"}`);

  await supabase.from("whatsapp_chat_settings").upsert(
    { branch_id: branchId, phone_number: fromId, is_unread: true, platform: "instagram" as any },
    { onConflict: "branch_id,phone_number" }
  );

  // Comment-to-DM keyword automation (fail-open, never blocks DM auto-reply)
  try {
    const { matchAndQueueCampaigns } = await import("../_shared/ig-comment-automation.ts");
    await matchAndQueueCampaigns(supabase, {
      comment_id: commentId,
      ig_user_id: fromId,
      ig_username: value.from?.username || null,
      ig_account_id: igAccountId,
      media_id: mediaId,
      text,
      raw: value,
    }, branchId);
  } catch (e) {
    console.error("[IG] comment automation queue failed:", e instanceof Error ? e.message : e);
  }

  // Auto-reply on comments only when explicitly enabled (SSOT: ai_purposes.ops_config)
  const orgConfig = await getOrgAiConfig();
  const ops = (orgConfig?.ops ?? {}) as Record<string, any>;
  if (ops.instagram_auto_reply_comments === true && inserted) {
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

type IgProfile = {
  name: string | null;
  username: string | null;       // raw username without leading @
  avatar_url: string | null;     // raw Meta CDN URL (caller persists to Storage)
  consent_blocked: boolean;      // true → comment-only contact, don't retry
};
const _igProfileCache = new Map<string, { profile: IgProfile; ts: number }>();

// v2.3.0 — Returns IG username separately (display name may be consent-blocked
// while username is still available via /me/conversations participants).
export async function resolveInstagramSenderProfile(igUserId: string, integration: any): Promise<IgProfile> {
  const cached = _igProfileCache.get(igUserId);
  if (cached && Date.now() - cached.ts < 24 * 60 * 60 * 1000) return cached.profile;

  const empty: IgProfile = { name: null, username: null, avatar_url: null, consent_blocked: false };
  const pageToken = integration?.credentials?.page_access_token;
  const userToken = integration?.credentials?.access_token;
  const accessToken = pageToken || userToken;
  if (!accessToken) {
    console.warn(`[IG profile] no access token on integration for ${igUserId}`);
    return empty;
  }

  const { isInstagramLogin } = detectMetaHost(accessToken);
  const primaryBase = isInstagramLogin ? IG_API_BASE : META_API_BASE;
  const fallbackBase = isInstagramLogin ? META_API_BASE : IG_API_BASE;
  const fields = "name,username,profile_pic_url";

  async function attempt(base: string, token: string, label: string): Promise<{ ok: boolean; data: any; status: number; consent: boolean }> {
    const url = `${base}/${encodeURIComponent(igUserId)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;
    try {
      const resp = await metaFetchWithFallback(url);
      const data = await resp.json().catch(() => ({}));
      const consent = isConsentBlockedError(data);
      const meaningful = data && (data.id || data.name || data.username || data.profile_pic_url);
      if (!resp.ok || data?.error || !meaningful) {
        console.warn(`[IG profile] ${label} (${base}) returned no profile for ${igUserId} — status=${resp.status} error="${data?.error?.message || 'empty body'}"${consent ? ' [consent_blocked]' : ''}`);
        return { ok: false, data, status: resp.status, consent };
      }
      return { ok: true, data, status: resp.status, consent: false };
    } catch (e) {
      console.warn(`[IG profile] ${label} fetch threw on ${base}:`, e instanceof Error ? e.message : e);
      return { ok: false, data: {}, status: 0, consent: false };
    }
  }

  // v2.3.0 fallback: /me/conversations?user_id=… typically returns the
  // participant's username even when the direct /igsid lookup is consent-blocked.
  async function attemptConversations(base: string, token: string, businessAccountId: string): Promise<IgProfile | null> {
    try {
      const url = `${base}/${encodeURIComponent(businessAccountId)}/conversations?platform=instagram&user_id=${encodeURIComponent(igUserId)}&fields=participants&access_token=${encodeURIComponent(token)}`;
      const resp = await metaFetchWithFallback(url);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.data) return null;
      for (const conv of data.data) {
        const participants = conv?.participants?.data || [];
        for (const p of participants) {
          if (String(p?.id) === businessAccountId) continue;
          const uname = p?.username || null;
          const name = p?.name || null;
          if (uname || name) {
            return { name: name || (uname ? `@${uname}` : null), username: uname, avatar_url: null, consent_blocked: false };
          }
        }
      }
    } catch (e) {
      console.warn(`[IG profile] conversations fallback threw:`, e instanceof Error ? e.message : e);
    }
    return null;
  }

  try {
    let result = await attempt(primaryBase, accessToken, pageToken ? "page-token" : "user-token");
    if (!result.ok && !result.consent && pageToken && userToken && userToken !== pageToken) {
      result = await attempt(primaryBase, userToken, "user-token-fallback");
    }
    if (!result.ok && !result.consent) {
      result = await attempt(fallbackBase, accessToken, "alt-host");
    }
    if (!result.ok) {
      // Conversations fallback — works in many consent-blocked scenarios.
      const businessAccountId = String(integration?.config?.instagram_account_id || integration?.config?.page_id || "");
      if (businessAccountId) {
        const convProfile = await attemptConversations(primaryBase, accessToken, businessAccountId)
          || await attemptConversations(fallbackBase, accessToken, businessAccountId);
        if (convProfile && (convProfile.name || convProfile.username)) {
          _igProfileCache.set(igUserId, { profile: convProfile, ts: Date.now() });
          console.log(`[IG profile] resolved ${igUserId} via /me/conversations → ${convProfile.name || convProfile.username}`);
          return convProfile;
        }
      }
      if (result.consent) {
        const blocked: IgProfile = { name: null, username: null, avatar_url: null, consent_blocked: true };
        _igProfileCache.set(igUserId, { profile: blocked, ts: Date.now() });
        console.warn(`[IG profile] IGSID=${igUserId} is consent-blocked — caching, will NOT retry`);
        return blocked;
      }
      console.warn(`[IG profile] all attempts failed for IGSID=${igUserId} — NOT caching, will retry on next message`);
      return empty;
    }
    const username = result.data.username || null;
    const display = result.data.name || (username ? `@${username}` : null);
    const profile: IgProfile = { name: display, username, avatar_url: result.data.profile_pic_url || null, consent_blocked: false };
    if (display || profile.avatar_url || username) _igProfileCache.set(igUserId, { profile, ts: Date.now() });
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

// Normalize a Meta scoped ID (numeric) to the same E.164-ish form
// (`+<digits>`) that the `normalize_phone_in` Postgres trigger produces
// for whatsapp_messages.phone_number and whatsapp_chat_settings.phone_number.
// Without this, every `.eq("phone_number", senderId)` lookup in the AI brain
// misses (DB has `+1380…`, code queries `1380…`) and the model gets empty
// history → re-asks "What's your name?" forever.
function toPhoneKey(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return s;
  if (s.startsWith("+")) return s;
  if (/^[0-9]+$/.test(s)) return `+${s}`;
  return s;
}

async function triggerAiReply(
  messageId: string,
  rawSenderId: string,
  branchId: string,
  platform: Platform,
  _integration?: any
) {
  // `senderId` is used for every DB lookup against phone_number/contact_key.
  // `rawSenderId` is preserved separately for the Meta Graph API call, which
  // requires the un-prefixed scoped ID as `recipient.id`.
  const senderId = toPhoneKey(rawSenderId);
  console.log(`[AI:${platform}] start sender=${senderId} (raw=${rawSenderId}) branch=${branchId}`);

  // ── Per-channel kill-switch (Settings → AI Agent Control Center) ─────────
  // If the master switch or this platform's channel toggle is OFF, skip
  // BEFORE doing any DB lookups / claims / AI work. Defaults to enabled when
  // ops_config.channels is missing, for back-compat.
  try {
    const { isAiChannelEnabled } = await import("../_shared/ai-channel-toggle.ts");
    const channelOn = await isAiChannelEnabled(supabase, branchId, platform);
    if (!channelOn) {
      console.log(`[AI:${platform}] skipped — channel disabled in AI settings (branch=${branchId})`);
      return;
    }
  } catch (chanErr) {
    console.warn(`[AI:${platform}] channel-toggle check failed (continuing fail-open):`, chanErr);
  }

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

  // ── ATTACHMENT-ONLY GUARD (IG/Messenger):
  // Don't run lead-capture AI on pure attachment/media messages with no real text.
  const rawContent = (inboundMsg?.content || "").trim();
  const isAttachmentOnly =
    rawContent === "[Attachment]" ||
    rawContent === "[Image]" ||
    /^\[(image|video|audio|file|sticker|share|story|reels?)[^\]]*\]$/i.test(rawContent) ||
    rawContent.length < 2;
  if (isAttachmentOnly && (platform === "instagram" || platform === "messenger")) {
    console.log(`[AI:${platform}] skipping attachment-only message id=${messageId}`);
    return;
  }

  // ── PRE-REPLY STATE GATE:
  // If chat_settings already says bot is paused / DNC / handed off, OR
  // ai_memory says current_intent='non_fitness', do NOT call the model and
  // do NOT ask onboarding questions. The non-membership redirect was already
  // sent on the first inbound; subsequent messages must stay silent.
  try {
    const { data: cs } = await supabase
      .from("whatsapp_chat_settings")
      .select("bot_active, bot_paused_until, do_not_contact, handoff_reason")
      .eq("branch_id", branchId)
      .eq("phone_number", senderId)
      .maybeSingle();
    const isTimedPause = cs?.bot_paused_until && new Date(cs.bot_paused_until).getTime() > Date.now();
    if (cs && (cs.bot_active === false || isTimedPause || cs.do_not_contact === true || cs.handoff_reason)) {
      console.log(`[AI:${platform}] suppressed — chat paused/DNC/handoff for ${senderId}`);
      return;
    }
    const { data: mem } = await supabase
      .from("ai_memory")
      .select("current_intent")
      .eq("platform", platform)
      .eq("contact_key", senderId)
      .maybeSingle();
    if (mem?.current_intent === "non_fitness") {
      console.log(`[AI:${platform}] suppressed — ai_memory non_fitness for ${senderId}`);
      // Also harden chat_settings so other code paths short-circuit too.
      await supabase
        .from("whatsapp_chat_settings")
        .upsert(
          {
            branch_id: branchId,
            phone_number: senderId,
            platform: platform as any,
            bot_active: false,
            do_not_contact: true,
            handoff_reason: "non_fitness_inquiry",
          },
          { onConflict: "branch_id,phone_number" },
        );
      return;
    }
  } catch (gateErr) {
    console.warn(`[AI:${platform}] pre-reply state gate failed (continuing):`, gateErr);
  }

  // ── AI REPLY CLAIM (idempotency):
  // Only the first inbound in a ~45s burst from this contact may trigger AI.
  // Prevents double DMs when long-text + attachment arrive back-to-back, or
  // when Meta retries the same envelope under multiple webhook shapes.
  try {
    const { data: claimed } = await supabase.rpc("claim_meta_ai_reply" as any, {
      p_branch_id: branchId,
      p_platform: platform,
      p_phone: senderId,
      p_window_seconds: 45,
      p_inbound_message_id: messageId,
    });
    if (claimed === false) {
      console.log(`[AI:${platform}] reply claim already held for ${senderId} — skipping duplicate`);
      return;
    }
  } catch (claimErr) {
    console.warn(`[AI:${platform}] claim_meta_ai_reply failed (continuing fail-open):`, claimErr);
  }

  const result = await runUnifiedAgent(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    senderId,
    branchId,
    platform,
    messageId,
    messageContent: rawContent,
    contactName: inboundMsg?.contact_name || null,
    messageType: inboundMsg?.message_type || "text",
  });

  if (result.skipped || !result.replyText) {
    console.log(`[AI:${platform}] skipped: ${result.skipReason || "no_reply"}`);
    return;
  }

  // v5.7.0 — Meta IG/Messenger DMs do NOT support WhatsApp-style interactive
  // lists/buttons. Flatten any structured envelope from the brain into plain
  // text BEFORE persist+send so users never see raw JSON in chat.
  const flatReply = flattenReplyForPlainText(result.replyText);
  if (flatReply !== result.replyText) {
    console.log(`[AI:${platform}] flattened envelope → plain text (${flatReply.length} chars)`);
  }
  result.replyText = flatReply;



  // ── OUTBOUND DEDUPE: if we already sent the same content to this contact in
  // the last 3 minutes (e.g. retried envelope slipped past the claim), do not
  // insert / send again. This is the last line of defence before Meta.
  try {
    const since = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const { data: recentSame } = await supabase
      .from("whatsapp_messages")
      .select("id")
      .eq("branch_id", branchId)
      .eq("phone_number", senderId)
      .eq("platform", platform as any)
      .eq("direction", "outbound")
      .eq("content", result.replyText)
      .gte("created_at", since)
      .limit(1)
      .maybeSingle();
    if (recentSame) {
      console.log(`[AI:${platform}] outbound dedupe — same reply just sent to ${senderId}`);
      return;
    }
  } catch (dupErr) {
    console.warn(`[AI:${platform}] outbound dedupe check failed (continuing):`, dupErr);
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

  // Send via correct sender per platform
  try {
    const isMetaDm = platform === "instagram" || platform === "messenger";
    const fnName = isMetaDm ? "send-meta-dm" : "send-whatsapp";
    // Meta Graph API wants the RAW scoped ID for recipient.id (no leading `+`).
    // WhatsApp Cloud API accepts the normalized phone_number.
    const fnBody = isMetaDm
      ? { message_id: replyMsg.id, platform, recipient_id: rawSenderId, content: result.replyText, branch_id: branchId }
      : { message_id: replyMsg.id, phone_number: senderId, content: result.replyText, branch_id: branchId };
    const r = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      body: JSON.stringify(fnBody),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.error(`[AI:${platform}] ${fnName} HTTP ${r.status}: ${detail}`);
      // Self-heal: flip the pending row to failed so it isn't stuck on the
      // clock icon in the inbox forever.
      await supabase
        .from("whatsapp_messages")
        .update({ status: "failed", failure_reason: `send-fn-http-${r.status}: ${detail.slice(0, 200)}`, failed_at: new Date().toISOString() })
        .eq("id", replyMsg.id);
    }
  } catch (sendErr) {
    console.error(`[AI:${platform}] send reply failed:`, sendErr);
    try {
      await supabase
        .from("whatsapp_messages")
        .update({ status: "failed", failure_reason: `send-fn-throw: ${(sendErr as Error)?.message || sendErr}`, failed_at: new Date().toISOString() })
        .eq("id", replyMsg.id);
    } catch (_) { /* swallow */ }
  }
}
