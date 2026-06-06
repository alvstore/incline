// v1.0.0 — shared per-channel kill-switch for AI auto-replies.
// Reads ai_purposes.ops_config (purpose='whatsapp_reply'):
//   - auto_reply_enabled (master)
//   - channels.{whatsapp|instagram|messenger}.enabled (per-channel, default true)
// Used by meta-webhook, lead-nurture-followup, process-ig-comment-runs to
// short-circuit BEFORE any AI work / outbound DM is queued when a channel is
// disabled in Settings → AI Agent Control Center.

export type AiPlatform = "whatsapp" | "instagram" | "messenger";

const cache = new Map<string, { value: boolean; ts: number }>();
const TTL_MS = 30_000;

export async function isAiChannelEnabled(
  supabase: any,
  branchId: string | null,
  platform: AiPlatform | string,
): Promise<boolean> {
  const key = `${branchId ?? "global"}:${platform}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.value;

  let row: any = null;
  if (branchId) {
    const { data } = await supabase
      .from("ai_purposes")
      .select("enabled, ops_config")
      .eq("purpose", "whatsapp_reply")
      .eq("branch_id", branchId)
      .maybeSingle();
    row = data;
  }
  if (!row) {
    const { data } = await supabase
      .from("ai_purposes")
      .select("enabled, ops_config")
      .eq("purpose", "whatsapp_reply")
      .is("branch_id", null)
      .maybeSingle();
    row = data;
  }

  const ops = (row?.ops_config ?? {}) as Record<string, any>;
  const master = ops.auto_reply_enabled ?? row?.enabled ?? false;
  const channels = (ops.channels ?? {}) as Record<string, { enabled?: boolean }>;
  const channelEnabled = channels?.[platform]?.enabled ?? true; // back-compat default
  const value = !!master && !!channelEnabled;

  cache.set(key, { value, ts: Date.now() });
  return value;
}
