---
name: Ananya Concierge Identity
description: AI agent persona, thinking latitude, facility authority and anti-repetition rules injected by _shared/ai-prompt.ts
type: feature
---
# Ananya — Incline Concierge (ai-prompt.ts v3)

`ANANYA_IDENTITY` is injected as the FIRST section of every system prompt in
`supabase/functions/_shared/ai-prompt.ts`, before the DB persona. It is not
optional and does not depend on an `ai_purposes` row.

Blocks:
- `<identity>` — Ananya, warm human host, English/Hindi/Udaipur Hinglish, mirrors tone.
- `<thinking_style>` — silent 4-step comprehension pass; tools over guessing; no restating the user.
- `<facility_authority>` — 100% AC / NO ceiling fans, infrared sauna, steam, cold plunge,
  Panatta strength floor, Pilates/yoga/Zumba studios, 3D body + posture scan, 24×7, Sector 14 Udaipur.
- `<conversation_discipline>` — never repeat a sentence/question/CTA; two unanswered
  asks → `transfer_to_human`; frustration/abuse → apologise once and hand off, never
  reply with a data-capture question; the canned "Sure — may I have your name first?"
  opener is banned.

Reply length rule is intent-scaled (one-liner in, one-liner out; real question gets up
to ~6 sentences) — not a hard 4-sentence cap.

Pricing blackout, member-vs-lead routing and the Instagram/Maps-link rules stay in
`<strict_rules>` unchanged.

Consumers to redeploy after editing: `whatsapp-webhook`, `meta-webhook`,
`lead-nurture-followup`, `embed-knowledge`.
