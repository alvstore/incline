## Goal

Retire the "26 July 2026 / Founding Member embargo" logic across the AI shared layer and replace it with the live post-launch pricing matrix, member-vs-lead routing, and a mandatory in-person tour CTA.

## Scope (files touched)

- `supabase/functions/_shared/ai-agent-brain.ts` — deterministic fallbacks, embargo constants, sanitizer, prompt scaffolding.
- `supabase/functions/_shared/ai-prompt.ts` — XML system prompt, per-intent rules, plan_interest reminder.
- `src/lib/launch.ts` — flip launch flag / remove embargo helpers if referenced.
- Seed row(s) in `ai_knowledge` for `pricing_rules` (via `supabase--migration`) so retrieval matches the new SSOT.

Client UI, DB schema for pricing, invoices, and Founding Member reservation flow are **out of scope** — this is prompt + knowledge only.

## Pricing SSOT (single constant, imported by prompt + fallbacks)

```
Annual Base Founder     ₹25,000  (MRP ₹28,900) — Gym + Steam
Annual Elite Founder    ₹30,000  (MRP ₹36,900) — Gym + Steam + 6× Ice Bath + 6× Sauna + 6× 3D BMI
1 Month                 ₹5,000
3 Months                ₹15,000
6 Months                ₹19,990
All prices + 5% GST. Ice Bath & Infrared Sauna NOT included in Base.
```

CTA line (append after any price share to non-members):
> "For better pricing options and a detailed breakdown, I'd love to schedule a VIP gym tour for you with our front desk. Which day works best for you?"

## Epic 1 — Purge embargo, inject live pricing (`ai-agent-brain.ts`)

1. Delete / replace embargo constants: `LAUNCH_DATE_LABEL`, `EMBARGO_PIVOT_LINE_EN`, `EMBARGO_PIVOT_LINE_HI`, `embargoPivotLine()`, `INTENT_CANNED_RESPONSES.pricing`.
2. Add new exports:
   - `PRICING_MATRIX` (structured object, source of truth).
   - `pricingReplyEN(firstName)` / `pricingReplyHI(firstName)` — concise price block + tour CTA.
   - `tourCtaLine(firstName)`.
3. Rewrite `PRICING_INTENT_RE` fallback path to return `pricingReplyEN/HI` instead of embargo pivot.
4. Rewrite `TIMELINE_INTENT_RE` fallback: replace "we open on 26 July 2026" copy with "We're open now, 24×7 in Sector 14 — come visit anytime. Want me to book a VIP tour?" No date references.
5. Rewrite `sanitizeFoundersPhaseText`:
   - Stop redacting `<Month> 20XX`, price digits, PT package names.
   - Keep only the hallucinated-callback / hallucinated-tour-time guard (still block AI from inventing specific staff callback promises).
   - Rename to `sanitizePostLaunchText`; keep old export name as alias for one release to avoid import breakage.
6. Purge every hard-coded "Sunday, 26 July 2026" and "Founding Members list" line (lines ~157–163, 973–974, 1011–1012, 1292–1294, 1730–1731, 1940, 2041–2057). Replace member-created / plan_interest confirm copy with tour-CTA phrasing.
7. `KNOWN PLAN_INTEREST` rule (line ~2965) rewritten: confirm interest → quote matching plan price → append tour CTA. Remove "NEVER quote prices" clause.

## Epic 2 — Context-aware routing (`ai-prompt.ts`)

1. In `<strict_rules>` add:
   - **MEMBER MODE** (`context.type === 'member'` or resolved identity is active member): never quote plans/prices, never pitch, never run name/email capture ladder. Focus on support, PT bookings, facility access, and escalate to human when needed.
   - **LEAD/UNKNOWN MODE** (default): may quote from `PRICING_MATRIX`; MUST append the tour CTA verbatim after any price mention; MUST NOT end a pricing turn without asking for a preferred visit day.
2. Missing/ambiguous payload → default to LEAD mode.
3. Remove the `"Launch & Pricing Embargo"` directive (line ~1289) and the "OPENING DATE" / "NO CALLBACK POLICY" / "speak to a person" blocks (~1292–1294). Replace with:
   - "We are open 24×7 in Sector 14, Udaipur — always encourage an in-person tour."
   - Callback policy softened: may offer a front-desk tour booking, but must not invent specific staff names or exact times.
4. Update `<role_objective>` for lead/unknown to end every pricing answer with the tour CTA.
5. Keep XML tag structure (`<persona>`, `<strict_rules>`, `<user_context>`, `<role_objective>`, `<knowledge_base>`, `<runtime>`) intact.

## Epic 3 — Knowledge base row

Migration adds/updates `ai_knowledge` rows so RAG retrieval reflects the new SSOT:

- `pricing_rules` → full matrix + GST note + tour CTA.
- `lead_capture_flow` → drop embargo language; keep name/email capture but route to tour booking not "Founding Members list".
- Remove/deprecate `launch_embargo` row if present.
- Re-embed via existing `tg_ai_knowledge_enqueue_embed` trigger (automatic).

## Out of scope / follow-ups

- Public SEO files (`public/llms.txt`, `llms-full.txt`, `ai.txt`) still say "opens 26 July 2026". Flag to user: should these be flipped to "now open" in a follow-up turn? Not touching in this plan.
- No changes to `whatsapp-webhook` onboarding sequence order (Name → Email → Goal → Plan Interest) — still valid post-launch.
- No pricing tables in DB, no invoice/checkout changes.

## Verification

- `rg` sweeps confirm zero remaining `26 July 2026`, `LAUNCH_DATE_LABEL`, `EMBARGO_PIVOT_LINE`, `Founding Members list` references in `_shared/ai-*.ts`.
- Manually run `ai-test-purpose` for `whatsapp_reply` with a pricing question from (a) unknown contact → expect prices + tour CTA, (b) active member → expect no pricing, support tone.
- Test send to +91 9887601200 with prompt "how much is annual membership?" and confirm reply contains ₹25,000/₹30,000 + tour CTA.

## Open questions

1. Should the public SEO/LLM discovery files (`public/llms.txt`, `llms-full.txt`, `ai.txt`) be updated in the same turn, or handled separately? They currently advertise the embargo.
2. Confirm short-term plan inclusions (do 1M/3M/6M include Steam only, or Gym+Steam like Base Founder?) — the spec doesn't say, and the AI will be asked. Default assumption: **Gym + Steam, no Ice Bath / Sauna** unless corrected.
