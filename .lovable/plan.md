## Audit findings

The screenshots match live backend data:

- `@shweta_mulani` sent a clear PR/collaboration inquiry.
- The AI sent the correct non-membership redirect twice, then incorrectly asked for name twice, then scheduled lead-nurture follow-ups later.
- The system did create AI memory with `current_intent = non_fitness`, but the active chat row still has `bot_active = true`, `do_not_contact = false`, and nurture retries enabled.

Root causes found:

1. **Instagram contact key mismatch**
   - `whatsapp_messages` and `whatsapp_chat_settings` normalize Instagram IDs like phone numbers and add `+`.
   - `ai_memory` stores the same Instagram contact without `+`.
   - Result: the brain can write “non_fitness” memory but later reads a different contact key and misses its own memory.

2. **Lead nurture does not read AI memory or non-fitness intent**
   - `lead-nurture-followup` only checks `bot_active` / `do_not_contact` in `whatsapp_chat_settings`.
   - It does not suppress rows where `ai_memory.current_intent = non_fitness` or `handoff_reason = non_fitness_inquiry`.
   - Result: PR/media/vendor contacts can still receive “early access / Founding Member” follow-ups.

3. **Instagram sender idempotency is incomplete**
   - `meta-webhook` has a claim RPC and echo merge logic.
   - But `send-meta-dm` marks messages as sent without saving the provider message ID into `platform_message_id`.
   - Result: Meta echo events can still appear as a second visible outbound bubble, and send-time duplicate suppression is weaker than WhatsApp.

4. **Non-fitness guard is not a hard global stop yet**
   - The AI prompt says PR/media/vendor inquiries must stop, but the cron and contact settings are still allowed to continue if any update misses the normalized chat row.
   - This needs deterministic backend suppression, not just prompt instructions.

## Fix plan

1. **Normalize Instagram memory keys consistently**
   - Add a shared helper for Meta contact keys used by `ai-memory` and `ai-agent-brain`.
   - For Instagram/Messenger IDs, use the same canonical key as chat/messages (`+<digits>` when the database normalizer will store it that way).
   - Load memory with both legacy and canonical keys during transition, then write only the canonical key.

2. **Make non-fitness intent a hard suppression state**
   - In `runUnifiedAgent`, when PR/media/vendor/collaboration is detected:
     - update `whatsapp_chat_settings` with `bot_active=false`, `do_not_contact=true`, `handoff_reason='non_fitness_inquiry'`, and clear lead-nurture eligibility;
     - write AI memory with `current_intent='non_fitness'` on the canonical key;
     - avoid any lead-capture partial data for that contact.
   - Add a pre-reply guard: if memory or chat settings already says non-fitness/DNC/bot paused, do not call the model and do not ask name/email/fitness questions.

3. **Block nurture follow-ups for non-membership contacts**
   - Update `lead-nurture-followup` to skip any chat where:
     - `bot_active=false`, `do_not_contact=true`, or `handoff_reason='non_fitness_inquiry'`;
     - AI memory for the contact has `current_intent='non_fitness'`;
     - last outbound was the non-membership redirect;
     - partial lead data only contains `contact_name` and no real membership intent.
   - Replace the time-based dedupe key `lead_nurture:${chat.id}:${Date.now()}` with a stable key per chat/retry window so retries cannot duplicate.

4. **Add Instagram send-time lock and provider ID persistence**
   - Update `send-meta-dm` to save Meta’s returned message ID into `whatsapp_messages.platform_message_id`.
   - Add/use a platform-aware send lock for Instagram/Messenger similar to WhatsApp, keyed by `platform + branch + recipient`.
   - If lock is held, mark the local duplicate as suppressed instead of sending.

5. **Harden Meta webhook duplicate handling**
   - Ensure the AI reply claim uses the canonical contact key and fails closed for duplicate-prone errors.
   - Keep attachment-only messages from triggering onboarding.
   - Before inserting any AI outbound row, check for the same outbound content to the same contact in the last few minutes and suppress it.

6. **Repair existing bad state for affected contacts**
   - One-time data cleanup for current Instagram PR/non-membership contacts, including `@shweta_mulani`:
     - set `bot_active=false`, `do_not_contact=true`, `handoff_reason='non_fitness_inquiry'`;
     - align legacy `ai_memory` rows to the canonical contact key;
     - stop further nurture retries.

7. **Validate after implementation**
   - Query `@shweta_mulani` rows to confirm no active nurture path remains.
   - Test simulated duplicate Instagram inbound events and verify only one outbound row/send is produced.
   - Test a PR/collaboration message and verify only the redirect is sent once, with no future nurture follow-up.
   - Deploy the changed edge functions.