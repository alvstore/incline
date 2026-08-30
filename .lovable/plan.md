# Voice AI Operations Module

A new operational dashboard for the existing Sarvam Voice AI backend. Settings → Integrations keeps configuration; the new module is for day-to-day call operations. No calling logic is duplicated, and retention automation stays OFF.

## What exists today (verified)

- `voice_call_attempts` already stores branch, member/lead, phone, agent id/version, provider call + interaction id, status, disposition, duration, start/end, error code/message, `reason`, `eligible_at`, `eligibility_snapshot`, and `context_payload` (which holds the transcript, `final_agent_variables` such as `call_summary`, `reason_for_absence`, `next_step_agreed`, `callback_datetime`, and channel info).
- RLS on `voice_call_attempts`: owner/admin see everything; everyone else is limited to their visible branches.
- Edge function `sarvam-voice` already exposes `get_state`, `get_readiness`, `run_eligibility_check`, `test_call`, plus config actions, all owner/admin gated.
- `sarvam-voice-webhook` already writes outcomes and creates tasks for callback / complaint / needs-human, and marks DND for wrong-person.

So the module is mostly a read layer over existing data plus a small amount of server-side access work.

## 1. Navigation and route

- Add `Voice AI` (`/voice-ai`) to the Communication / Operations & Comm menu section next to Communication Hub, for owner, admin, manager, staff.
- Register the route in `App.tsx` behind `ProtectedRoute` with those roles, and map `/voice-ai` into the `marketing` module in `navModules.ts`.
- Settings → Integrations → Voice AI is untouched.

## 2. Server-side access layer (no new tables)

Transcripts and raw provider context must not reach staff, and row-level RLS cannot hide one JSON column. Two security-definer RPCs:

- `voice_calls_feed(p_branch, p_from, p_to, p_status, p_disposition, p_search, p_limit, p_offset)` — returns the flattened call list (member name/code, masked phone, branch, days absent at call, duration, status, disposition, reason for absence, next step, summary, callback time, action state). Redacts phone to masked form and omits transcript for staff. Enforces the same branch scope as RLS via `user_visible_branch_ids`.
- `voice_call_transcript(p_attempt_id)` — returns the transcript only for owner/admin/manager within scope; staff receive a denial.

Both are `security definer`, `search_path = public`, granted to `authenticated` only, and re-check role and branch inside the function.

Action-required state (Open / In progress / Completed) is derived from the linked task in the existing `tasks` table, not a new column — the webhook already creates those tasks. Where a call has no linked task (older rows), the drawer offers "Create follow-up task" using the existing task service.

## 3. Dashboard page (`src/pages/VoiceAI.tsx`)

Header: provider Sarvam, agent name/version, calling number, calling window, daily cap, readiness badge (READY / ACTION REQUIRED / BLOCKED) from the existing `get_readiness` action. No secrets rendered.

KPI cards: today's calls vs daily cap, connected, completed, coming back, callbacks, complaints, DND requests, no answer — all counted from `voice_call_attempts` for the day.

Tabs:
- **Today's Queue** — rendered from the existing `run_eligibility_check` result only; the UI performs zero eligibility maths. Statuses: Eligible, Scheduled, Calling, Completed, Skipped, Cooldown, DND, Blocked. No "Call now" button; a "Retry via backend gate" action is only shown to owner/admin and routes through the existing `sarvam-voice` guarded action.
- **Call History** — filter by date range, branch, status, disposition, days absent, assigned staff, action required; search by name, member code, phone.
- **Callbacks** — calls with `callback_requested`, joined to their existing task rows for assignee and status.
- **Complaints** — `disposition = complaint`, joined to the manager task.
- **DND** — members/leads flagged do-not-contact with source and date, read-only.
- **Analytics** — attempted, connected, completion / coming-back / callback / complaint / DND / no-answer rates over 7 / 30 / 90 days, plus returned-within-7 and returned-within-14 computed by joining `member_attendance` after the call date. Nothing estimated.

## 4. Call detail drawer

Right-side Sheet (per the no-dialog rule) with member block, retention context, call timings and provider attempt id, outcome variables, and a transcript section collapsed by default that fetches `voice_call_transcript` on expand for authorized roles only.

## 5. Outcome badges

Shared `src/lib/voice/voiceOutcomes.ts` mapping backend values (`coming_back`, `callback_requested`, `not_interested`, `wrong_person`, `complaint`, `needs_human`, `no_clear_outcome`, `no_answer`, `failed`) to labels and badge tokens. Stored values are never rewritten.

## 6. Member profile integration

Add a Voice AI block to the existing communication area of the member profile showing date, reason, outcome, next step; clicking opens the same call detail drawer component. No duplicate profile surface.

## 7. Notifications

Extend the existing webhook's follow-up block to also insert rows into the existing `notifications` table for callback requested, complaint, human follow-up, wrong number, and DND request — routed to the same staff the task targets. No new notification system.

## 8. Realtime

Subscribe to `voice_call_attempts` via the existing Supabase realtime + `useRealtimeInvalidate` hook so history and live call status refresh without reload.

## Safety guarantees

- No frontend path calls Sarvam directly; everything goes through `sarvam-voice`.
- DND, cooldown, window, cap, concurrency, and eligibility remain backend-owned and untouched.
- Retention automation stays disabled; this change does not enable or schedule any member calls.

## Testing

Role scoping (owner / admin / manager / staff), transcript denial for staff, masked phone, DND and cooldown rows non-callable from the UI, history reflecting webhook updates, callbacks and complaints resolving to existing tasks, member profile history, absence of any key or token in the client bundle, plus typecheck, build, lint of changed files, and a security scan of the new RPCs.

## Deliverable

Files changed, the single migration adding the two RPCs, reused APIs, role behaviour, tests run, and remaining blockers will be reported at the end.
