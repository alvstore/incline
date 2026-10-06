# AI Lead-Enquiry Architecture — Full Audit & Fix (NO DEPLOY)

## Member mobile experience (2026-10-04)
- [x] Replace sample-data `/mobile-preview` with a member-only, real-data `/member-app` hub; remove gate pass and simulated interactions. Old URL redirects to the member route.
- [x] Connect live class/recovery booking, store/add-ons, diet/workout plans, feedback, requests, and account information to existing member workflows (no duplicate booking or purchase logic).
- [x] Audit login/recovery; retain the email/mobile login and email-reset flow. Add a signed-in password-change sheet to the member profile and hub, plus existing avatar upload and editable profile details.
- [x] Verify as a real member at 375, 768, 1024, and 1440 widths; check linked routes and no browser page errors. No booking, purchase, password mutation, or feedback submission performed during visual verification.
- [ ] Native Android APK/AAB and iOS TestFlight/App Store delivery requires a separate Expo/React Native project. This Vite web implementation is not a native app and cannot be packaged directly as one.

## MIPS restart incident
- [x] Pause face sweep, personnel delta sync, and device reconciliation.
- [ ] Complete and verify cold-standby backup — manual dump ran, but parity still reports 209 tables and 10 buckets drifting.
- [x] Harden all background dispatch paths and deploy.
- [x] Validate queue volume with workers paused — 6 successful targeted attempts and no retry storm in the latest 6-hour window.
- [ ] Re-enable workers one at a time only after the gates remain stable and the recovery mirror reaches parity.

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

# Renewal Center + HOWBODY recovery (approved 2026-09-11)
- [x] Harden body/posture webhooks and tracked delivery retries.
- [x] Add idempotent HOWBODY recovery/status RPCs and repair Rehan's completed assessment.
- [x] Improve member/staff scan report visibility and delivery states.
- [x] Add Renewal Center queue, atomic staff actions, analytics, and configuration.
- [x] Link renewal cases to Voice AI outcomes while keeping the engine disabled.
- [x] Replace the legacy Follow-Up renewals action with the Renewal Center.
- [x] Verify RLS, app build, report deliveries, completed sessions, and no duplicate credit usage.

# Multi-Slot Recurring Class Engine (Parent-Child) — 2026-09-20
- [x] DB: class_types (parent) + class_templates (rules) + session columns on `classes` (template_id, session_date, shift_type, booked_count, cancel meta), unique (template_id, session_date)
- [x] DB: generate_class_sessions() (30-day horizon, ON CONFLICT DO NOTHING) + template/type propagation triggers + booked_count trigger
- [x] DB: cancel_class_session / override_class_session / reinstate_class_session / delete_class_template RPCs; harden book_class + cancel_class_booking (dup-key upsert, authz, benefit release)
- [x] Automation Brain rule `generate_class_sessions` (daily 03:00 IST)
- [x] Edge fn `notify-class-session` → dispatch-communication (session cancelled / trainer or time changed) on enabled channels
- [x] Admin: Class Manager (types + AM/PM rules) + Master Calendar with per-session override/cancel — src/pages/admin/ClassManager.tsx
- [x] Member: /classes timetable grouped Morning → Afternoon → Evening with Slots left / Class Full — src/pages/public/Classes.tsx
- [x] Announce flow: class type / session → Campaign wizard prefill on enabled channels
- [x] Verify: build, Playwright admin rule → generated sessions → member booking → cancel notice

# MIPS gate restart incident — root cause + storm controls (2026-09-21)
- [x] Root cause (server logs + MIPS MySQL): one purchase txn fired up to 8 parallel mips-access calls per member (31 gate jobs for one member in 4 min) → terminal app restarts. Not Tomcat.
- [x] DB: coalesced `evaluate` enqueue (one call per member per txn), per-member lock RPCs, echo-suppressed hardware-state RPC; member triggers rerouted.
- [x] mips-access v2.15.0: evaluate action, derive revoke/restore from committed state, per-member lock + rerun, every gate command logged to mips_sync_attempts. Deployed + verified (3 enqueues → 1 invocation, no-op).
- [x] Watchdog v1.2.0: fixed IST-as-UTC heartbeat parse (why it said "Stable 24h"), heartbeat age vs roster fetch time, `dispatch_storm` + `heartbeat_gap` events, gate's real last-beat stored. Deployed + live run clean.
- [x] Gate watchdog card: storm/gap badges + descriptions.
- [ ] Rotate the MIPS server SSH password (shared in chat during the incident).
- [ ] MIPS MySQL: 61 authorization jobs stuck at push_status=1 today — confirm with vendor whether stuck jobs keep the terminal busy; consider clearing via MIPS UI.
- [ ] Optional: mips-access sweep could pace per-member evaluates across the roster (currently per-gate slot throttle only).

## Browser notifications + Team WhatsApp Inbox — 2026-10-06
- [x] Add secure opt-in Web Push subscriptions and event-driven delivery for existing in-app alerts.
- [x] Add enable/disable and test controls with iPhone home-screen and permission states.
- [x] Verify signed-in configuration, permission-blocked UI, service-only delivery controls and live Team Inbox access; adoption guide: `docs/browser-notifications.md`.
- [ ] Verify real phone subscription and OS test delivery; sandbox Chromium denies notification permission.
