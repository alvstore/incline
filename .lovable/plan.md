# AI Guardrails: Human Collision + Tour Boundaries + Pricing Embargo

Three independent vulnerabilities, one consolidated rollout. Nothing is hardcoded in edge functions — operational rules live in `ai_knowledge` (already wired through `match_ai_knowledge` RAG) and tour hours live in a `settings` row so they're editable from the UI.

---

## 1. Human Collision — Timed "Shut-Up Switch"

Today `whatsapp_chat_settings.bot_active` is a hard on/off boolean. We need a **time-boxed** pause so the bot auto-resumes, plus auto-pause whenever a human sends a manual reply.

### Schema (migration)
- Add `bot_paused_until timestamptz null` to `public.whatsapp_chat_settings`.
- Add `bot_paused_by uuid null` (FK `auth.users`) + `bot_paused_reason text` (`manual_toggle` | `staff_reply` | `handoff`).
- Backfill: where `bot_active=false AND paused_at IS NOT NULL`, set `bot_paused_until = paused_at + 24h` so existing pauses don't become permanent.
- Helper SQL function `is_bot_paused(branch uuid, phone text) returns boolean` — checks `bot_active=false OR bot_paused_until > now() OR do_not_contact=true`. Single source of truth.

### Edge functions (no business rules, just gate)
Replace every `bot_active === false` check with `is_bot_paused(...)` RPC (or inline the same OR) in:
- `supabase/functions/_shared/ai-agent-brain.ts` (line ~180 skip("bot_paused"))
- `supabase/functions/meta-webhook/index.ts` (line ~1260)
- `supabase/functions/whatsapp-webhook/index.ts`
- `supabase/functions/lead-nurture-followup/index.ts`
- `supabase/functions/process-ig-comment-runs/index.ts`

Auto-resume is automatic — once `now() > bot_paused_until`, gate returns false.

### Auto-pause on staff manual reply
In `send-message` / `send-meta-dm` / outbound paths used by the admin inbox: when a message originates from a human staff user (not the AI brain), upsert `bot_paused_until = now() + interval '24 hours'`, `bot_paused_reason='staff_reply'`, `bot_paused_by = auth.uid()`. Skip if message metadata flags `source='ai'`.

### Admin UI — `src/pages/WhatsAppChat.tsx`
- Replace existing on/off `Switch` (line ~1226) with a **Popover** containing:
  - Pause for: `1h` · `4h` · `24h` · `Until I resume` · `Resume now`
  - Live countdown chip ("AI paused · resumes in 3h 12m") in the conversation header.
- "Needs human" filter (line 645) uses the new helper: paused OR handoff.
- Match Vuexy: `rounded-2xl`, amber badge `bg-amber-100 text-amber-700` while paused, emerald when active.

---

## 2 & 3. Tour Scheduling Rules + Pricing Embargo — via `ai_knowledge` (no hardcoding)

Both are **knowledge rows**, not edge-function code. The existing RAG (`buildSystemPrompt` → `match_ai_knowledge`, threshold 0.75, plus all `priority<=10` rules) already injects priority rules into every reply. We piggyback on that.

### A. Seed two new `ai_knowledge` rows (data insert, not migration)
- topic=`booking_rules`, title=`VIP Tour Scheduling Window`, priority=`5` (rule tier), applies_to=`['whatsapp_ai_lead_capture','meta_ai_lead_capture','all']`. Content: tours only Mon–Sat 09:00–20:00 IST; never confirm Sundays or out-of-window times; offer the nearest valid slot; never invent confirmation — must call the booking tool.
- topic=`pricing_rules`, title=`Pricing Embargo & Founder's Reservation Protocol`, priority=`4` (above format rules). Content = the user's exact embargo block (English + Hinglish examples), explicit "NEVER quote prices/fees/tiers"; on price questions pivot to Founder's Waitlist; only CTA = reserve a spot (no day pass / trial).

These two rows are `is_rule=true` style (priority ≤ 10) so `retrieveKnowledge` injects them on **every** message regardless of semantic match — exactly how the existing "Anti-parrot" and "Grounding" rules work today. Zero code change in the brain.

### B. Make tour hours editable (no redeploy to change hours)
- Add row to `public.settings` (`branch_id NULL`, `key='tour_window'`, value JSONB `{start:"09:00", end:"20:00", days:[1,2,3,4,5,6], tz:"Asia/Kolkata"}`).
- Add a small admin card under **Settings → AI Brain** to edit it; on save, also upsert the matching `ai_knowledge` row's `source_data` so the prompt always reflects current hours (renderer already dumps `source_data` as markdown bullets — verified in `ai-prompt.ts` `renderSourceDataMarkdown`).
- No edge fn logic needed — the LLM reads the rule + hours from the prompt.

### C. Strengthen existing sanitizer (defense-in-depth)
`ai-agent-brain.ts` already has a Founder's-Phase price sanitizer (v3.5.0). Extend its regex/keyword list to also strip any line that confirms a Sunday tour or a time outside the configured window (parse hours from the same `settings` row at boot). One-line cache; no per-message DB read.

---

## Files Touched

**Migration**
- `supabase/migrations/<ts>_bot_pause_until.sql` — new columns + `is_bot_paused()` + backfill.

**Data inserts (separate, after migration approved)**
- 2 rows in `ai_knowledge` (tour + pricing).
- 1 row in `settings` (`tour_window`).

**Edge functions**
- `_shared/ai-agent-brain.ts` — swap pause check, extend sanitizer.
- `meta-webhook/index.ts`, `whatsapp-webhook/index.ts`, `lead-nurture-followup/index.ts`, `process-ig-comment-runs/index.ts` — swap pause check.
- `send-message/index.ts` (+ `send-meta-dm`) — auto-pause on human send.

**Frontend**
- `src/pages/WhatsAppChat.tsx` — pause-duration popover, countdown chip, filter update.
- `src/pages/Settings.tsx` (or AI Brain section) — tour-window editor card.

## Out of Scope
- No changes to existing `ai-prompt.ts` retrieval logic (already RAG-correct).
- No changes to identity injection (v4.0.0 stays as is).
- No new edge functions.

## Verification
1. Toggle "Pause 1h" in chat UI → inbound IG/WA message within the hour returns `skip("bot_paused")` in `ai_tool_logs`; after 60min, AI replies again.
2. Staff types "hello" manually → `bot_paused_until` row written; AI silent for 24h.
3. Ask "what's the price?" → reply contains the Founder's Waitlist pivot, no ₹ amount (verify in `whatsapp_messages`).
4. Ask "can I tour Sunday 11:30 PM?" → AI declines and proposes Mon–Sat 09:00–20:00 slot.
5. Edit tour hours in Settings → next AI reply uses the new window (no redeploy).
