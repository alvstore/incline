// v1.0.0 — Instagram Comment-to-DM Automation: matching + execution helpers.
//
// Used by:
//   - meta-webhook (matchAndQueueCampaigns on inbound comment)
//   - process-ig-comment-runs (cron executor)
//
// Reuses the existing AI brain (runUnifiedAgent), send-message edge fn,
// optOutDetector and identity resolver. Adds NO new outbound integrations.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface IgCommentEvent {
  comment_id: string;
  ig_user_id: string;        // commenter
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
    // Self-comment guard
    if (event.ig_user_id && event.ig_account_id && event.ig_user_id === event.ig_account_id) {
      return;
    }

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

    // DNC gate (reuse the same detector and DNC table)
    try {
      const { detectOptOut } = await import("./optOutDetector.ts");
      if (detectOptOut(event.text).optOut) {
        // Still log skips so admins can see why
        for (const c of eligible) {
          await supabase.from("ig_comment_runs").insert({
            campaign_id: c.id,
            branch_id: branchId,
            ig_user_id: event.ig_user_id,
            ig_username: event.ig_username || null,
            ig_media_id: event.media_id,
            comment_id: event.comment_id,
            comment_text: event.text,
            matched_keyword: matchKeyword(event.text, c),
            action: "send_dm",
            status: "skipped",
            skip_reason: "opt_out_detected",
            raw_payload: event.raw,
          });
        }
        return;
      }
    } catch (_) { /* keep going if detector unavailable */ }

    const { data: dnc } = await supabase
      .from("whatsapp_chat_settings")
      .select("do_not_contact")
      .eq("branch_id", branchId)
      .eq("phone_number", event.ig_user_id)
      .maybeSingle();
    const isDnc = !!dnc?.do_not_contact;

    for (const c of eligible) {
      const matched = matchKeyword(event.text, c)!;
      const scheduledAt = c.delay_seconds > 0
        ? new Date(Date.now() + c.delay_seconds * 1000).toISOString()
        : null;
      const status = isDnc ? "skipped" : (scheduledAt ? "scheduled" : "pending");

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
        skip_reason: isDnc ? "do_not_contact" : null,
        scheduled_at: scheduledAt,
        raw_payload: event.raw,
      });

      // Unique-violation = already queued/sent for this user+campaign+action
      if (insErr && !/duplicate key/i.test(insErr.message)) {
        console.error("[ig-auto] run insert failed:", insErr.message);
        continue;
      }
      if (insErr) continue;

      // Counters
      await supabase.rpc("bump_ig_campaign_counters", {
        p_campaign_id: c.id,
        p_comments_matched: 1,
      });

      // Queue public comment reply too (best-effort, separate action)
      if (c.comment_public_reply) {
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
        }).then(() => {}).catch(() => {});
      }
    }
  } catch (e) {
    console.error("[ig-auto] matchAndQueueCampaigns error:", e instanceof Error ? e.message : e);
  }
}
