
## Audit Finding — why Vicky's "Yeah sure" was lost

I traced the WhatsApp thread for **+91 97723 99207 (Vicky Gidwani)** through the database and the brain code. Three independent bugs combined to lose this hot lead:

### Bug 1 — "I've notified our team" is a **hallucinated reply** (CRITICAL)
- The lead exists (`leads.id = 20919e10…`, source `website`, status `new`) and is correctly linked to the chat (`whatsapp_chat_settings.captured_lead_id`).
- The column `whatsapp_chat_settings.founder_handoff_task_id` exists for exactly this purpose, but a repo-wide search shows **zero code anywhere** writes to it.
- There is no tool, no RPC, no edge-fn path that creates a callback Task, sends a staff notification, or sets `handoff_requested_at` when the user agrees to a call.
- The line "Got it, Vicky! I've notified our Founding Member team…" came **purely from the LLM** with no side effect. The founder team was never notified.

### Bug 2 — `fitness_goal` and `plan_interest` never persisted on the lead row
- During the chat, Vicky picked `Flexibility / General` and `Annual — Founding Member` via interactive lists.
- `leads.fitness_goal` and `leads.plan_interest` are still `NULL`. The data only lives inside `ai_memory.facts` (transient brain memory).
- The brain has a `factsPatch` → `leads.update` path (around line 685 in `ai-agent-brain.ts`) but it only fires on first capture, not on subsequent interactive_list selections after the lead already exists.
- Result: CRM and segments treat Vicky as a "new website lead with no goal/plan" — she does not appear on any Founding-Member follow-up segment.

### Bug 3 — Status stays `new`, no activity logged
- `leads.status` is still `new` (never advanced to `contacted` / `interested` / `hot`).
- No row in `lead_activities` for this WhatsApp conversation.
- Nurture cron also will not act because there is no "callback requested" intent recorded anywhere.

---

## Fix Plan

### A. Add a real callback / human-handoff tool in the brain (the core fix)

In `supabase/functions/_shared/ai-agent-brain.ts`:

1. Add an intent detector `WANT_CALLBACK_RE` (matches "yes / yeah / sure / haan / call me / call kar lo / okay please" **immediately after** an outbound message that contained a callback offer — track via `lastBotIntent` already on the turn context).
2. When detected, call a new server action `requestFounderHandoff({ chatSettingId, leadId, branchId, reason, summary })` that atomically:
   - Inserts a `tasks` row: title `"Founding Member callback — {name}"`, category `lead_callback`, priority `high`, due in 2 working hours, assignee = configured founder/manager.
   - Updates `whatsapp_chat_settings`: `founder_handoff_task_id`, `handoff_requested_at = now()`, `handoff_reason = 'founding_member_callback'`.
   - Updates `leads`: `status = 'interested'`, appends a `lead_activities` row of type `callback_requested`.
   - Calls `dispatchCommunication` with event `lead_callback_requested` (in-app + optional WhatsApp/email to assignee) — honors integration on/off toggles automatically.
3. Replace the LLM "I've notified our team" copy with a **deterministic** confirmation rendered **only after** the tool succeeds (e.g. "Locked in, Vicky ✨ A founder will call you within 2 hours on +91 977…"). If the tool fails, the bot says "Let me try again in a moment" and logs to `error_logs` via `log_error_event` — never silently promises.

### B. Persist interactive_list answers on the lead row immediately

In the same file, in the existing interactive_list handler (around lines 1306–1346):
- After updating `ai_memory.facts`, if `leadCtx?.leadId` exists, **upsert the new field directly** onto `leads` (`fitness_goal`, `plan_interest`) using a small `syncLeadFacts(leadId, patch)` helper.
- Also bump `leads.status` from `new` → `contacted` on the first user-driven reply, and to `interested` once both goal + plan_interest are known.
- Insert a `lead_activities` row (`type = 'whatsapp_reply'`, `meta = {field, value}`) so the CRM timeline shows what Vicky chose.

### C. Add a guardrail against future hallucinated "I've notified…" copy

In the brain's outbound sanitizer (same file, near `INTENT_INSTRUCTION_PREFIX_RE` from v4.7.0):
- Add `HALLUCINATED_ACTION_RE = /(notified|informed|alerted|created (a )?task|booked you|scheduled)/i`.
- If the LLM text matches AND no tool call ran on this turn, **strip the claim** and fall back to a safe copy ("Got it — sharing your interest with our team. They'll reach out shortly.") plus a `[AI:guards] stripped hallucinated action` log to `error_logs` so we can monitor.

### D. Backfill Vicky right now (data fix, not code)

Once the code ships, run a one-off via the insert tool:
- Update `leads` for `20919e10…`: `fitness_goal = 'flexibility'`, `plan_interest = 'annual'`, `status = 'interested'`.
- Insert a `tasks` row for the founder callback (high priority, due today).
- Set `whatsapp_chat_settings.handoff_requested_at` + `founder_handoff_task_id` on the chat row.

### E. Verification

1. `supabase--curl_edge_functions` replays a synthetic interactive_list reply ("Annual — Founding Member") followed by "Yeah sure" against the staging brain → assert: `tasks` row created, `whatsapp_chat_settings.founder_handoff_task_id` populated, `leads.status='interested'`, outbound message uses deterministic copy.
2. SQL spot-check that no other open chat has `captured_lead_id IS NOT NULL` with `status='new'` AND a "notified / call you" outbound in the last 48h — if any, backfill the same way.
3. Add a Deno test in `_shared` for `requestFounderHandoff` happy path + failure path (must NOT send confirmation if task insert fails).

---

## Files touched
- `supabase/functions/_shared/ai-agent-brain.ts` (intent, tool call, sanitizer, lead sync)
- `supabase/functions/_shared/handoff.ts` *(new)* — `requestFounderHandoff()` server action, reusable from `whatsapp-webhook` / `meta-webhook`
- `supabase/functions/whatsapp-webhook/index.ts` + `meta-webhook/index.ts` — redeploy (no logic change, just bumps brain version)
- New migration: backfill row for Vicky + add `lead_activities.type` value `callback_requested` if missing in the enum (check first; only add if not present)
- `.lovable/plan.md` — append v4.8.0 entry
- Optional Deno test under `supabase/functions/_shared/handoff_test.ts`

## Out of scope
- RCS / template work.
- Changing the onboarding question order.
- SEO / public-facing copy.

Used the **engineering-skills**, **senior-architect**, and **code-reviewer** skills.
