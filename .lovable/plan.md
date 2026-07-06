# Audit — what actually went wrong in the Lakshya chat

Looking at the transcript against `supabase/functions/_shared/ai-agent-brain.ts` (v4.9.0), three separate bugs compounded:

**1. AI is promising a real founder callback ("call you in the next 2 hours").**
The v4.8.0 "callback consent short-circuit" (brain lines 825–875) fires whenever the bot offered a callback and the user said "ok/yes". It calls `requestFounderHandoff()` and then emits the hard-coded line:
> "Locked in, Lakshya ✨ One of our founders will personally call you within the next 2 hours…"
That contradicts the Founder's Phase rule you just restated: **no callbacks, no tours, no pricing — everything is disclosed only on/after 26 July.** The bot should only *reserve interest*, never commit a human to call.

**2. "Sunday, 26 July 2026" leaked in Hinglish.**
Turn 4: *"Hum Sunday, 26 July 2026 ko launch kar rahe hain."* v4.5.0 was supposed to redact `<month> 20XX`, but our own constants `EMBARGO_PIVOT_LINE_EN/HI` (lines 157–163) are the source — they hard-code `LAUNCH_DATE_LABEL = "Sunday, 26 July 2026"` and are injected before the sanitizer runs. Same string is echoed by the LLM at 16:48 ("We open on Sunday, 26 July 2026…"). Per your rule the AI must **not disclose the opening date at all** to prospects.

**3. Bot loops the same offer ~6 times.**
After `founder_handoff_task_id` is already stamped, nothing in the LLM path suppresses re-offering "Want our team to lock in your Founding spot?" — Lakshya finally snapped: *"How many times do I have to answer the same question?"* There is no "already-reserved, stop asking" gate on the outbound side, and the hallucinated-action stripper doesn't cover repeated *offers* (only false *claims*).

---

# Plan — 3 focused changes, no schema or flow rewrites

## A. Kill callback commitments in Founder's Phase

`supabase/functions/_shared/ai-agent-brain.ts`
- Replace the callback-consent short-circuit (lines 825–875) with a **Reservation short-circuit**. It still creates an internal task via `requestFounderHandoff()` (so ops sees the lead), but the reason becomes `founding_member_reservation` and the outbound copy becomes:
  > "You're on the Founding Members list, {name} ✨ We'll share the full details with you on opening day — no calls before then."
- Remove every "our team will call you" / "founder will call you in 2 hours" string from the brain. Replace with the reservation copy above.
- Change `EMBARGO_PIVOT_LINE_EN/HI` (lines 158–163) and `embargoPivotLine()` to a no-callback, no-date version:
  > EN: "Founding Membership spots are open right now — want me to add your name to the list? I'll share everything with you on opening day."
  > HI: "Founding Membership spots abhi open hain — naam add kar doon? Opening day pe main aapko saari details bhej dunga."
- Also remove the "Want our team to call you to lock in your Founding spot?" line from `_shared/handoff.ts` `SAFE_CALLBACK_OFFER` and rename it to `SAFE_RESERVATION_OFFER` with the reservation copy. `assertCallbackPromiseAllowed()` becomes `assertNoCallbackPromise()` and strips *any* "team will call / founder will call / callback / 2 hours" sentence, not just the current narrow regex.
- Update `ai_knowledge` rows (`topic in ('pricing_rules','lead_capture_flow','pt_rules','facts')`) via a migration to strip the words "call you", "callback", "tour", "visit", "2 hours" and any explicit month/year, and replace with reservation language. Same for `ai_purposes.system_prompt` where those phrases appear.

## B. Plug the opening-date leak everywhere

`supabase/functions/_shared/ai-agent-brain.ts`
- Change `LAUNCH_DATE_LABEL` to `"opening day"` (internal label only — nothing user-facing quotes the actual date anymore). Keep the real date in a separate `LAUNCH_DATE_INTERNAL = "2026-07-26"` constant used only for staff-side task descriptions, never for outbound copy.
- Extend the v4.5.0 date-redaction sanitizer to also catch:
  - `\b\d{1,2}\s*(?:st|nd|rd|th)?\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*20\d{2}\b`
  - `\b(?:sunday|monday|…)\s*,?\s*\d{1,2}\s*(?:jan|…|dec)[a-z]*\s*20\d{2}\b`
  - Hinglish patterns: `\b(?:July|Jul(?:ai)?)\s*20\d{2}\b`, `\b26\s*(?:July|Jul(?:ai)?)\b`
  - Replace with "on opening day".
- Run the sanitizer on **every** outbound branch (deterministic short-circuits, embargo pivot, LLM output) — right now some short-circuits return before it runs.
- SEO files under `public/` (llms.txt, llms-full.txt, ai.txt) are **left untouched** — those are for crawlers, not the WhatsApp/IG bot.

## C. Break the "same offer, over and over" loop

`supabase/functions/_shared/ai-agent-brain.ts`
- Add an `alreadyReserved` gate at the top of `runUnifiedAgent`: if `chatSettings.founder_handoff_task_id` exists AND the user's message is a bare affirmation / thanks / reaction (`ok`, `yes`, `sure`, `done`, `okok`, emoji), reply once with:
  > "You're all set on the Founding list, {name} ✨ I'll ping you on opening day."
  and return. No LLM call, no repeat offer.
- Extend the hallucinated-action stripper to remove **re-offers** once reserved: strip any sentence matching `/want (?:our|the) team to (?:call|contact|lock)|lock in your (?:founding )?spot|founding member (?:annual|spot)/i` when `founder_handoff_task_id` is set.
- Add a per-conversation "offer emitted count" guard: if the last 3 assistant turns already contain the reservation offer, suppress a 4th and instead say "Anything specific you'd like me to note for our team before opening day?"

## Verification (before I call it done)

- Grep the brain + `_shared/*` for any remaining "call you", "founder will call", "2 hours", `LAUNCH_DATE_LABEL` string interpolation into outbound copy, and `2026`. Expect zero hits in user-facing paths.
- Add a Deno unit test (`supabase/functions/_shared/__tests__/ai-brain-embargo.test.ts`) with 4 cases:
  1. User says "ok" after reservation offer → gets reservation confirmation, not callback promise.
  2. User asks "kab khulega?" → reply contains "opening day", not "July" / "2026" / a numeric date.
  3. User says "yes" 3 times in a row after already reserved → bot doesn't re-offer.
  4. LLM returns a string containing "our team will call you" → sanitizer strips it and substitutes reservation copy.
- Manually replay Lakshya's transcript through the local brain (unit-test harness) and confirm none of the 3 bugs reproduce.

## Files touched

- `supabase/functions/_shared/ai-agent-brain.ts` (edit — sections A, B, C)
- `supabase/functions/_shared/handoff.ts` (edit — rename constants, tighten sanitizer)
- `supabase/migrations/<ts>_founders_phase_no_callback_no_date.sql` (new — scrub `ai_knowledge` + `ai_purposes.system_prompt`)
- `supabase/functions/_shared/__tests__/ai-brain-embargo.test.ts` (new)

## Explicitly NOT changing

- WhatsApp / IG / Messenger webhooks, lead capture flow, task/handoff plumbing (`requestFounderHandoff` still runs — ops still gets the internal task, just no promise back to the prospect).
- Interactive-list onboarding steps (name → goal → plan interest).
- `public/llms*.txt`, `public/ai.txt`, `public/sitemap.xml`, and `index.html` — those are crawler-facing, not chatbot-facing.
- Dashboard, /register, RLS, migrations outside the knowledge scrub.
