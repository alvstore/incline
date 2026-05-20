// v2.1.0 — Instagram Comment-to-DM Automation: matching + execution helpers.
//
// Used by:
//   - meta-webhook (matchAndQueueCampaigns on inbound comment)
//   - process-ig-comment-runs (cron executor)
//
// v2.1 changes:
//   - human_review campaigns now queue runs with status='awaiting_review'
//     and a pre-rendered dm_draft so a reviewer sees & edits the exact DM.
//     Executor never picks these up until review_ig_run RPC releases them.
//
// v2.0 changes:
//   - DNC lookup is platform-scoped (no WhatsApp/Instagram collision)
//   - Self-comment guard uses integration page/business ids, not igAccountId blindly
//   - `allow_repeat` honored via cooldown_minutes pre-check
//   - daily_cap pre-check before queueing
//   - ensureLeadFromIgComment(): creates/updates a lead and links it to the run
//   - generateAiReplyEphemeral(): one-shot Lovable AI Gateway call that does NOT
//     touch the DM conversation memory

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface IgCommentEvent {
  comment_id: string;
  ig_user_id: string;        // commenter IGSID
  ig_username?: string | null;
  ig_account_id: string;     // business IG account that owns the post
  media_id: string;
  text: string;
  raw: unknown;
}

export interface IgCampaignRow {
  id: string;
  branch_id: string;
  integration_id: string | null;
  name: string;
  ig_media_id: string | null;
  ig_media_permalink: string | null;
  ig_account_id: string | null;
  keywords: string[];
  match_type: "exact" | "contains" | "starts_with";
  case_sensitive: boolean;
  reply_mode: "template" | "ai" | "hybrid";
  dm_template: string | null;
  ai_instruction: string | null;
  ai_tone: string | null;
  fallback_message: string | null;
  comment_public_reply: string | null;
  delay_seconds: number;
  allow_repeat: boolean;
  per_user_cooldown_minutes: number;
  daily_cap: number;
  lead_tag: string | null;
  pipeline_stage: string | null;
  notify_staff: boolean;
  human_review: boolean;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
}

export function matchKeyword(
  text: string,
  campaign: Pick<IgCampaignRow, "keywords" | "match_type" | "case_sensitive">,
): string | null {
  if (!text || !campaign.keywords?.length) return null;
  const hay = campaign.case_sensitive ? text : text.toLowerCase();
  for (const raw of campaign.keywords) {
    if (!raw) continue;
    const kw = campaign.case_sensitive ? raw : raw.toLowerCase();
    if (campaign.match_type === "exact" && hay.trim() === kw.trim()) return raw;
    if (campaign.match_type === "starts_with" && hay.trim().startsWith(kw)) return raw;
    if (campaign.match_type === "contains" && hay.includes(kw)) return raw;
  }
  return null;
}

export function renderTemplate(
  tpl: string,
  vars: Record<string, string | null | undefined>,
): string {
  return tpl.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi, (_m, key) => {
    const v = vars[String(key).toLowerCase()];
    return v == null ? "" : String(v);
  });
}

/**
 * Returns the "own" IG IDs we should never auto-DM. Includes business account id,
 * connected page id, and any explicit owner ids stored on the integration.
 */
async function getOwnIgIds(
  supabase: SupabaseClient,
  igAccountId: string,
): Promise<Set<string>> {
  const out = new Set<string>([igAccountId]);
  try {
    const { data } = await supabase
      .from("integration_settings")
      .select("credentials")
      .in("provider", ["instagram", "instagram_login", "meta", "facebook_page"])
      .eq("is_active", true);
    for (const row of data || []) {
      const c: any = row?.credentials || {};
      for (const k of [
        "instagram_account_id",
        "ig_account_id",
        "instagram_business_account_id",
        "page_id",
        "ig_user_id",
        "owner_ig_id",
      ]) {
        if (c[k]) out.add(String(c[k]));
      }
    }
  } catch (_) { /* fail-open */ }
  return out;
}

async function isUserInCooldown(
  supabase: SupabaseClient,
  campaignId: string,
  igUserId: string,
  cooldownMinutes: number,
): Promise<boolean> {
  if (!cooldownMinutes || cooldownMinutes <= 0) return false;
  const since = new Date(Date.now() - cooldownMinutes * 60_000).toISOString();
  const { data } = await supabase
    .from("ig_comment_runs")
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("ig_user_id", igUserId)
    .eq("status", "sent")
    .gte("executed_at", since)
    .limit(1)
    .maybeSingle();
  return !!data;
}

async function isDailyCapReached(
  supabase: SupabaseClient,
  campaignId: string,
  cap: number,
): Promise<boolean> {
  if (!cap || cap <= 0) return false;
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { count } = await supabase
    .from("ig_comment_runs")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", "sent")
    .gte("executed_at", since);
  return (count || 0) >= cap;
}

/**
 * On inbound comment: find matching campaigns, dedupe per-user, queue runs.
 * Fail-open: any error is logged and swallowed so it never blocks the
 * existing meta-webhook DM-reply pipeline.
 */
export async function matchAndQueueCampaigns(
  supabase: SupabaseClient,
  event: IgCommentEvent,
  branchId: string,
): Promise<void> {
  try {
    // Self-comment guard — never DM your own page/business account
    const ownIds = await getOwnIgIds(supabase, event.ig_account_id);
    if (event.ig_user_id && ownIds.has(event.ig_user_id)) return;

    const nowIso = new Date().toISOString();
    const { data: campaigns, error } = await supabase
      .from("ig_comment_campaigns")
      .select("*")
      .eq("is_active", true)
      .eq("branch_id", branchId)
      .or(`ig_account_id.eq.${event.ig_account_id},ig_account_id.is.null`);

    if (error) {
      console.error("[ig-auto] campaign lookup failed:", error.message);
      return;
    }

    const eligible: IgCampaignRow[] = (campaigns || []).filter((c: IgCampaignRow) => {
      if (c.starts_at && c.starts_at > nowIso) return false;
      if (c.ends_at && c.ends_at < nowIso) return false;
      if (c.ig_media_id && c.ig_media_id !== event.media_id) return false;
      return matchKeyword(event.text, c) !== null;
    });

    if (eligible.length === 0) return;

    // Opt-out detection on the comment text itself
    let optOut = false;
    try {
      const { detectOptOut } = await import("./optOutDetector.ts");
      optOut = detectOptOut(event.text).optOut;
    } catch (_) { /* keep going */ }

    // Platform-scoped DNC lookup
    const { data: dnc } = await supabase
      .from("whatsapp_chat_settings")
      .select("do_not_contact")
      .eq("branch_id", branchId)
      .eq("phone_number", event.ig_user_id)
      .eq("platform", "instagram")
      .maybeSingle();
    const isDnc = !!dnc?.do_not_contact;

    for (const c of eligible) {
      const matched = matchKeyword(event.text, c)!;

      // Pre-flight gating → record as skipped for full audit visibility
      let skipReason: string | null = null;
      if (optOut) skipReason = "opt_out_detected";
      else if (isDnc) skipReason = "do_not_contact";
      else if (await isDailyCapReached(supabase, c.id, c.daily_cap || 0)) skipReason = "daily_cap_reached";
      else if (
        c.allow_repeat &&
        await isUserInCooldown(supabase, c.id, event.ig_user_id, c.per_user_cooldown_minutes || 0)
      ) skipReason = "in_cooldown";

      const scheduledAt = !skipReason && c.delay_seconds > 0
        ? new Date(Date.now() + c.delay_seconds * 1000).toISOString()
        : null;

      // Human-review gate: hold the run as 'awaiting_review' with a pre-rendered
      // draft so the reviewer sees & can edit the exact DM before release.
      const needsReview = !skipReason && c.human_review === true;
      const status = skipReason
        ? "skipped"
        : (needsReview ? "awaiting_review" : (scheduledAt ? "scheduled" : "pending"));

      let dmDraft: string | null = null;
      if (needsReview) {
        const baseTpl = c.dm_template ?? c.fallback_message ?? "";
        dmDraft = renderTemplate(baseTpl, {
          username: event.ig_username ?? "",
          keyword: matched ?? "",
          comment: event.text ?? "",
          campaign: c.name ?? "",
        });
      }

      const { error: insErr } = await supabase.from("ig_comment_runs").insert({
        campaign_id: c.id,
        branch_id: branchId,
        ig_user_id: event.ig_user_id,
        ig_username: event.ig_username || null,
        ig_media_id: event.media_id,
        comment_id: event.comment_id,
        comment_text: event.text,
        matched_keyword: matched,
        action: "send_dm",
        status,
        skip_reason: skipReason,
        scheduled_at: needsReview ? null : scheduledAt,
        dm_draft: dmDraft,
        raw_payload: event.raw,
      });

      // Unique-violation = already queued/sent for this user+campaign+action
      if (insErr && !/duplicate key/i.test(insErr.message)) {
        console.error("[ig-auto] run insert failed:", insErr.message);
        continue;
      }
      if (insErr) continue;

      await supabase.rpc("bump_ig_campaign_counters", {
        p_campaign_id: c.id,
        p_comments_matched: 1,
      });

      // Notify staff when a DM lands in the review queue
      if (needsReview) {
        try {
          const { data: staff } = await supabase
            .from("user_roles")
            .select("user_id")
            .in("role", ["owner", "admin", "manager"]);
          const seen = new Set<string>();
          const rows = (staff || [])
            .map((r: any) => r.user_id)
            .filter((u: string) => u && !seen.has(u) && (seen.add(u) as unknown as boolean) !== undefined)
            .map((user_id: string) => ({
              user_id,
              branch_id: branchId,
              title: "IG DM awaiting review",
              message: `"${(event.text || "").slice(0, 60)}" from @${event.ig_username || event.ig_user_id}`,
              type: "warning",
              category: "lead",
              action_url: "/announcements?tab=instagram&approvals=1",
              is_read: false,
            }));
          if (rows.length) await supabase.from("notifications").insert(rows);
        } catch (e) {
          console.error("[ig-auto] review notify failed:", e instanceof Error ? e.message : e);
        }
      }

      // Queue public comment reply too (best-effort, separate action)
      if (c.comment_public_reply && !skipReason) {
        await supabase.from("ig_comment_runs").insert({
          campaign_id: c.id,
          branch_id: branchId,
          ig_user_id: event.ig_user_id,
          ig_username: event.ig_username || null,
          ig_media_id: event.media_id,
          comment_id: event.comment_id,
          comment_text: event.text,
          matched_keyword: matched,
          action: "public_reply",
          status: "pending",
          raw_payload: event.raw,
        }).then(() => {}, () => {});
      }
    }
  } catch (e) {
    console.error("[ig-auto] matchAndQueueCampaigns error:", e instanceof Error ? e.message : e);
  }
}

/**
 * Ensure a lead exists for an IG commenter and link it to chat_settings.
 * Returns the lead id, or null on failure.
 */
export async function ensureLeadFromIgComment(
  supabase: SupabaseClient,
  args: {
    branch_id: string;
    ig_user_id: string;
    ig_username?: string | null;
    campaign: Pick<IgCampaignRow, "id" | "name" | "lead_tag" | "pipeline_stage">;
  },
): Promise<string | null> {
  const { branch_id, ig_user_id, ig_username, campaign } = args;
  try {
    // 1. Prefer existing chat_settings → captured_lead_id link
    const { data: chat } = await supabase
      .from("whatsapp_chat_settings")
      .select("captured_lead_id")
      .eq("branch_id", branch_id)
      .eq("phone_number", ig_user_id)
      .eq("platform", "instagram")
      .maybeSingle();

    let leadId: string | null = chat?.captured_lead_id || null;

    if (!leadId) {
      // 2. Find existing lead via idempotency key
      const idem = `ig:${ig_user_id}`;
      const { data: existing } = await supabase
        .from("leads")
        .select("id")
        .eq("branch_id", branch_id)
        .eq("conversion_idempotency_key", idem)
        .maybeSingle();
      leadId = existing?.id || null;

      if (!leadId) {
        // 3. Create new lead — phone is required, use synthetic IG handle
        const fullName = (ig_username || "").replace(/^@/, "") || "Instagram User";
        const tags = campaign.lead_tag ? [campaign.lead_tag] : [];
        const { data: ins, error: insErr } = await supabase
          .from("leads")
          .insert({
            branch_id,
            full_name: fullName,
            phone: idem, // synthetic; CRM still treats `ig:` prefix as IG handle
            source: "instagram",
            notes: `Auto-created from IG comment campaign: ${campaign.name}`,
            tags,
            conversion_idempotency_key: idem,
            preferred_contact_channel: "instagram",
          })
          .select("id")
          .single();
        if (insErr) {
          console.error("[ig-auto] lead insert failed:", insErr.message);
          return null;
        }
        leadId = ins?.id || null;
      } else if (campaign.lead_tag) {
        // Append tag to existing lead (idempotent)
        const { data: cur } = await supabase
          .from("leads").select("tags").eq("id", leadId).maybeSingle();
        const tags = Array.from(new Set([...(cur?.tags || []), campaign.lead_tag]));
        await supabase.from("leads").update({ tags }).eq("id", leadId);
      }

      // Link chat_settings to the lead so the inbox + identity resolver work
      if (leadId) {
        await supabase.from("whatsapp_chat_settings").upsert({
          branch_id,
          phone_number: ig_user_id,
          platform: "instagram",
          captured_lead_id: leadId,
        }, { onConflict: "branch_id,phone_number" });
      }
    }

    return leadId;
  } catch (e) {
    console.error("[ig-auto] ensureLeadFromIgComment error:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * One-shot Instagram DM generation via Lovable AI Gateway. Stateless — does NOT
 * write to or read from any DM conversation memory. Returns null on failure so
 * the executor can fall back to template / fallback_message.
 */
export async function generateAiReplyEphemeral(args: {
  comment: string;
  username: string | null;
  campaignName: string;
  instruction: string | null;
  tone: string | null;
}): Promise<string | null> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return null;
  try {
    const system = [
      `You are an Instagram DM assistant for the campaign "${args.campaignName}".`,
      args.instruction ? `Goal: ${args.instruction}` : "",
      `Tone: ${args.tone || "friendly, concise"}.`,
      "Write ONE Instagram DM reply (max 3 short sentences).",
      "Do not ask for personal data unless the user volunteered it.",
      "Output the message text only — no quotes, no preamble.",
    ].filter(Boolean).join("\n");
    const user = `Instagram comment from ${args.username || "user"}:\n"${args.comment}"`;

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.7,
      }),
    });
    if (!r.ok) {
      console.error("[ig-auto] AI gateway HTTP", r.status, await r.text().catch(() => ""));
      return null;
    }
    const data = await r.json();
    const msg = data?.choices?.[0]?.message?.content?.toString().trim();
    return msg || null;
  } catch (e) {
    console.error("[ig-auto] generateAiReplyEphemeral failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
