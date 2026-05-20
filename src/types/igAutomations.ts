export type IgMatchType = "exact" | "contains" | "starts_with";
export type IgReplyMode = "template" | "ai" | "hybrid";
export type IgRunStatus = "pending" | "scheduled" | "sent" | "failed" | "skipped" | "awaiting_review";
export type IgRunAction = "send_dm" | "public_reply" | "tag_lead" | "notify_staff" | "capture_lead";

export interface IgCommentCampaign {
  id: string;
  branch_id: string;
  integration_id: string | null;
  name: string;
  ig_media_id: string | null;
  ig_account_id: string | null;
  keywords: string[];
  match_type: IgMatchType;
  case_sensitive: boolean;
  reply_mode: IgReplyMode;
  dm_template: string | null;
  ai_instruction: string | null;
  ai_tone: string | null;
  fallback_message: string | null;
  comment_public_reply: string | null;
  delay_seconds: number;
  allow_repeat: boolean;
  per_user_cooldown_minutes: number;
  daily_cap: number;
  ig_media_permalink: string | null;
  lead_tag: string | null;
  pipeline_stage: string | null;
  notify_staff: boolean;
  human_review: boolean;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  comments_matched: number;
  dms_sent: number;
  dms_failed: number;
  leads_created: number;
  public_replies_sent: number;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IgCommentRun {
  id: string;
  campaign_id: string;
  branch_id: string;
  ig_user_id: string;
  ig_username: string | null;
  ig_media_id: string | null;
  comment_id: string;
  comment_text: string | null;
  matched_keyword: string | null;
  action: IgRunAction;
  status: IgRunStatus;
  skip_reason: string | null;
  attempts: number;
  scheduled_at: string | null;
  executed_at: string | null;
  error_message: string | null;
  lead_id: string | null;
  outbound_message_id: string | null;
  raw_payload: unknown;
  created_at: string;
}

export type IgCampaignUpsert = Partial<IgCommentCampaign> & {
  name: string;
  branch_id: string;
  keywords: string[];
};
