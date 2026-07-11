# Audit — what the chat got wrong

Two separate issues in Shubham's transcript, both traceable to code we tightened in the last two rounds:

**1. Bot refuses to say "26 July 2026" and won't welcome the visitor.**
After the Lakshya/Raj audits we set `LAUNCH_DATE_LABEL = "opening day"` and wired `redactOpeningDate()` (v5.0.0) to strip **any** month/year/numeric date from every outbound message. The system prompt now says: *"NEVER mention a specific month, year, or opening date — refer to it ONLY as opening day."* That was the correct read of *"don't disclose date"* at that time — but your new instruction reverses it: the date **should** be disclosed, and the tone should be welcoming ("you are most welcome"). Right now the sanitizer would scrub "26 July 2026" even if the LLM produced it.

**2. Bot gives the wrong Instagram handle.**
The bot answered `@theinclinelife`, which is what our SEO/JSON-LD/footer say. The real handle is **@inclineudaipur** (`https://www.instagram.com/inclineudaipur/`). The bot has no `ai_knowledge` row for social handles, so it fell back to the LLM guessing from the site's `sameAs` array in `index.html` — which points at the stale username. Same stale handle is also in `public/llms.txt`, `public/llms-full.txt`, `ScrollOverlay.tsx`, and `cmsService.ts` (which additionally has a third wrong handle, `inclinefitness`).

# Plan — 2 focused changes

## A. Re-enable opening-date disclosure with a warm welcome

Founder's Phase rules are relaxed to: **disclose the date, welcome visitors on opening day, still do NOT quote prices / PT packages / plan tiers.** No callback commitments before opening day (that guard stays).

`supabase/functions/_shared/ai-agent-brain.ts`
- Set `LAUNCH_DATE_LABEL = "Sunday, 26 July 2026"`. Keep `LAUNCH_DATE_INTERNAL` as-is.
- Rewrite `EMBARGO_PIVOT_LINE_EN` / `_HI` to include the date and a welcome:
  - EN: `"We open on Sunday, 26 July 2026 — you're most welcome to visit us then! Want me to add your name to the Founding Members list so you get the full details first?"`
  - HI: `"Hum Sunday, 26 July 2026 ko open kar rahe hain — aap zaroor visit kijiye! Naam Founding Members list mein add kar doon?"`
- Neutralize `redactOpeningDate()` to a pass-through (`return { redacted: text, hit: false }`) so the date is no longer scrubbed. Keep the function signature and CJK/Hangul scrubber intact (still useful).
- Rewrite the reservation short-circuit copy (~lines 850–895):
  - "You're on the Founding Members list, {name} ✨ We open on **Sunday, 26 July 2026** — you're most welcome to visit us then. I'll share the full details with you before opening day."
  - Already-reserved bare-affirmation reply: "You're all set, {name} ✨ See you on **26 July 2026** — we can't wait to welcome you!"
- Rewrite the system-prompt Founder's Phase block (line 1172–1173):
  - Replace *"NEVER mention a specific month, year, or opening date"* with *"You MAY (and should) tell users we open on Sunday, 26 July 2026 and warmly welcome them to visit then."*
  - Keep the "no callback commitments before opening day" and "no pricing / PT / plan-tier disclosure" rules. Change "reach out on opening day" wording accordingly.
- Update the `KNOWN PLAN_INTEREST` rule strings (lines ~2725/2727): remove "NEVER quote… any month/year/date"; keep the price/session-count ban.
- Update `getNonMembershipRedirect` / `buildNoReplyFallback` / any hard-coded "opening day" lines to include the actual date.

`supabase/functions/_shared/handoff.ts`
- Tighten `HALLUCINATED_CALLBACK_RE` so it strips *only* "call/callback/2 hours" promises — remove the "share personally / reach out / get back / ping you" clauses so warm follow-through phrasing survives.
- Rename `SAFE_RESERVATION_OFFER` copy to include the date and welcome.

`ai_knowledge` (via one migration — no schema changes):
- `pricing_rules` row: keep "no prices before opening" but replace "opening day" with "Sunday, 26 July 2026" and add "warmly invite the user to visit on/after 26 July 2026".
- `launch_timeline` row: restore the specific date; explicitly say "you are most welcome to visit us on or after Sunday, 26 July 2026".
- Leave the `non_fitness_message` / careers deflection row alone.

Deploy `whatsapp-webhook` and `meta-webhook` after the edit.

## B. Fix the Instagram handle everywhere

Correct handle: **@inclineudaipur** → `https://www.instagram.com/inclineudaipur/`.

Files to update:
- `index.html` — the 3 JSON-LD `sameAs` entries (lines 93, 113, 209).
- `public/llms.txt` (line 48) and `public/llms-full.txt` (line 184).
- `src/components/ui/ScrollOverlay.tsx` (lines 215–216) — href + label.
- `src/services/cmsService.ts` (line 62) — replace stale `instagram.com/inclinefitness`.
- Add a new `ai_knowledge` row (topic: `social_handles`) with the correct IG/FB/YouTube URLs so the bot answers from knowledge instead of guessing. Include: "If a user asks for our Instagram, reply with @inclineudaipur (https://www.instagram.com/inclineudaipur/)."

Not touching: WhatsApp/IG/Messenger webhooks, Meta OAuth (`graph.instagram.com` is Meta's API host, unrelated to the public handle), lead capture, RLS, Dashboard.

## Verification

- `rg -n "theinclinelife|inclinefitness" index.html public/ src/ supabase/functions/_shared/` → zero hits after edit (except the `@theinclinelife.com` email addresses, which stay).
- `rg -n "opening day"` in `ai-agent-brain.ts` → only appears inside sanitizer/legacy comments; user-facing strings all say the date.
- Manually replay Shubham's transcript through the brain harness — bot should now say "We open on Sunday, 26 July 2026 — you're most welcome to visit us then" and, when asked for Instagram, reply `@inclineudaipur`.
- Deploy webhooks and send one live test message on WhatsApp asking (a) "when do you open?" and (b) "insta handle?".

## Files changed
- `supabase/functions/_shared/ai-agent-brain.ts`
- `supabase/functions/_shared/handoff.ts`
- `supabase/migrations/<ts>_founders_phase_disclose_date_and_ig_handle.sql` (new — updates `ai_knowledge` rows, inserts `social_handles` row)
- `index.html`
- `public/llms.txt`, `public/llms-full.txt`
- `src/components/ui/ScrollOverlay.tsx`
- `src/services/cmsService.ts`
