# Voice AI Operations Module

A new operational dashboard for the existing Sarvam Voice AI backend. Settings → Integrations keeps configuration; the new module is for day-to-day call operations. No calling, eligibility, DND, cooldown, callback, or complaint logic is duplicated, and retention automation stays OFF.

## What exists today (verified)

- `voice_call_attempts` stores branch, member/lead, phone, agent id/version, provider call + interaction id, status, disposition, duration, start/end, error code/message, `reason`, `eligible_at`, `eligibility_snapshot`, and `context_payload` (transcript, `final_agent_variables` including `call_summary`, `reason_for_absence`, `next_step_agreed`, `callback_datetime`, plus channel/provider metadata).
- RLS on `voice_call_attempts`: owner/admin see everything; everyone else is limited to `user_visible_branch_ids`.
- `sarvam-voice` already exposes `get_state`, `get_readiness`, `run_eligibility_check`, `test_call` and config actions, owner/admin gated.
- `sarvam-voice-webhook` already writes outcomes, creates callback/complaint/needs-human tasks, and marks DND for wrong-person.

The module is a read layer over this data plus a server-side sanitized access layer.

## 1. Navigation and route

- Add `Voice AI` (`/voice-ai`) to the Communication / Operations & Comm menu group for owner, admin, manager, staff; map it into the `marketing` nav module.
- Register the route in `App.tsx` behind `ProtectedRoute` with those roles.
- Settings → Integrations → Voice AI stays untouched as the configuration surface.

## 2. Server-side sanitized access layer (no new tables)

`context_payload` is never selected by the client. The client loses direct table access for this feature and reads through three security-definer RPCs. Each one: resolves `auth.uid()` itself, resolves role via the existing role helpers, resolves branch scope via `user_visible_branch_ids`, ignores/rejects any `p_branch` outside that scope, never trusts caller-supplied role or filter values, runs with `set search_path = public`, and returns only role-appropriate columns. Grants go to `authenticated` only.

**`voice_calls_feed(p_branch, p_from, p_to, p_status, p_disposition, p_search, p_limit, p_offset)`**
Returns flattened rows only: `id, created_at, member_id, lead_id, member_name, member_code, masked_phone, branch_id, branch_name, days_absent_at_call, call_started_at, call_ended_at, duration_seconds, status, disposition, reason_for_absence, next_step_agreed, call_summary, callback_datetime, action_state, provider_attempt_id, interaction_id`. No `context_payload`, no credentials, no arbitrary provider metadata.
- `p_search` matches member name, member code, and the real stored phone server-side; only the returned phone is masked. Search is applied after branch scoping so it cannot widen visibility.
- `p_branch NULL` → all authorized branches. `p_branch` set → verified against the caller's scope, otherwise treated as unauthorized.
- Ordering `call_started_at DESC NULLS LAST, id DESC`; `p_limit` clamped to a maximum (default 50, max 200); offset non-negative.

**`voice_call_detail(p_call_id)`**
Re-verifies role and branch scope for that single row, returns the sanitized member/retention/call/outcome projection, and returns transcript content only for roles permitted by the existing privacy model (owner/admin/manager). Staff receive summary, reason for absence, next step and disposition — never the raw transcript or provider payload.

**`voice_calls_analytics(p_branch, p_from, p_to)`**
Server-side aggregation under the identical scoping rules: attempted, connected, completed, no answer, failed, and counts per disposition (`coming_back`, `callback_requested`, `complaint`, `not_interested`, `wrong_person`, `needs_human`, `no_clear_outcome`) plus DND requests. Nothing is aggregated in the browser.

Action-required state is derived from the linked row in the existing `tasks` table — no new column, no new table.

## 3. Dashboard page (`src/pages/VoiceAI.tsx`)

Header: provider Sarvam, agent name/version, calling number, calling window, daily cap, and readiness badge (READY / ACTION REQUIRED / BLOCKED) from the existing `get_readiness` action. No secrets rendered anywhere.

KPI cards: today's calls, connected, coming back, callbacks, complaints, DND, shown as `X / <cap>` where the cap is read from the backend configuration state — never hard-coded.

Tabs:
- **Today's Queue** — rendered strictly from the existing `run_eligibility_check` result; the UI computes no eligibility. Statuses: Eligible, Scheduled, Calling, Completed, Skipped, Cooldown, DND, Blocked. No "Call now" button anywhere; no frontend path can reach Sarvam.
- **Call History** — server-side filtering and pagination through `voice_calls_feed`. Filters: date range, branch, status, disposition, days absent, action required. Search: member, member code, phone. Columns: member, branch, last visit, days absent, call date/time, duration, status, disposition, reason, action.
- **Callbacks** — reads the existing webhook-created tasks; never creates a second task for a callback that already has one.
- **Complaints** — reads the existing complaint tasks and their assignee/status.
- **DND** — read-only view of the existing DND state, labelled "DND requested" / "DND active", with no bypass affordance.
- **Analytics** — from `voice_calls_analytics` over 7 / 30 / 90 days. "Returned within 7 / 14 days" is computed by cross-referencing real `member_attendance` rows after the call date; `coming_back` is reported separately as a stated intention, never as a return.

## 4. Call detail drawer

Right-side Sheet (per the no-dialog rule) fed by `voice_call_detail`: Member, Retention context, Call information, AI outcome, Action required, and a Transcript section collapsed by default that renders only when the RPC returned transcript content for that role.

## 5. Outcome badges

Shared `src/lib/voice/voiceOutcomes.ts` maps backend values (`coming_back`, `callback_requested`, `not_interested`, `wrong_person`, `complaint`, `needs_human`, `no_clear_outcome`, `no_answer`, `failed`) to labels and badge tokens. Stored values are never rewritten.

## 6. Member profile integration

A Voice AI block in the existing member profile communication area showing date, call reason, disposition, reason for absence, next step; clicking opens the same sanitized detail drawer. No duplicate member surface.

## 7. Notifications and audit

- Extend the existing webhook follow-up block to also insert rows into the existing `notifications` table for callback requested, complaint, human follow-up, wrong number, and DND request, targeting the same staff as the task. No second notification system.
- Sensitive operational actions (task/callback state change, DND display action, transcript access) go through the existing audit infrastructure (`audit_logs` / `log_error_event` patterns). No second audit system.

## 8. Realtime

Subscribe to `voice_call_attempts` through the existing realtime + `useRealtimeInvalidate` hook so history and active-call status refresh without reload. Active call state comes from the stored attempt rows, not frontend-only state.

## Source of truth (unchanged)

Eligibility, DND, cooldown, calling window, daily cap and concurrency stay in `sarvam-voice` and the existing claim mechanism; member/lead records, attendance, tasks and call outcomes stay where they are. The UI only presents and manages authorized operational information.

## Testing

Owner/admin branch visibility; manager and staff cannot retrieve another branch by passing `p_branch`; staff cannot reach `context_payload` by any path; unauthorized `voice_call_detail` access denied; phone search works while the returned phone stays masked; deterministic pagination and limit clamping; empty states; analytics respect branch scope; callbacks and complaints resolve to existing tasks; DND uses the existing mechanism; member profile history renders; no provider secret or tool token in the client bundle; no manual call bypass exists; Sarvam retention automation remains OFF; existing CRM behaviour unchanged; typecheck, build, lint of changed files, and a database security scan.

## Deliverable

Files changed, the single migration adding the three RPCs, RPC contracts, RLS/security changes, APIs reused, role behaviour, tests performed, and remaining blockers.
