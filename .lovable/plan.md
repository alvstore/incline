# Per-Channel AI Reply Toggles — Audit & Plan

## Problem
Today the AI brain has ONE master switch: `ai_purposes.ops_config.auto_reply_enabled` (purpose `whatsapp_reply`). That single boolean gates the AI brain for **all** inbound DMs — WhatsApp, Instagram, and Facebook Messenger — because `meta-webhook` and `whatsapp-webhook` both call the same `runAiAgentBrain()` (see `supabase/functions/_shared/ai-agent-brain.ts:145`).

There is no UI/way to say "keep AI on for WhatsApp, off for Instagram" (or vice versa). The only per-channel control today is `instagram_auto_reply_comments` (comments → DM), not DM replies themselves.

## Solution
Introduce a `channels` map in `ops_config` and gate the brain by `ctx.platform`:

```jsonc
ops_config: {
  auto_reply_enabled: true,          // kept as global kill-switch (back-compat)
  channels: {
    whatsapp:  { enabled: true },
    instagram: { enabled: true },
    messenger: { enabled: true }
  },
  reply_delay_seconds: 3,
  instagram_auto_reply_comments: false,
  instagram_story_reply_enabled: false
}
```

Effective AI-on = `auto_reply_enabled && channels[platform].enabled`. Missing channel entry defaults to `true` (back-compat with current behavior).

## Changes

### 1. Data (migration)
- Backfill `ai_purposes` row `purpose='whatsapp_reply'` to add `channels: { whatsapp:{enabled:true}, instagram:{enabled:true}, messenger:{enabled:true} }` derived from current `auto_reply_enabled`.
- No schema change — `ops_config` is already JSONB.

### 2. Brain (`supabase/functions/_shared/ai-agent-brain.ts`)
- Extend `OrgAiConfig` type: `channels?: Record<'whatsapp'|'instagram'|'messenger', {enabled:boolean}>`.
- In `loadOrgAiConfig`, parse `ops.channels` and pass through.
- New gate after the existing `auto_reply_enabled` check (~line 145):
  ```ts
  const channelOn = aiConfig.channels?.[ctx.platform]?.enabled ?? true;
  if (!channelOn) return skip(`channel_${ctx.platform}_disabled`);
  ```
- Bump file version comment.

### 3. Meta webhook (`supabase/functions/meta-webhook/index.ts`)
- No logic change needed (brain handles gating), but add an early-exit fast path that reads the same channel flag before claiming the AI lock to avoid noisy `meta_ai_reply_claims` rows when the channel is off.

### 4. UI (`src/components/settings/ai/HandleOpsSettings.tsx` + parent `AIAgentControlCenter.tsx`)
- Replace the single "Auto-reply enabled" switch with a grouped section:
  - **Master AI auto-reply** (existing `auto_reply_enabled`) — kill-switch label updated to "Master AI auto-reply (all channels)".
  - **Per-channel** switches (only shown when master is on):
    - WhatsApp DM AI replies → `channels.whatsapp.enabled`
    - Instagram DM AI replies → `channels.instagram.enabled`
    - Messenger DM AI replies → `channels.messenger.enabled`
- Each switch reads/writes the nested path in `ops_config` via the existing save handler (extend it to support dotted/nested keys, or convert the row schema to include explicit nested fields).
- Vuexy styling: rounded-2xl card, lucide icons (`MessageCircle`, `Instagram`, `Facebook`), colored badges for current state (Active/Paused).

### 5. Lead-nurture & retry paths
- `lead-nurture-followup/index.ts` and `process-comm-retry-queue/index.ts` already respect `do_not_contact` and `bot_active`. Add a helper `isChannelAiEnabled(platform, branchId)` and short-circuit there too so scheduled outbound AI follow-ups also honor the per-channel switch.

### 6. Tests / verification
- Manually flip Instagram off in UI → send IG DM → expect `skipped: channel_instagram_disabled` in `ai_call_logs` and zero outbound message.
- Send WhatsApp DM in parallel → expect normal AI reply.
- Flip master off → both channels skip with `auto_reply_disabled`.

## Out of scope
- Per-conversation toggle (already covered by `whatsapp_chat_settings.bot_active`).
- Branch-level overrides (current row is global `branch_id IS NULL`; can be added later by inserting branch-specific rows — already supported by `loadAiPurpose`).
- Splitting comments vs story vs DM for Instagram further (already separate flags).

## Files touched
- `supabase/migrations/<ts>_ai_channel_toggles.sql` (new)
- `supabase/functions/_shared/ai-agent-brain.ts`
- `supabase/functions/meta-webhook/index.ts`
- `supabase/functions/lead-nurture-followup/index.ts`
- `supabase/functions/process-comm-retry-queue/index.ts`
- `src/components/settings/ai/HandleOpsSettings.tsx`
- `src/components/settings/AIAgentControlCenter.tsx` (if schema list lives there)
