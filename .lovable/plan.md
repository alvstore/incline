# Founder's Phase Onboarding — Capture Plan Interest + Fitness Goal (Lead-Friendly)

## Correction from previous plan
Do **not** hardcode plan to Annual. Founding Membership is internally Annual-only, but we still capture the lead's **preferred duration** (Monthly / Quarterly / Half-Yearly / Annual) so sales can nurture and upsell later. No customer is turned away at the chat layer.

## Onboarding flow (new)
**Name → Email → Fitness Goal → Plan Interest (duration preference) → Founding Member pitch**

After capturing duration interest, the AI replies with a soft pitch:
> "Right now we're onboarding **Founding Members** (Annual only) with launch-day perks. I'll note your interest in {duration} and our team will share full plan options closer to launch. Would you like to lock in Founding Member benefits now?"

This way:
- Monthly/Quarterly/Half-Yearly leads are captured (not lost)
- Only Annual leads get the "confirm Founding Member" CTA
- Sales gets a clean `plan_interest` field to segment + nurture

## Changes

### 1. `supabase/functions/_shared/ai-agent-brain.ts` (v3.5.0)
- `target_fields` = `['name', 'email', 'goal', 'plan_interest']`.
- `askNextMissing()` sequence: name → email → goal → plan_interest.
- `plan_interest` prompt = open-ended ("Are you looking at a monthly, quarterly, half-yearly, or annual plan?"). Normalize answer into one of `monthly | quarterly | half_yearly | annual` and store on `ai_memory.profile.plan_interest` + `leads.plan_interest`.
- Update `buildRuntimeRules()`:
  - "Capture the lead's preferred plan duration even if it's not Annual — never refuse or hard-redirect."
  - "Only Annual interest qualifies for immediate Founding Member confirmation. For Monthly/Quarterly/Half-Yearly, acknowledge their interest, note it, and softly mention that Founding Member (Annual) is the only active offer pre-launch — team will follow up with full plan options closer to launch."
  - "Never quote prices, ₹ amounts, or fees — those come from the sales team."
- Adjust `FORBIDDEN_PLAN_TEXT_RE` sanitizer:
  - **Allow:** the words `monthly`, `quarterly`, `half-yearly`, `annual`, `founding`, `goal`, `plan` (so the AI can ask about and acknowledge them).
  - **Still block:** `₹`, `rs.`, `rupees`, `price`, `fees`, `cost`, `pt package`, specific numeric prices.
- Remove the v3.4.0 auto-rewrite that collapsed plan-mentions into a generic CTA — replace with a price-only sanitizer.

### 2. `supabase/functions/whatsapp-webhook/index.ts`
- Keep the "no auto-promote to 4-row duration list" guard (we're capturing via free text, not list).
- Allow a single confirm button "Join as Founding Member" only when `plan_interest = 'annual'` AND name+email+goal are present.

### 3. `ai_purposes` (data update via insert tool)
- `whatsapp_reply.target_fields = ['name','email','goal','plan_interest']`.
- `plan_interest.allowed_values = ['monthly','quarterly','half_yearly','annual']` (capture-only; no gating).
- Remove the v3.4.0 `do_not_ask: ['goal','plan_interest']` restriction.

### 4. `ai_knowledge` refresh
- Upsert canonical fact: *"Pre-opening (July 2026 launch, 11,000 sq ft, Sector 14 Udaipur). Capture every lead's plan-duration interest (monthly/quarterly/half-yearly/annual). The only active offer right now is **Founding Member (Annual)**. Non-annual leads are nurtured by sales, never turned away. Never quote prices in chat."*
- Re-embed via existing trigger.

### 5. Backfill (data update via insert tool)
- For Rajat (`919887601200`) and any Founder's Phase leads:
  - Scan recent transcripts for goal keywords (weight loss, strength, recovery, general fitness, etc.) → set `ai_memory.profile.goal` + `leads.fitness_goal` where missing.
  - Scan transcripts for duration keywords → set `ai_memory.profile.plan_interest` + `leads.plan_interest` where missing.
  - Clear stale `do_not_ask` flags added in v3.4.0.
- Re-link any orphan `[AI_LEAD_CAPTURED:...]` markers to `leads` rows + `whatsapp_chat_settings.captured_lead_id`.

### 6. Project memory (mem://index.md Core)
Add: *"Founder's Phase (pre-July-2026 launch): onboarding captures Name → Email → Fitness Goal → Plan Interest (monthly/quarterly/half-yearly/annual). Never refuse non-annual interest — capture as leads for sales nurture. Only Annual leads get immediate Founding Member confirm CTA. AI never quotes ₹/prices/fees."*

## Files touched
- `supabase/functions/_shared/ai-agent-brain.ts`
- `supabase/functions/whatsapp-webhook/index.ts`
- `mem://index.md`
- DB: `ai_purposes`, `ai_knowledge`, `ai_memory`, `leads`, `whatsapp_chat_settings`

## Verification
- Fresh number, says "I want monthly" → AI captures `plan_interest=monthly`, notes it, mentions Founding Member is the active offer, does NOT push hard, does NOT quote prices.
- Fresh number, says "annual" → AI captures, then offers Founding Member confirm CTA.
- Rajat's number → AI greets by name, asks only for missing goal + plan_interest, then proceeds.
- Edge logs show zero sanitizer rewrites for `monthly|quarterly|annual`; sanitizer still fires on any `₹`/`price`/`fees` leak.
