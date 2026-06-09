## Goal
Make the AI **always** ask the 4-option duration list explicitly, even when a lead mentions "Founding" / "annual" / etc. in their first message. Keep the existing name → email → goal → plan_interest backfill ladder; just stop the silent inference that bypasses it.

## Why this fixes the Hitangi transcript
- She had `name + email + phone` from the website form. ✅ Correct that AI didn't re-ask.
- She had no `fitness_goal` or `plan_interest`. The brain *should* have run Step 3 (goal list) → Step 4 (duration list) → Step 5 (close).
- It ran Step 3, then **skipped Step 4** because the LLM extractor pre-filled `plan_interest=annual` from the word "Founding" in her opener.
- After Weight Loss tap → it jumped straight to "Would you like a call?" (Step 5 annual pitch).

## Changes (all in one file: `supabase/functions/_shared/ai-agent-brain.ts`)

**1. Stop LLM from inferring `plan_interest` (lines ~1876–1887, `extractContextDelta`)**
- After `JSON.parse`, strip `parsed.facts.plan_interest` before `Object.assign`. Only the deterministic `PLAN_HINTS` regex block (lines 1837–1848) is allowed to set it — and that block already requires a plain duration word (`monthly` / `quarterly` / `half[-]year` / `annual|yearly|12 month`) in the message, not "Founding".
- Same defensive strip for `parsed.profile.email` / `parsed.profile.phone` (LLM should never hallucinate contact info — these come from auth/webhook).

**2. Tighten the duration regex (lines 1768–1773)**
- Replace `Annual: /\b(annual|yearly|12\s*month)\b/i` with a stricter version that requires the word to appear as a standalone *choice* — i.e. short message (`≤ 6 words`) **or** preceded by "I want / prefer / interested in / take the / go with". Mentions like "Founding memberships" or "annual membership cost?" no longer auto-capture.
- Add a guard: only deterministic-capture `plan_interest` when the previous bot turn was the duration prompt **or** the user's message is ≤ 6 words (a tap-style reply). Pull last bot turn from `history`.

**3. Add explicit "tap to confirm" gate (lines ~580–598, Step 4)**
- Even if `memory?.facts?.plan_interest` is present **but** there's no record of an interactive `list_reply` having delivered it, re-emit the duration list once with a softer prefix: *"Just to confirm, ${first_name} — which duration works best?"*.
- Record the explicit choice with a new marker `facts.plan_interest_confirmed = true` (written from the deterministic capture in step 1 only). Step 5 / post-capture nurture / `lead_captured` JSON only fire when `plan_interest_confirmed === true`.

**4. Email backfill safety (lines ~552–558, Step 2)**
- Already works: when `hasEmail` is false (no website capture), AI asks "what's the best email for your Founding Member invite?".
- Add one extra guard: if `memory.profile.email` exists but looks malformed (no `@` or domain), treat as missing and ask again.

**5. CRM display (no code change, just note)**
- Sales sidebar already shows `leads.plan_interest`. After this fix, that field is populated **only** when the user explicitly taps a row, so the value is trustworthy.

## Out of scope
- No DB migration, no UI changes, no new tables.
- No changes to the post-capture nurture, member persona, IG/Messenger envelope handling, or AI Brain knowledge-base seeding.
- `fitness_goal` keyword inference stays (lower-stakes, doesn't drive call CTA).

## Verification
After deploy, simulate Hitangi's flow via `supabase--curl_edge_functions` to `whatsapp-webhook` with the same opener:
1. *"Hi, I'd like to know more about Incline Fitness Founding memberships."* → expect goal list (no plan_interest inference).
2. Tap *Weight Loss* → expect duration list (Monthly / Quarterly / Half-Yearly / Annual).
3. Tap *Annual* → expect Founding confirm + "want a call?" close.
4. Verify `leads.plan_interest = 'Annual'` and a new fact `plan_interest_confirmed=true` in `ai_memory`.
5. Re-run with a returning lead whose `plan_interest` is already filled but `plan_interest_confirmed` is false → expect one "just to confirm" list, then proceed normally.

## Files touched
- `supabase/functions/_shared/ai-agent-brain.ts` (single file, ~30 lines changed across 4 spots)
- Redeploy edge functions that import the brain: `whatsapp-webhook`, `meta-webhook`, `ai-agent-brain` (auto via deploy).
