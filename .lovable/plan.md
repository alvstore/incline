# Deep Audit — Channel Respect, IG Identity Display & Brain Recall

## Findings

### 1. Per-channel toggle respect — incomplete
The brain (`_shared/ai-agent-brain.ts`) honors `ops_config.channels[platform].enabled` (added last turn). BUT three other outbound paths still send WITHOUT consulting that toggle:

| Path | File | Risk |
|---|---|---|
| Inbound webhook enqueue | `meta-webhook` → `triggerAiReply` (line 1130+) | Enqueues + claims AI lock + invokes brain even when channel is OFF. Brain then skips, but the row, claim, and edge-fn cold start are wasted. Worse, `whatsapp-webhook` enqueues to `whatsapp_messages` first too. |
| Lead nurture follow-ups | `lead-nurture-followup` | Cron sends AI-drafted DMs on whatever platform the lead came in on. No channel gate. |
| Comm retry queue | `process-comm-retry-queue` | Re-tries previously failed AI/system DMs without re-checking the channel toggle (a flip-OFF doesn't stop in-flight retries). |
| IG comment→DM cron | `process-ig-comment-runs` | Sends DMs gated only by `instagram_auto_reply_comments`, NOT by `channels.instagram.enabled`. |

**Fix:** Add a shared helper `isAiChannelEnabled(supabase, branchId, platform)` in `_shared/ai-agent-brain.ts` that reads `ai_purposes(purpose='whatsapp_reply').ops_config.channels[platform].enabled && auto_reply_enabled`. Call it as an early-exit guard in:
- `meta-webhook/index.ts` → before `triggerAiReply` and before claiming `meta_ai_reply_claims`.
- `lead-nurture-followup/index.ts` → before drafting/sending each follow-up.
- `process-comm-retry-queue/index.ts` → skip retry rows whose `channel` resolves to a disabled platform; mark them as `cancelled_channel_off`.
- `process-ig-comment-runs/index.ts` → skip rows when Instagram channel is off (in addition to existing comment toggle).

### 2. Instagram chat shows "Unknown" + a phone number
Root cause is **double normalization**:
- DB trigger `tg_normalize_phone_number_col → normalize_phone_in` blindly prefixes `+` to any digit-only string, so Instagram-Scoped IDs (IGSIDs) land in `whatsapp_chat_settings.phone_number` and `whatsapp_messages.phone_number` as `+960836373518425`.
- UI helper `isIgsid(value) = /^\d{12,}$/.test(value)` rejects the `+`, so the chat header falls back to `<Phone>` + `formatPhoneDisplay()` and renders a fake phone number.
- The "Unknown" badge fires because `resolveIdentities()` looks up IGSIDs in `profiles.phone` (always misses).
- Worse: `upsert_meta_contact_profile` is called with raw `contactId` (no `+`), but the existing row is keyed `+<digits>` (trigger-rewritten), so the RPC's UPDATE/UPSERT silently misses → `whatsapp_chat_settings.contact_name` and `external_username` stay NULL forever even though `ai_memory.profile.contact_name` correctly holds `@fitwithrage`.

**Fix:**
1. **UI** (`src/pages/WhatsAppChat.tsx`)
   - `isIgsid`: accept optional leading `+` — `/^\+?\d{12,}$/`.
   - Replace the "Unknown" amber badge with a platform-aware badge for IG/Messenger contacts: show "Instagram" (pink) or "Messenger" (blue) badge instead, since member-by-phone resolution never applies to scoped IDs.
   - Header subtitle (line 1063+): when platform∈{instagram,messenger}, never render `<Phone> + formatPhoneDisplay`. Always render `<AtSign>@handle` if `external_username` or `contact_name` starts with `@`, else `Instagram user · last4`.
2. **RPC** — new migration that wraps `upsert_meta_contact_profile` to call `normalize_phone_in(p_phone)` before the upsert, so the row keyed by `+<digits>` is actually updated.
3. **Backfill migration** — for `whatsapp_chat_settings` rows where platform ∈ {instagram,messenger} AND (`contact_name IS NULL` OR `external_username IS NULL`), copy the most-recent non-null `whatsapp_messages.contact_name` (and parse `@handle` → `external_username`) for the same `phone_number`. Also backfill from `ai_memory.profile.contact_name` as a second fallback.

### 3. Brain "always recall knowledge & memory" — partial
Brain already loads `ai_memory` by `(branch_id, platform, contact_key)` and injects `KNOWN SO FAR` into the prompt. Two gaps:
- **Single-key lookup.** Memory key normalization mismatches (some legacy rows raw, some `+<digits>`). Add fallback: try `+<digits>` first; if no row, try the digits-only variant; merge if both exist.
- **Knowledge recall.** Brain calls `match_ai_knowledge` (semantic, threshold 0.75). When the user asks a non-fitness question (location/timings/founder), embedding miss → "no knowledge" path → AI improvises. Add a low-threshold fallback (`0.55`) for the **canonical facts** (location/launch/founder) so the brain always grounds these in `ai_knowledge` rows, never from imagination.
- **Persist contact_name into memory profile**: when memory has `contact_name` like `@fitwithrage`, the post-process step should also write it back to `whatsapp_chat_settings` so UI + memory stay synced.

## Files touched
- `supabase/migrations/<ts>_meta_contact_profile_normalize.sql` (RPC wrapper + backfill, new)
- `supabase/functions/_shared/ai-agent-brain.ts` (export `isAiChannelEnabled`, dual-key memory lookup, low-threshold knowledge fallback, write-back to chat_settings)
- `supabase/functions/meta-webhook/index.ts` (early channel guard before AI claim; normalize `p_phone` arg)
- `supabase/functions/lead-nurture-followup/index.ts` (channel guard)
- `supabase/functions/process-comm-retry-queue/index.ts` (channel guard + cancel-disabled)
- `supabase/functions/process-ig-comment-runs/index.ts` (channel guard)
- `src/pages/WhatsAppChat.tsx` (isIgsid regex, IG/Messenger header subtitle, platform badge replacing "Unknown")

## Verification
- Toggle Instagram OFF → send IG DM → expect no outbound message AND no `meta_ai_reply_claims` row; `ai_call_logs` entry with `skipped: channel_instagram_disabled`.
- Toggle WhatsApp OFF → IG still replies normally.
- Re-open @fitwithrage chat → header shows "@fitwithrage" + "Instagram" badge, no "+960…", no "Unknown" badge.
- Run backfill → all existing IG/Messenger rows populated with handle.
- Ask "where are you located?" on a fresh IG thread → brain pulls Udaipur Sector 14 fact from `ai_knowledge` via low-threshold fallback (not hallucination).

## Out of scope
- Rewriting the DB phone-normalization trigger (would require a column rename to `external_id` everywhere). Mitigation = make UI + RPC + helpers IGSID-aware.
- Per-conversation toggle (already exists via `bot_active`).
