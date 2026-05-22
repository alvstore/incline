## Audit findings

1. **The latest behavior is real and traceable**
   - Contact `919887601200` has a valid stored memory name: `first_name = Rajat`.
   - After the user replied `Rajat`, the AI still emitted `Which membership duration suits you best?` before email.
   - After the user selected `Annual`, it replied: `Hi Rajat! What is your email address so I can send you the details?`

2. **Root cause A: the name guard fixed `Sample`, but it also reset the conversation path**
   - The guard correctly stopped greeting `Sample`.
   - But when the stored name was invalid, the bot fell back to Turn 1: “May I have your name”.
   - It did not look back far enough to recover the real historic name/email from older messages.

3. **Root cause B: old lead capture data is not linked anymore**
   - There are `[AI_LEAD_CAPTURED:...]` markers for this phone, but no current `leads` rows found by those IDs/phone variants.
   - `whatsapp_chat_settings.captured_lead_id` is null.
   - `ai_memory` has name + plan_interest, but not the historical email, even though the transcript contains `RAJAT.LEKHARI@HOTMAIL.COM`.

4. **Root cause C: hard-coded plan-duration flow still exists in code**
   - `ai-agent-brain.ts` still instructs the model to ask `plan_interest` with Monthly/Quarterly/Half-Yearly/Annual.
   - `whatsapp-webhook/index.ts` has a safety net that converts any plan/duration text into the canonical duration list.
   - This directly conflicts with the new live rule: **pre-opening phase only; no plan durations, no PT packages, no plan details.**

5. **Root cause D: outbound guard only blocks interactive JSON, not plain plan text**
   - The guard strips interactive JSON if name/email are missing.
   - But if the model emits plain text mentioning membership duration, `sendAiReply()` later promotes it into the forbidden plan list.

6. **Root cause E: “send you the details” is too broad for pre-opening**
   - Current prompts ask for email “so I can send membership details”.
   - In pre-opening mode this should be: **“so the Founding Member team can invite you / share pre-launch access details”**, not plan/package details.

## Implementation plan

### 1. Add a single deterministic lead-state resolver
Create one helper in the AI brain that resolves the contact’s state before prompt generation:

- Use phone variants for WhatsApp.
- Read, in order:
  1. `ai_memory.profile`
  2. `whatsapp_chat_settings.partial_lead_data`
  3. current `leads` by phone variant
  4. transcript-derived facts from recent/historic messages
- Normalize into one object:

```text
leadState = {
  realName,
  email,
  fitnessGoal,
  isCapturedLead,
  missingNextField
}
```

Rules:
- If name exists and passes `looksLikeRealName()`, never ask name again.
- If email exists anywhere, never ask email again.
- If lead was captured before, do not restart onboarding.
- For WhatsApp, never ask phone.

### 2. Replace plan-duration onboarding with Founding Member onboarding
Change lead capture target flow from:

```text
name → email → goal → plan_interest
```

to:

```text
name → email → goal/intention → handoff / founding-member lead captured
```

No Monthly/Quarterly/Half-Yearly/Annual list during pre-opening.

Prompt wording:
- Ask name only if unknown.
- Ask email only if unknown.
- Ask one fitness-intent question only if needed.
- Never promise plan/package/PT details.
- Use “Founding Member invite / pre-launch walkthrough / VIP waitlist”, not “membership details”.

### 3. Add hard server-side outbound sanitizers
Add a deterministic sanitizer after the model reply and before sending:

- Block and rewrite any reply that contains:
  - `Monthly`, `Quarterly`, `Half-Yearly`, `Annual` as plan-duration options
  - `Which membership duration suits you best?`
  - PT package/session-count/pricing language
  - “send you the plan/package details”
- If email is missing, rewrite to:
  - `Thanks, Rajat — what’s the best email for your Founding Member invite?`
- If name is missing, rewrite to:
  - `Sure — may I have your name first?`
- If name+email are known, rewrite to a safe Founding Member handoff.

This makes the live path safe even if the model ignores the prompt.

### 4. Remove/disable the canonical plan-list promotion in WhatsApp sender
Update `whatsapp-webhook/index.ts` so it no longer promotes plan/duration text into the Monthly/Quarterly/Half-Yearly/Annual list during pre-opening.

Keep only generic safety:
- strip prices/day-pass mentions
- strip forbidden plan/package/PT claims
- do not create any plan-interest interactive list

### 5. Backfill existing live contacts safely
Run a controlled data backfill, not a blind rewrite:

- For each WhatsApp phone with `[AI_LEAD_CAPTURED:...]` marker or clear transcript facts:
  - Extract real name from inbound messages.
  - Extract email from inbound messages.
  - Extract fitness goal if present.
  - Update/create `ai_memory.profile.email`, `ai_memory.profile.first_name/full_name`, and `facts.fitness_goal`.
  - Add `do_not_ask`: `phone`, `name`, `email`, and any known goal fields.
- For orphan capture markers whose `leads` row no longer exists:
  - Create or repair a `leads` row using the transcript facts.
  - Link it back to `whatsapp_chat_settings.captured_lead_id`.
- Specifically backfill `919887601200` with:
  - Name: `Rajat Lekhari` if transcript confidence is high; otherwise `Rajat`.
  - Email: `rajat.lekhari@hotmail.com`.
  - Goal: `Weight Loss` / latest known goal according to transcript order.
  - Mark as already captured; bot should not restart onboarding.

### 6. Backfill/clean knowledge context
Update `ai_knowledge` and `ai_purposes.extra.lead_capture` to be consistent with the declared phase:

- 11,000 sq ft.
- Opening: `July 2026` only, no exact date.
- No published plan durations, prices, PT packages, session counts, trainer names, class schedules.
- Founding Member lead capture is the only CTA.
- Email purpose is invite/waitlist/tour coordination, not plan details.

### 7. Add live regression tests before deploy
Add edge-function tests or scripted checks for these cases:

1. `contact_name = Sample`, no memory → generic greeting, asks name.
2. `contact_name = @Rajat`, memory has `first_name=Rajat`, no email → asks email, not name.
3. Memory has name+email → does not ask name/email again.
4. User asks “plans?” → no duration list, no prices, founding-member waitlist response.
5. User says `Annual` → bot does not treat it as valid live plan selection; redirects safely.
6. Existing orphan captured marker → backfill links lead and memory.

### 8. Deploy and verify live signals
After approval:

- Apply code changes.
- Apply data backfill migration/update.
- Deploy affected backend functions.
- Re-test with the exact Rajat conversation.
- Check logs for:
  - no `Sample` greeting
  - no plan-duration list
  - no repeated name question when name exists
  - repaired `captured_lead_id` and `ai_memory.email`

## Expected live behavior after fix

For the current Rajat contact:

```text
Thanks, Rajat — what’s the best email for your Founding Member invite?
```

If email is already backfilled before the next reply:

```text
Thanks, Rajat. I’ve added you to the Founding Member list — our team will reach out for the pre-launch walkthrough.
```

No plan durations, no PT package details, no “Sample”, and no repeated name question.