# Fix: access restore after payment, retry queue controls, Instagram AI, template hub

## 1. Sachin Jain (INC-26-0082) — access not restored on MIPS after paying

Verified in the database:
- Invoice BOS-INC-26-0001 is `paid` (₹25,000 / ₹25,000) and `members.hardware_access_status` is already back to `active` with reason "Payment settled".
- **There is no MIPS push for this member** — `mips_sync_attempts` has zero rows for him, so the turnstile still holds the revoked validity (`2000-01-01`).
- Root cause: the trigger `tg_sync_hardware_access_to_mips` (on `hardware_access_events`) only ever calls `mips-access` with `action: 'sweep_expired'`. That sweep revokes overdue people; it has no restore path. It also resolves `v_branch_id` from `members`/`invoices` only, so on `hardware_access_events` the branch is always NULL and the sync secret falls back to the global row.

Fix:
- Rewrite the trigger to read `NEW.branch_id` / `NEW.member_id` from `hardware_access_events` and call `mips-access` with a targeted action — `restore_access` when `new_status = 'active'`, `revoke_access` when blocked/revoked — instead of a blanket sweep.
- Add a `restore_access` path in `mips-access` that recomputes the member's real validity window (membership `end_date`, plus free/frozen day adjustments) and pushes `validTimeStart` / `validTimeEnd` to every bound device using the same full-detail-fetch + read-back verification already used for revocation.
- Keep `sweep_expired` as the safety net, and extend it to also *restore* members whose status is `active` but whose device state still shows the revoked date.
- Run the restore immediately for INC-26-0082 and verify the read-back shows the membership end date.

## 2. Retry Queue — "Stop all" / "Clear exhausted" do nothing

Verified: `communication_retry_queue` has only SELECT and UPDATE policies for `authenticated`. There is **no DELETE policy**, so "Clear exhausted" deletes 0 rows and PostgREST returns success with an empty array — the UI shows no error and the 37 rows come straight back. "Stop all" also skips `exhausted` rows by design, so the badge never drops below 37.

Fix:
- Migration: add a DELETE policy on `communication_retry_queue` for owner/admin/manager (same `has_any_role` predicate as the existing policies) and confirm grants.
- UI (`RetryQueuePanel.tsx`): treat a 0-row result as a failure and surface a clear toast instead of "Nothing to clear"; include `exhausted` in the Stop-all scope (cancel + clear) so the header count actually reaches zero; show the returned row count.
- Also fix the underlying spam source visible in the queue: `132001 Template does not exist in this WABA`, `no_template_for_closed_session`, and `template_param_empty:member_name` rows should be written as terminal `failed` with a readable label rather than re-queued.

## 3. Instagram inbound messages get no AI reply

Verified: `ai_purposes.whatsapp_reply.ops_config.channels` is
`{"whatsapp":{"enabled":true},"instagram":{"enabled":false},"messenger":{"enabled":false}}`.
`runUnifiedAgent` short-circuits with `channel_instagram_disabled`, so every IG DM (including @__rishabh._m asking about membership plans) is ingested and then silently dropped. Story replies are separately off (`instagram_story_reply_enabled: false`).

Fix:
- Turn the Instagram (and Messenger) DM channel on in `ai_purposes`.
- Make the state visible instead of silent: surface the per-channel toggles in the AI Agent settings with an explicit "Instagram DM auto-reply is OFF — inbound DMs will not be answered" warning banner, and show the skip reason on the conversation in the inbox so an operator can see *why* nothing was sent.
- Story replies stay off unless you want them on (they are noisy) — say the word and I will enable them too.
- Backfill: run the brain once against the currently unanswered IG threads from today so those leads get a first reply.

## 4. Communication Templates — double filter bar + cannot submit "Missing / Stale"

Verified:
- `TemplateManager` renders a `STATUS:` chip row (All / Approved / Pending / Rejected / Draft) *and* `TemplateTable` renders its own row (All / Ready / Missing-Stale / Header Mismatch / Pending) plus a second search and a second "Add Template" button — that is the doubled UI in the screenshot.
- `handleSubmitToMeta` hard-blocks with "Please select a specific branch before submitting to Meta" whenever the branch filter is `all`. With the WhatsApp integration stored as a global row, submitting from the hub in All-Branches mode always fails, which is why the 37 "missing in Meta" templates cannot be pushed.

Fix:
- Merge the two filter rows into one toolbar: a single search, one status/alignment segmented control, one "Add Template" action, with the Meta sync controls grouped to the right (Vuexy chips, `rounded-2xl` card, existing tokens).
- Resolve the branch for Meta submission the same way the dispatcher does — selected branch, else the global integration row — and only error when no WhatsApp integration exists at all.
- Add a bulk "Submit missing to Meta" action on the Missing/Stale filter that submits the filtered set with a per-template progress and error list, so the 37-template backlog can be cleared in one pass.

## Technical notes

- Migration: DELETE policy on `communication_retry_queue`; rewritten `tg_sync_hardware_access_to_mips`.
- Edge functions: `mips-access` gains `restore_access` + restore branch in `sweep_expired` (version bump, read-back verification retained).
- Data change (insert tool): `ai_purposes.ops_config.channels.instagram.enabled = true`.
- Frontend: `RetryQueuePanel.tsx`, `TemplateManager.tsx`, `TemplateTable.tsx`, AI Agent settings channel toggles.
