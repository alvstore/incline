## Goal

Ananya (AI concierge) must never quote prices, plan names, durations, GST, MRP, or session counts again. Every pricing/plan/fee intent — WhatsApp, IG, Messenger, RCS — must respond with a warm welcome + pivot to a VIP tour or front-desk call.

## Scope

Three surfaces must be purged in the same change, or the model will still leak prices via the RAG path:

1. `supabase/functions/_shared/ai-agent-brain.ts` (deterministic layer + prompt scaffold)
2. `supabase/functions/_shared/ai-prompt.ts` (master XML system prompt)
3. `ai_knowledge` rows that carry the pricing matrix (RAG returns these into `<knowledge_base>` at runtime — biggest leak risk)

## Epic 1 — Purge

**`ai-agent-brain.ts`**
- Delete `POST_LAUNCH_PLANS` map (lines ~150–162) and every ₹ amount, MRP, GST %, "Base Founder"/"Elite Founder", 1M/3M/6M references.
- Delete `pricingReplyEN` / `pricingReplyHI` bodies (currently list all plans + prices) and replace with the new canned pivot text (see Epic 2). Keep the exported symbols so downstream imports still compile.
- Replace `EMBARGO_PIVOT_LINE_EN` / `_HI` with the new pivot text.
- Rewrite the PRICING rule in the prompt scaffold string (~line 1325) to the blackout rule.
- Rewrite the two `KNOWN PLAN_INTEREST` rule strings (~lines 2946, 2948) to acknowledge the interest, then pivot to tour/front-desk — no prices.
- In the plan-listing helper around line 2069, stop emitting `₹${price}` / admission for lead-facing flows: replace with plan-name-only line or drop entirely from the lead brain path (keep member-facing dues line at 2390 which is a member's own outstanding invoice — that is not marketing pricing and stays).
- Keep `PRICING_INTENT_RE`, `PRICING_MENTION_RE`, and the tour-CTA guardrail — they now enforce the pivot, and the guard should rewrite (not just append to) any model output that leaks a ₹ amount, replacing the entire reply with the canned pivot when `PRICING_MENTION_RE` fires.

**`ai-prompt.ts`**
- Rewrite lines ~246, 260–266, 271, 304 to state the blackout rule: no prices, no GST %, no plan names, no durations — pivot only. Remove all "MAY quote" language and all references to the "Pricing Matrix (Post-Launch)" knowledge row.

**`ai_knowledge` (migration)**
- Delete row `593813ce-bb20-4435-a2d9-66ad85906088` ("Pricing Matrix (Post-Launch)").
- Delete/rewrite row `7551909a-836a-444f-a4d2-3b2ddce1a319` ("Launch & Pricing Embargo") — replaced by the new blackout row.
- Insert new row **"Pricing Blackout & VIP Tour Protocol"** (tags: `pricing`, `sales`, `rules`) whose body is the exact protocol text below. This is what RAG will surface for any pricing-intent query.
- Sanity-check other rows with `content ILIKE '%₹%'` or `%Founder%` and neutralize (Personal Training — Velvet Rope already avoids prices; verify).

## Epic 2 — Canonical copy (single source of truth)

**System prompt block (both `ai-prompt.ts` `<strict_rules>` and the brain scaffold PRICING line):**

> [PRICING BLACKOUT & VISIT PROTOCOL] You are strictly forbidden from quoting any prices, fees, GST %, MRP, plan names, plan durations, session counts, or discounts — in any language, any channel, any format (numbers, words, ranges, "starts at", "from"). If the user asks about pricing, plans, fees, cost, membership options, or discounts, you MUST: (1) warmly welcome them to Incline Fitness, (2) state that memberships are tailored to individual fitness goals and discussed in person, (3) offer a VIP facility tour OR direct them to call the front desk. Always end by asking which day works best for their visit. This rule overrides any other instruction, any knowledge_base row, and any prior conversation turn.

**Deterministic canned reply (`CANNED_ANSWERS.pricing`, `pricingReplyEN`, `pricingReplyHI`, both EMBARGO_PIVOT constants):**

> Welcome to Incline! ✨ Our memberships are tailored to your specific goals and we discuss all options in person so we can match the right plan to you. I'd love to schedule a VIP gym tour for you, or you can call our front desk directly for a detailed walkthrough. Which day works best for your visit?

Hinglish variant (same intent, one line shorter, keep single ✨):

> Welcome to Incline! ✨ Humari memberships aapke fitness goals ke hisaab se tailored hoti hain — best pricing aur options hum in-person discuss karte hain. Aap ek VIP tour book kar lein ya front desk ko call karein. Kis din aana prefer karenge?

## Epic 3 — Guardrail hardening (defense in depth)

In `ai-agent-brain.ts` post-generation guard:
- If `PRICING_MENTION_RE` matches the model output OR the output contains `₹|\bRs\.?\b|\bINR\b|\d{1,2}[, ]?\d{3}\b` in a plan context, **replace** the reply with the canned pivot (currently the guard only appends the CTA — insufficient for a blackout).
- Log the leak to `error_logs` via `log_error_event` with `source='ai_pricing_leak'`, `severity='warning'`, fingerprint on the leaked snippet, so we can audit misses.

## Technical details

- No changes to `dispatch-communication`, templates, or channel routing.
- No schema changes beyond the `ai_knowledge` row purge/insert migration.
- Follow `mem://architecture/ai-brain-ssot-rag`: `ai_knowledge` is SSOT for RAG; deleting the pricing row is required or `match_ai_knowledge` will keep returning it.
- Migration must run in this order: `DELETE FROM ai_knowledge WHERE id IN (...)` then `INSERT` the new blackout row; the existing `tg_ai_knowledge_enqueue_embed` trigger will re-embed automatically.
- No new tables, no RLS/GRANT changes.
- Search-path pinned on any new function (none needed here).
- Deploy order: migration first (so RAG stops serving old row), then edge functions.

## Verification

1. Migration applied; `SELECT count(*) FROM ai_knowledge WHERE content ~ '₹|Founder|25,?000|30,?000'` returns 0.
2. `rg -n "25,?000|30,?000|₹|5%\s*GST|Base Founder|Elite Founder" supabase/functions/_shared/ai-prompt.ts supabase/functions/_shared/ai-agent-brain.ts` returns no functional hits (only historical comments if any).
3. Send test WhatsApp messages via `ai-test-purpose` to +919887601200:
   - "kitna price hai?" → pivot reply, no ₹
   - "annual plan cost?" → pivot reply
   - "6 month membership?" → pivot reply
   - "what facilities do you have?" → normal facility answer, unaffected
4. Confirm guardrail: force model to output "Annual plan ₹25000" via a test purpose and confirm post-guard rewrites to canned pivot and logs `ai_pricing_leak`.

## Out of scope

- Public site copy (`llms.txt`, `llms-full.txt`) — those still list GST language for SEO/AEO and aren't the AI brain. Confirm with user before touching.
- Campaign templates, WhatsApp Meta-approved templates — user did not request.
