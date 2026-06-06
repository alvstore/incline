## Root causes (confirmed by audit)

### Bug A — AI keeps re-asking "What's your name?" (and re-greeting)

- `whatsapp_messages.phone_number` and `whatsapp_chat_settings.phone_number` are auto-normalized by a Postgres trigger (`normalize_phone_in`) to E.164 format: **`+1380828610766741`**.
- `meta-webhook/index.ts` reads the raw Instagram/Messenger scoped sender ID (`event.sender.id` = `1380828610766741`, no `+`) and passes it straight through as `senderId` to `runUnifiedAgent`.
- Inside `ai-agent-brain.ts` every history / state lookup runs `.eq("phone_number", ctx.senderId)`:
  - line 275 — recent messages for the auto-learn extractor
  - line 304 — full conversation history fed to the model
  - meta-webhook line 1069 — chat_settings state gate
  - meta-webhook line 1147 — outbound 3-minute dedupe

  All of these return **zero rows** because the stored key is `+1380828610766741` and we query for `1380828610766741`.

- Net effect: the model gets an empty `history`, so every inbound looks like the very first turn → it always emits the "Turn 1" greeting + "What's your name?", even though `ai_memory.profile.first_name = "Karanveer"` was correctly captured.

Verified directly in the database:

```
ai_memory.contact_key       = '1380828610766741'  (no +)
whatsapp_chat_settings.phone_number = '+1380828610766741'
whatsapp_messages.phone_number      = '+1380828610766741'
```

### Bug B — Outbound IG/Messenger messages stuck on the clock icon (pending)

- Meta-webhook inserts the outbound bubble with `status = 'pending'` and then `fetch()`-es `send-meta-dm`. If `send-meta-dm` errors, times out, or its row update is blocked (e.g. the new send-lock returns `false`, or Meta returns an error and the row update path runs before lock release), the row stays at `pending` forever — that's the clock icon in the screenshot.
- We have a stuck row right now: `59a8aa95-f742-4ab8-9272-f8bf594f4721`, IG outbound, content "Hi there! What's your name?", `status = pending` since 08:00:55 UTC.
- There is no self-heal: nothing flips long-pending Meta outbounds to `failed`, and nothing retries them, so they look "invisible / never delivered" in the inbox UI.

### Bug C — Brain doesn't respect existing memory even when loaded

Even after Bug A is fixed, the lead-capture prompt is purely turn-numbered. If `memory.profile.first_name` is already set, the prompt must explicitly **skip the name ask** and jump to email (and similarly skip email/goal/plan_interest if those are already in memory). Today it relies entirely on history to figure out which turn it's on.

---

## Fixes

### 1. Normalize the Meta sender ID once at the webhook boundary

In `supabase/functions/meta-webhook/index.ts`:

- Add a small helper `toPhoneKey(raw)` that returns `+` + raw digits when the raw value is a numeric Meta scoped ID, matching what `normalize_phone_in` produces. (For non-numeric IG handles we fall back to the raw value, but every IG/Messenger scoped ID is numeric.)
- Compute `const phoneKey = toPhoneKey(contactId)` once, then use `phoneKey` for **every** DB query and insert: ingest insert (`whatsapp_messages`, `whatsapp_chat_settings`, `is_unread`), echo dedupe, AI pre-reply state gate, `claim_meta_ai_reply` RPC, outbound dedupe, the outbound `whatsapp_messages` insert, and the `send-whatsapp` payload's `phone_number`.
- Keep passing the **raw** `contactId` only to `send-meta-dm` as `recipient_id` — Meta's Graph API needs the raw scoped ID, not the `+`-prefixed phone key.
- Pass `phoneKey` (not raw) into `runUnifiedAgent` as `senderId`, so every `.eq("phone_number", ctx.senderId)` inside `ai-agent-brain.ts` lines up with stored data automatically.

### 2. Normalize `ai_memory.contact_key` + backfill

- In `_shared/ai-memory.ts` (`loadMemory` / `upsertMemory`), apply the same `toPhoneKey` for IG/Messenger contact keys so memory keys match `whatsapp_messages.phone_number` going forward.
- One-time SQL backfill in a migration:
  ```sql
  UPDATE public.ai_memory
     SET contact_key = '+' || contact_key
   WHERE platform IN ('instagram','messenger')
     AND contact_key ~ '^[0-9]+$';
  ```

### 3. Make the brain respect known profile fields

In `ai-agent-brain.ts` lead-capture block (around lines 414–460):

- After loading `memory`, compute booleans: `hasName`, `hasEmail`, `hasGoal`, `hasPlanInterest` from `memory.profile` / `memory.facts`.
- Inject explicit hard rules into the prompt:
  - "Known so far — name: {value or '—'}, email: {value or '—'}, goal: {value or '—'}, plan_interest: {value or '—'}. NEVER ask for any field already filled. Always advance to the next missing field in the order name → email → goal → plan_interest."
- Server-side safety net: after the model produces `replyText`, if `hasName` is true AND the reply text matches `/(what.?s|may i know).{0,15}your\s+(good\s+)?name/i`, replace it with the next-step message (acknowledge by name, ask for email) so a bad model response can never leak out the same question again.

### 4. Self-heal stuck Meta outbounds (Bug B)

- Add a post-send watcher in `meta-webhook/index.ts`: when the `fetch('send-meta-dm')` resolves non-OK or throws, immediately `UPDATE whatsapp_messages SET status='failed', error_message=...` for the row we just inserted. Today only some branches do this.
- Add a small reconciliation cron (re-use `process-whatsapp-retry-queue` or extend it): every 2 minutes, find IG/Messenger outbound rows where `status='pending'` AND `created_at < now() - interval '2 min'`. Re-invoke `send-meta-dm` once; on second failure, flip to `failed` with reason so the inbox shows a clear "failed" state instead of an indefinite clock.
- One-time SQL repair in the same migration:
  ```sql
  UPDATE public.whatsapp_messages
     SET status = 'failed',
         error_message = COALESCE(error_message, 'stuck_pending_meta_outbound_autofix')
   WHERE platform IN ('instagram','messenger')
     AND direction = 'outbound'
     AND status = 'pending'
     AND created_at < now() - interval '10 min';
  ```

### 5. Verification

After deploy, send a fresh IG DM from a test account and confirm:
- First reply asks for name (Turn 1).
- Sending the name produces a Turn 2 reply that **thanks the user by name and asks for email** (not "What's your name?" again).
- `ai_memory.contact_key` for the test contact starts with `+`.
- `whatsapp_messages` rows reach `status='sent'` (single tick) within seconds; no rows remain in `pending` longer than 2 minutes.

## Files to change

- `supabase/functions/meta-webhook/index.ts` — sender-ID normalization, all `.eq("phone_number", …)` call sites, error-path status update.
- `supabase/functions/_shared/ai-memory.ts` — normalize `contact_key` for IG/Messenger.
- `supabase/functions/_shared/ai-agent-brain.ts` — known-fields hard rule + post-process guard against repeating "What's your name?".
- `supabase/functions/process-whatsapp-retry-queue/index.ts` (or a new tiny `reconcile-meta-outbound`) — pending-outbound watchdog.
- New migration: backfill `ai_memory.contact_key` and mark the historical stuck IG/Messenger pending rows as failed.

## Out of scope

- Visual chat UI for the "pending → sent" tick animation (already present).
- Other channels (WhatsApp Cloud already uses normalized phone numbers everywhere — this fix is Meta-DM-specific).
