# Plan — Google Maps location + smarter concierge comprehension

## Part 1 — Always share the Google Maps link with the address

**Goal:** whenever the AI (or any location-related outbound message) shares the Udaipur address, it must also include the Google Maps share link `https://share.google/nO06sYYvXAVXFqugw` on its own line so members can tap to open directions.

### Changes
1. **Single source of truth** — add a constant `INCLINE_LOCATION` in `supabase/functions/_shared/ai-agent-brain.ts` (and mirror in `src/config/publicSite.ts` for any client surface):
   ```
   address: "Sector 14, Udaipur, Rajasthan"
   maps_url: "https://share.google/nO06sYYvXAVXFqugw"
   geo: 24.546845, 73.701003
   ```
2. **AI knowledge seed** — insert/update an `ai_knowledge` row (topic = `location`) whose canonical answer is:
   > "We're at Sector 14, Udaipur, Rajasthan ✨ Google Maps: https://share.google/nO06sYYvXAVXFqugw"
   
   High priority + trigger phrases: "location", "where", "address", "map", "directions", "kaha", "kahan", "पता", "location bhejo".
3. **Prompt rule** in `_shared/ai-prompt.ts` `<strict_rules>`:
   *"Whenever you mention our address, append the Google Maps link on a new line — never share address without the link."*
4. **Post-processor guard** in `ai-agent-brain.ts` (small helper `ensureMapsLink(text)`): if outbound text contains "Udaipur" / "Sector 14" / "address" but no `share.google` link, append `\n📍 ${maps_url}` before send. Runs after existing sanitizers.
5. **Public site** — small tweak on `src/pages/Index.tsx` / footer / contact block to render the Maps link next to the address (visible + `<a>` for SEO). Adds `hasMap` to LocalBusiness JSON-LD.

## Part 2 — Concierge that *understands before it answers*

Current problem (confirmed in prior Vera/Tania audit + magicpin transcript): brain runs the capture ladder or a canned response before it actually classifies what the inbound message *means*. Even with the recent solicitation regex, it's still reactive — a real member asking "opening date kya hai?" gets a generic founding-member ask, and a photo/opaque message ("There is no instahandle with this username") gets wrong info.

### A. Two-pass "Comprehend → Respond" loop in `ai-agent-brain.ts`

Before generating any reply, run a lightweight **comprehension pass** (Gemini Flash Lite, ~150 tokens out) that returns structured JSON:

```json
{
  "intent": "location_ask | pricing_ask | opening_date_ask | booking | complaint |
             solicitation | opt_out | media_only | correction | smalltalk | genuine_lead | ambiguous",
  "entities": { "topic": "instagram|location|plans|...", "urgency": "low|med|high" },
  "sentiment": "positive|neutral|negative|frustrated",
  "language": "en|hi|hinglish",
  "requires_fact": ["instagram_handle","maps_link","opening_status", ...],
  "should_capture_lead": true|false,
  "confidence": 0.0-1.0,
  "reasoning": "one sentence, private"
}
```

Cache per inbound `message_id`; budget 250 ms; fallback = existing deterministic path when the classifier errors or confidence < 0.4.

### B. Route by intent (replaces "always run ladder")

| Intent | Behaviour |
|---|---|
| `location_ask` | Reply with address + Google Maps link (Part 1). No capture ladder. |
| `opening_date_ask` | Existing embargoed line + offer Founding Member spot. |
| `pricing_ask` | Redirect to Founding Member benefits, no ₹ figures. |
| `correction` ("wrong handle", "not working") | Acknowledge, fetch fact from `ai_knowledge` (topic=`socials`), reply with corrected value. |
| `media_only` (photo/sticker/voice) | Short human "Got it, one sec — anything specific you'd like me to help with?" — never invent facts. |
| `solicitation` / `opt_out` | Existing guards (already shipped). |
| `genuine_lead` / `ambiguous` | Existing Name→Email→Goal→Plan ladder. |
| `complaint` / `negative` sentiment | Hand off to staff via `notify-staff-handoff`, one empathy line, no bot follow-ups. |

### C. Fact-first answering
When `requires_fact` is non-empty, the brain MUST retrieve those specific `ai_knowledge` topics *before* generating (not rely on generic RAG). Seed the missing facts:

- `socials.instagram` → `https://www.instagram.com/inclineudaipur/` (fixes the wrong-handle bug from the audited chat)
- `socials.facebook`, `socials.youtube` (placeholders, editable in admin)
- `location.address`, `location.maps_url`, `location.geo`
- `hours.weekdays`, `hours.weekends`
- `opening.status` = "opening soon, exact date shared personally"

Wrong-fact guard: if outbound contains an `@handle`, it must match a value in `ai_knowledge` topic=`socials` — otherwise strip the handle and replace with the correct one or the profile URL.

### D. Reasoning-first prompt
Add `<comprehension>` block to system prompt in `_shared/ai-prompt.ts`:
> *"Step 1 (silent): read the last 6 turns and the classifier JSON. Decide what the member actually wants. Step 2: answer only that — no ladder, no upsell, no invented facts. Step 3: if you mention address, socials, hours, or opening — pull the exact value from `<knowledge_base>`, never guess."*

Neuter the founding-phase sanitizer + name-repeat guard when intent ∈ {location_ask, correction, media_only, complaint, opt_out}.

### E. Repeated-mistake cooldown (extend existing loop detector)
If the same *fact* (Instagram handle, address, opening date) is asked twice in the thread and the previous bot answer was corrected by the member ("no", "wrong", "that's not it"), escalate to staff instead of trying a third time.

### F. Admin surface
Under **Settings → AI Agent → Training**, new tab **"Comprehension log"**: last 100 inbound with intent + confidence + fact list + reply. Owner can flag "wrong intent" — writes a correction row into `ai_knowledge` so future messages match.

### G. Verification
1. Replay the audited chat (photo → "no instahandle" → correction) through `ai-test-purpose` — expect the second reply to name `@inclineudaipur` from the fact table, not a made-up handle.
2. "Where are you?" → returns address + Google Maps link on separate lines.
3. "26 July kab open?" → returns embargoed opening line (still no date leak) + Founding Member CTA. Owner-facing rule: opening date remains embargoed by AI even after part 1 — that's a business rule, not a bug.
4. 5 real founding-member conversations still complete Name→Email→Goal→Plan ladder.
5. Unit test the classifier on 20 canonical inbound (location, price, opening, complaint, sticker, Vera pitch, opt-out, Hinglish "kaha ho", photo-only, wrong-handle correction).

## Files touched
- `supabase/functions/_shared/ai-intent-classifier.ts` (new — comprehension pass)
- `supabase/functions/_shared/ai-agent-brain.ts` (intent router, fact retrieval, maps-link post-processor, wrong-handle guard)
- `supabase/functions/_shared/ai-prompt.ts` (comprehension block + fact-first rule)
- Migration: seed `ai_knowledge` rows for `location.*`, `socials.*`, `hours.*`, `opening.status`; new `ai_comprehension_log` table for admin surface
- `src/config/publicSite.ts` + `src/pages/Index.tsx` (public Maps link + JSON-LD hasMap)
- `src/components/settings/AIAgent/ComprehensionLog.tsx` (new admin tab)

## Out of scope
- Changing the embargoed opening-date policy (still hidden from AI; owner shares 26 Jul 2026 personally).
- Rewriting existing solicitation guard — it stays; comprehension pass sits *above* it.
