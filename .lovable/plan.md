# Fix: AI Brain ignores human-handoff intent + captures "No" as a name

## Root cause (audited in `ai-agent-brain.ts`)

Two deterministic bugs, both upstream of the LLM:

1. **No intent gate before the capture funnel.** Lines 588–663 short-circuit to `"May I have your name…"` → `"…email for your Founding Member invite"` → goal list → duration list, regardless of what the user actually said. "Hi is this incline udaipur?" and "Can I speak to live person?" never reach any intent classifier — the bot just walks the next step.

2. **Name guard is too loose.** Auto-learn at lines 1965–1980 accepts any 1–3 token alpha reply that passes `looksLikeRealName()` (line 95). `FAKE_NAME_TOKENS` only blocks {sample, test, user, demo, …}. So `"No"`, `"Yes"`, `"Ok"`, `"Stop"`, `"Hi"`, `"haan"`, `"nahi"` all pass and are stored as `first_name`. That's why the bot then said *"Thanks, No — what's the best email…"*.

The user request "AI should understand human questions and use our context" maps cleanly to: detect human-handoff/decline intent first, and never write garbage into the lead profile.

## Changes

### 1. New intent gate at the top of the capture flow
File: `supabase/functions/_shared/ai-agent-brain.ts`

Insert a deterministic intent classifier BEFORE the Step 1–4 funnel (current line 588). Patterns (case-insensitive, English + Hinglish + Hindi):

- **Human handoff:** `live (person|agent|human)`, `real (person|human)`, `speak (to|with) (a )?(person|human|someone|staff|manager|team)`, `talk to (a )?(person|human|someone)`, `call me`, `connect me`, `insaan se baat`, `kisi se baat`, `manager`.
- **Decline / not-interested:** `not interested`, `don't contact`, `stop`, `unsubscribe`, `leave me alone`, `mat karo`.

When matched:
- Skip the name/email/goal/plan ask entirely.
- Set `whatsapp_chat_settings.bot_paused_until = now() + 24h` and `bot_active = false`.
- Persist `ai_memory.facts.consent.wants_human = true` so the brain remembers across turns (self-learning).
- Invoke existing `notify-staff-handoff` edge function (fire-and-forget) with `{ reason: "user_requested_human", platform, sender_id, last_message }`.
- Return a single short reply: *"Got it — a teammate from Incline will reach out shortly. 🙏"*  (decline variant: *"Understood — we won't message further. Reply START anytime to resume."*)
- Mark result `handoffTriggered: true`.

### 2. Harden name capture (two layers)

In `ai-agent-brain.ts`:

- **Extend `FAKE_NAME_TOKENS`** (line 90) with negative/affirmative/greeting/control words:
  `yes, no, nope, yep, yeah, ok, okay, sure, maybe, hi, hello, hey, thanks, thank, why, what, who, when, where, how, can, cant, dont, please, stop, wait, cancel, sorry, haan, nahi, nahin, theek, accha, bilkul, kya, kaun, kaise`.
  These are also rejected after lowercasing+stripping punctuation, so "No.", "No!", "no " all fail.

- **Auto-learn name guard (line 1965 block):** after `looksLikeRealName` passes, additionally reject single-token replies that match the handoff/decline regex from step 1. Also require the prior bot turn to have been the name prompt (already gated) AND the user message word-count ≤ 3 AND no `?` (questions like "Can?" aren't names).

- **LLM-enrichment merge (line 2051):** when the LLM returns `delta.profile.first_name`, run it through the same `looksLikeRealName` + new blocklist before writing.

### 3. Self-learning memory write

Whenever the new intent gate fires, write to `ai_memory` so the next inbound from the same sender:
- Does not re-trigger the funnel.
- Causes the brain to reply with the human-handoff acknowledgement until a staff member manually un-pauses (existing `bot_active` toggle in chat UI).

### 4. (No new tables, no edge fn added)
`notify-staff-handoff` already exists and already posts to staff routing. We're only adding one call site.

## Out of scope
- No prompt/persona text changes in `ai_knowledge` (the persona already says "transfer when asked"; the bug is that the deterministic short-circuit runs before the persona ever speaks).
- No UI changes — the existing WhatsAppChat header already shows the bot-paused badge from `bot_paused_until`.
- IG/Messenger reuses the same brain, so the fix applies to all three channels automatically.

## Verification
1. Replay the failing thread (Ashutosh, +91 77278 13691):
   - "Can I speak to live person?" → expect handoff reply, `bot_paused_until` set, staff notified, no name prompt.
   - "No" after a name prompt → expect re-prompt, NOT stored as first_name.
2. Unit-style check via `ai-test-purpose` edge fn with the same inputs.
3. Confirm `ai_memory.facts.consent.wants_human=true` after handoff turn.

## Files touched
- `supabase/functions/_shared/ai-agent-brain.ts` (intent gate, expanded blocklist, hardened name guards, memory write, notify-staff-handoff invoke)
- `.lovable/plan.md` (log entry)

No migrations. No new edge functions. No frontend changes.
