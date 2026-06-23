
## Audit findings (root cause)

I traced both leaked chats through `whatsapp_messages`, `whatsapp_chat_settings`, `ai_memory`, and `leads`. Roma's `ai_memory` row is fully populated — `full_name=Roma`, `email=Romakeswani92@gmail.com`, `fitness_goal=weight_loss`, `plan_interest=Annual`, `consent.wants_human=true` — but **no `leads` row exists, no callback task exists, no `founder_handoff_task_id` is set**. Same shape for Dinesh. The bot still said *"I've shared your details with our Founding Team."* Three independent bugs combined to lose them:

1. **Funnel completes in memory but never writes to `leads`.** The deterministic onboarding short-circuit in `_shared/ai-agent-brain.ts` (lines 939–1062) returns the next prompt for each missing field. Once name+email+goal+plan_interest are all in `ai_memory`, the final branch (line 1050) sends *"Want our team to lock in your Founding spot?"* and returns. The actual `tryParseAndCaptureLead()` path (line 2104) is only reached when the LLM emits a `{"status":"lead_captured"…}` JSON envelope, which the short-circuit never produces. Result: the CRM never gets a lead.

2. **Callback consent regex misses "Yes sure".** `CALLBACK_YES_RE` in `_shared/handoff.ts` accepts `yeah sure` and `sure` alone but not `yes sure`, `yes please`, `ya sure`, `haan sure`, etc. Roma's exact reply *"Yes sure"* failed the test, so `requestFounderHandoff()` never ran. Even if it had, `leadId` would have been `null` because of bug #1.

3. **No hallucination guard on "I've notified our team" copy.** When neither the handoff nor a real task fires, the LLM still happily produces *"I've shared your details with our Founding Team."* There is no sanitizer that strips that phrasing when no `tasks` row was just created.

## What to build

### 1. `_shared/leadCapture.ts` — `ensureLeadFromMemory()` (new helper)
Single source of truth that turns `ai_memory` into a real `leads` row. Idempotent.

- Inputs: `supabase`, `branchId`, `senderId`, `platform`, `memory`, `contactName`.
- Guards: skip if sender is an active member; skip if a `leads` row already exists for any phone variant; require `profile.email` valid AND at least one of (`facts.fitness_goal`, `facts.plan_interest`, `consent.wants_human=true`).
- Writes: `leads` row (`source=<platform>_ai`, `status='contacted'`, `temperature='warm'`, `score=50`, mapped `full_name/email/fitness_goal/plan_interest/notes`), stamps `whatsapp_chat_settings.captured_lead_id`, inserts a `lead_activities` `whatsapp_funnel_completed` entry, and fires `notify-lead-created`.
- Returns `{ leadId, created }` so the caller can use it for handoff.

### 2. `_shared/ai-agent-brain.ts` — wire `ensureLeadFromMemory` into the funnel
- Call it once immediately AFTER the 5c auto-learn pass (before any deterministic short-circuit returns) so any reply that just supplied the last missing field is captured first.
- Call it again at the top of the 6b callback-consent block so handoff always has a real `leadId`.
- Replace the line 1050 "Want our team to lock in…" early-return with a path that ALSO ensures a lead exists, so a deterministic close doesn't bypass capture.
- Bump version to v4.9.0 with header comment.

### 3. `_shared/handoff.ts` — widen `CALLBACK_YES_RE` + add guard helper
- New regex covers: `yes`, `yes sure`, `yes please`, `yes please call`, `yes do it`, `ya/ya sure`, `yeah`, `yeah sure`, `yep`, `yup`, `sure`, `sure thing`, `okay`, `ok please`, `please call`, `go ahead`, `do it`, `haan/haan ji/haan sure`, `ji haan`, `theek hai`, `sounds good`, `absolutely`, `definitely`, common emoji (`🙏 👍 ✅`). Anchored, case-insensitive, trailing punctuation allowed.
- Export `assertCallbackPromiseAllowed(reply, handoffOk)` — returns sanitized reply: if `handoffOk=false` and the reply contains "notified|shared your details|team will reach out|our founders will call|locked in", swap it with the safe offer line and log a `error_logs` row (`source='ai_agent_brain', severity='warning', message='hallucinated_callback_stripped'`).

### 4. Brain — apply the hallucination guard
After every LLM-generated reply path (the non-deterministic branches that fall through to `callAI`), pipe `replyText` through `assertCallbackPromiseAllowed(replyText, handoffJustTriggered)` before returning. Existing deterministic copy is exempt because it only runs when a real task was created.

### 5. Safety-net cron: extend `monitor-ai-lead-loss`
Add a second pass each tick:
- `SELECT contact_key, branch_id, platform, profile, facts FROM ai_memory WHERE profile->>'email' ~ '^[^@]+@[^@]+\\.[^@]+$' AND (facts ? 'plan_interest' OR facts ? 'fitness_goal') AND last_seen_at > now() - interval '24h'`
- For each row with no matching `leads.phone` variant, call `ensureLeadFromMemory` and `requestFounderHandoff` with `reason='auto_recovered_funnel'`.
- Report count in the existing JSON output (`recovered_from_memory`).

### 6. Backfill Roma + Dinesh (migration)
- Insert `leads` rows for `+919414646641` (Roma Keswani) and Dinesh's phone (look up from `whatsapp_chat_settings.phone_number` matching contact_name='Dinesh' in last 24h) using their `ai_memory` data: status=`qualified`, source=`whatsapp_ai`, fitness_goal/plan_interest filled.
- Stamp `whatsapp_chat_settings.captured_lead_id` and `founder_handoff_task_id` on both rows.
- Create 2 `tasks` rows (`title='Founding Member callback — <name>'`, `priority=high`, due in 2h, `linked_entity_type='lead'`).
- Insert `lead_activities` `callback_requested` entries.
- Fire `notify-lead-created` for each so the founder team sees them now.

### 7. Verify
- Replay Roma's last user message via `supabase--curl_edge_functions` on `whatsapp-webhook` and confirm: lead row created, task row created, `founder_handoff_task_id` stamped, reply text matches the deterministic "Locked in…" copy (not the hallucinated one).
- SQL spot-check: `SELECT COUNT(*) FROM ai_memory m WHERE profile->>'email' ~ '@' AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.phone = m.contact_key)` — should drop to ~0 after the cron pass.

## Files touched

- `supabase/functions/_shared/leadCapture.ts` *(new)*
- `supabase/functions/_shared/handoff.ts` *(regex + new guard)*
- `supabase/functions/_shared/ai-agent-brain.ts` *(v4.9.0 — wire capture + guard)*
- `supabase/functions/monitor-ai-lead-loss/index.ts` *(memory-orphan sweep)*
- `supabase/functions/whatsapp-webhook/index.ts`, `meta-webhook/index.ts` *(redeploy only — share `_shared` module)*
- New migration: backfill Roma + Dinesh + tasks + activities

## Out of scope (this round)

- RCS, Meta template work, Instagram signature mismatch (separate issue in logs).
- Restructuring the onboarding question order or copy — the SSOT in `ai_knowledge` stays as-is.
- Public site / SEO / `ai.txt` changes.
