# Audit & Fix Plan

## 1. `pt_package_type` enum mismatch (BLOCKER)
**Root cause:** Enum values in DB are only `session_based` and `monthly`. Multiple RPCs (`purchase_pt_package` and friends) still compare/insert the legacy string `'duration_based'`. When the column is typed `pt_package_type`, Postgres coerces the literal → `invalid input value for enum pt_package_type: "duration_based"`.

**Affected migrations / functions** (latest wins): `20260518143238_*.sql` (`purchase_pt_package`), `20260517153957_*.sql` (consume function uses `'monthly'` ✓). Code uses `'session_based' | 'monthly'`.

**Fix:** New migration that recreates `purchase_pt_package` (and any sibling helpers) replacing every `'duration_based'` with `'monthly'`. No enum change needed.

## 2. Edge function health audit
Run targeted check across all functions for 502 / 5xx / auth failures over last 24h:
- Sweep `error_logs` (source LIKE 'edge_%' / function_name) and `supabase--edge_function_logs` for: `automation-brain`, `process-ig-comment-runs`, `process-comm-retry-queue`, `process-whatsapp-retry-queue`, `process-scheduled-campaigns`, `meta-webhook`, `whatsapp-webhook`, `send-whatsapp`, `dispatch-communication`, `ai-agent-brain`, `monitor-ai-lead-loss`, `reconcile-*`, `notify-staff-handoff`.
- Current findings from logs already pulled: only real recurring failure is `meta-webhook` rejecting Instagram with `signature_mismatch_likely_wrong_app_secret` (see §5). Brain + retry queues are healthy after recent restart. 502s from previous report were cold-starts (already mitigated with backoff).

**Deliverable:** Markdown audit table in chat (function, last error, count, severity, action). No code changes unless a real bug surfaces — then patch individually.

## 3. `Empty reply from AI` fallback (+91 63784 32550)
Single occurrence (info-level). Add structured logging in `ai-agent-brain.ts` to capture: model used, prompt token estimate, finish_reason, raw response length, retrieved KB size — so the next occurrence is debuggable instead of a one-liner. Also auto-resolve the warning after 1h if no repeat (same pattern as brain heartbeats).

## 4. Edge function failure sweep
Same scope as §2; output will list any function with error rate > 0 in last 48h. Will additionally check `supabase--linter` for security/perf warnings.

## 5. Meta API `(#132001)` + IG signature mismatch
**(#132001)** = "Template name does not exist in the translation". Audit:
- Cross-check every `template_name` used in `send-whatsapp` payloads against `whatsapp_templates` rows where `status='APPROVED'` and `language` matches.
- Log the exact template+lang on each failure (currently swallowed).
- UI: WhatsApp Templates page — add badges showing **Meta status**, **language**, and a red "Not found in Meta" pill when our DB has a template Meta doesn't recognise. Add "Resync from Meta" button that calls a new `meta-sync-templates` edge fn (lists templates via Graph API, upserts status).

**IG signature mismatch** in `meta-webhook`: `META_APP_SECRET` in secrets doesn't match the app subscribed to the IG webhook. Surface a clear banner in Integrations → Meta UI when last 10 webhooks all rejected with `signature_mismatch`, with "Update App Secret" CTA opening the secret editor.

## 6. Email — two pipelines collision
We currently have BOTH:
- Lovable Cloud built-in email (auth + `send-transactional-email` queue) — recommended.
- A self-rolled `dispatch-communication` → custom SMTP/Resend path for member/CRM mail.

**Plan:**
- Keep `dispatch-communication` as the single CRM/marketing path (it already handles preferences, dedupe, quiet hours).
- Route **auth emails** (signup/recovery/magiclink) through Lovable Cloud only.
- Add a routing rule in `dispatch-communication`: if `category='auth'` → reject (must go through auth hook); else use existing provider chain.
- Audit `email_send_log` for duplicate sends (same recipient + same subject within 60s) and report.
- No domain change — we keep `notify.theincline.in`.

## 7. End-to-end testing playbook (using skills)
Add `docs/qa-playbook.md`:
- **Unit / component:** Vitest + RTL on critical hooks (`useAttendance`, `useWallet`, `usePTPackages`) and drawers.
- **Edge fn:** Deno tests for `dispatch-communication`, `purchase_pt_package` RPC via `supabase--test_edge_functions`, `ai-agent-brain` deterministic-fallback test.
- **Integration:** seed script → run `automation-brain` once → assert downstream rows.
- **E2E (manual checklist):** member self-onboarding → membership purchase → PT purchase (both `session_based` & `monthly`) → check-in → benefit booking → invoice PDF → WhatsApp delivery.
- **Smoke cron:** `healthz` + DR readiness page.
- **Load:** k6 script hitting `register-member` and `whatsapp-webhook`.

## Files to touch (build phase)
- New migration: fix `purchase_pt_package` ('duration_based' → 'monthly').
- `supabase/functions/_shared/ai-agent-brain.ts` — richer empty-reply logging + auto-resolve.
- `supabase/functions/dispatch-communication/index.ts` — auth-category guard + dup-window check.
- New edge fn: `meta-sync-templates`.
- `src/components/settings/whatsapp/WhatsAppTemplatesTab.tsx` (or equivalent) — Meta status pills + Resync button + IG-secret banner.
- `docs/qa-playbook.md` (new).

## Out of scope (this sprint)
- Rewriting WhatsApp template editor UX beyond status badges + resync.
- Switching email provider.

## Open questions
1. For Meta IG webhook — should I auto-disable the IG integration when 10+ signatures fail, or only show a banner?
2. Email auth-category guard: hard-reject or silently re-route to the auth queue?
3. Do you want the k6 load script wired into CI, or local-only?
