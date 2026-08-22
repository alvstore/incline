# AI Brain: stop the short-circuit, rebuild the knowledge layer

## What actually happened (verified in the live data)

The chat you pasted was never answered by the AI brain at all.

1. The master kill-switch is OFF. `ai_purposes(purpose='whatsapp_reply').ops_config.auto_reply_enabled = false`, even though `channels.whatsapp.enabled = true`. Every inbound message hits the brain and exits immediately — the error log at 21:09 says exactly that: `AI reply skipped (auto_reply_disabled)`.
2. A watchdog then filled the silence with a canned line. `monitor-ai-lead-loss` runs every 5 minutes, sees an inbound with no reply within its 5-minute SLA, and sends a *deterministic, non-LLM* ladder reply. Its first rung is literally `"Sure — may I have your name first? ✨"`.
3. Because the watchdog never writes the captured name into `ai_memory`, the ladder restarts at rung one on every cycle. Result: 21:15, 21:25, 21:35 — the same sentence three times, roughly six minutes after each of Priyanshu's messages. That six-minute lag is the fingerprint of the cron, not of a live bot.

So the brain rewrite from the last sprint is fine; the deadlock came back through the recovery cron plus a switch that is off.

## Fixes

### 1. Turn the brain back on and make the state visible
- Set `auto_reply_enabled = true` for `whatsapp_reply`.
- In Settings → AI Agent, show a live status banner ("AI auto-reply is OFF — inbound DMs will not be answered") whenever the master switch or the WhatsApp channel toggle is off, so this can never be silently off again.

### 2. Defang the watchdog
`monitor-ai-lead-loss` becomes alert-only again for lead threads:
- Remove the deterministic name/email/goal/plan ladder entirely (this is the last copy of the canned line in the codebase).
- On a stuck thread it will instead (a) log a warning to System Health, (b) create a front-desk task, and (c) at most once per contact per 24h send a single neutral human line ("Thanks for reaching out — someone from Incline will reply shortly"), guarded by a dedupe key.
- Never repeat the same recovery text to the same contact twice.

### 3. Same guarantee at the send layer
Add a shared outbound guard: if the exact same body text was already sent to the same contact in the last 24 hours, suppress the send and log it. This makes triple-identical messages structurally impossible regardless of which cron produced them.

## Knowledge base + AI Training Rules rebuild

Today there are 24 `ai_knowledge` rows and 57 `ai_dynamic_memory` rules — the latter is mostly regex patch-work that fights the model instead of teaching it.

Rebuild rather than blind-delete:
- Archive both tables (soft-archive columns, not `DROP`), so nothing is lost and rollback is one statement.
- Author a fresh, structured knowledge set of ~15-20 canonical entries grouped by topic: identity & brand, location & hours, facilities & recovery tech, memberships (pricing-blackout wording), PT & classes, member self-service, policies, objection handling, escalation. Each entry gets a clear title, a factual body written for retrieval, and tags; embeddings regenerate automatically via the existing `embed-knowledge` trigger.
- Reduce AI Training Rules to a short, curated set: only true corrections (name-blocklist phrases, Maps/Instagram link enforcement, pricing blackout, opening-date embargo). Everything descriptive moves into knowledge, not regex.
- Rebuild the Knowledge admin UI as a Vuexy-style workspace: category grid, coverage meter (which topics have no entry), inline test-ask box that runs a real retrieval against the entry set, and drawer-based editing per the project's no-dialog rule.

## Daily Owner Report (HTTP 424)

The report is generating fine — it fails only on delivery accounting. `daily-ops-summary` treats any delivery status outside its allow-list as a failure, and email dispatches return `sending` (an in-flight state) which is not in that list. Add the in-flight statuses to the allow-list, and re-check the run's actual per-channel outcomes before declaring the rule healthy.

## Technical notes

- Files: `supabase/functions/monitor-ai-lead-loss/index.ts` (ladder removal), `supabase/functions/_shared/ai-agent-brain.ts` (drop `buildNoReplyFallback`'s canned rungs — silence-then-handoff instead), `_shared/dispatch` guard for duplicate bodies, `supabase/functions/daily-ops-summary/index.ts`, `src/components/settings/ai/*` (status banner + knowledge workspace), one migration for archiving + reseeding `ai_knowledge` / `ai_dynamic_memory`.
- No new tables. Redeploy: `whatsapp-webhook`, `meta-webhook`, `monitor-ai-lead-loss`, `lead-nurture-followup`, `embed-knowledge`, `daily-ops-summary`.
- Verification: replay Priyanshu's three-message thread against the brain in a test harness and assert three distinct, on-brand replies with the name persisted after turn two.
