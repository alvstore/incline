# AI Lead-Enquiry Architecture — Full Audit & Fix (NO DEPLOY)

Status: survey started (file sizes + policy reference map collected). No code changed yet.

## Facts collected so far
- ai-agent-brain.ts (3084 L): `PRICING_MENTION_RE = PRICING_LEAK_RE` alias at L1997; `sanitizeFoundersPhaseText` at L1999 already uses detectPriceContext/visitPivotReply (verify fully).
- ai-prompt.ts (426 L): imports COMMERCIAL_POLICY_BLOCK + SALES_PSYCHOLOGY_BLOCK (pushed at L387-388) — verify old refusal/VIP-tour blocks removed.
- runUnifiedAgent referenced by: whatsapp-webhook, meta-webhook, rcs-webhook (audit rcs-webhook too!), handoff.ts, pricingPolicy.ts, ai-prompt.ts.
- pricingPolicy.test.ts exists (13 tests).

## Audit/fix checklist (from user message — 22 items)
1. [ ] Remove duplicated commercial policy in brain (PRICING_MENTION_RE alias / old sanitizer path / VIP-tour refusals).
2. [ ] sanitizeFoundersPhaseText: userText + history + detectPriceContext/visitPivotReply; preserve member/handoff/non-fitness guards.
3. [ ] CRITICAL: split "policy phrase" vs true commercial-value leak. PRICING_LEAK_RE must not flag compliant replies containing "price"/"pricing". Build value-leak detector (amounts, ₹, plan names/tiers/durations, discounts, GST/MRP, session counts). Keep defense-in-depth.
4. [ ] CRITICAL: hydrateGymFacts — lead/unknown mode must get NO plan names/durations/prices/fees/session counts. Explicit member vs lead separation.
5. [ ] CRITICAL: audit MCP list_membership_plans (src/lib/mcp/tools/) + any webhook/agent path to membership-plan tools; gate out for lead/unknown.
6. [ ] ai-prompt.ts: replace refusal-style lead objectives + "pricing blackout + VIP tour" protocol with COMMERCIAL_POLICY_BLOCK + visit-conversion objective. No forced name→email→goal→plan ladder for high intent.
7. [ ] Context resolver v2 flag (default OFF): audit runtime wiring; enable production setting safely (settings row branch_id NULL key whatsapp_context_resolver_v2) after verifying migration/config deps; keep kill switch.
8. [ ] Full webhook audit both ingresses (signature, verify endpoint, dedupe, echoes, phone normalization, context.id correlation, bot pause/handoff, claim locks, error logging, background processing, runUnifiedAgent call). Same policy for WA + IG.
9. [ ] meta-webhook → whatsapp-webhook forwarding: no double processing/double AI reply/signature mismatch/lost errors.
10. [ ] Final outbound path: block commercial values; allow operational numbers (address/phone/date/time/24x7/facility specs).
11. [ ] Identity routing lead vs member vs staff — members never in visit funnel; staff/vendor/non-fitness guards intact.
12. [ ] Memory/context reuse — no funnel restarts, no re-asking known name/goal/email.
13. [ ] leadCapture.ts promotion/write-through + status/activity intact.
14. [ ] handoff.ts + hallucinated-action safeguards (no fake bookings/callbacks/notifications).
15. [ ] ai-dispatcher.ts: policy provider-independent across fallback.
16. [ ] Outbound/nurture/campaign reply paths honor commercial policy for leads (not member workflows).
17. [ ] ai_knowledge: archive contradictory VIP-tour/pricing rows; add categories: pricing_policy, visit_conversion, sales_objections, visit_faq, incline_differentiators, lead_intent_signals.
18. [ ] match_ai_knowledge: HARD POLICY wins; filter/sanitize stale pricing knowledge for lead prompts.
19. [ ] source_data rendering in ai-prompt.ts — leads must not receive commercial values from source_data.
20. [ ] Deno test suite: all listed scenarios (price asks EN/Hinglish x4, high-intent+price, location, facilities, member commercial Q, opt-out, visit intent, comparisons, objections, PT, differentiators, known name+goal, retrieved-knowledge-leak, membership_plans-not-in-lead-context, campaign-originated, prior price explanation, no CRM ladder for high intent).
21. [ ] Regression tests: word "price"/"pricing" allowed; amounts/plan data blocked.
22. [ ] Tests for context resolver flag + webhook routing (no live Meta creds).

## Before finishing
- [ ] Run Deno tests + `deno check` on edge functions; frontend tsgo typecheck if touched.
- [ ] Review final diff for contradictory old logic.
- [ ] DO NOT DEPLOY. Report: findings by severity, files changed, tests run, knowledge/migration changes, remaining risks, exact deploy steps.
