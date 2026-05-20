# IG Comment-to-DM — Human Review Approval UI

## Audit finding

The **"Require human review before sending"** toggle on the campaign drawer saves `human_review=true` on `ig_comment_campaigns`, but it is currently a **dead switch**:

1. `supabase/functions/_shared/ig-comment-automation.ts` (line 222) inserts every matched run with `status='pending'` — it never checks `human_review`.
2. `supabase/functions/process-ig-comment-runs/index.ts` (line 319) picks up everything `in ('pending','scheduled')` and sends immediately.
3. There is **no UI** to view, approve, edit, or reject a pending DM. `IgRunsLogDrawer` is read-only (status badges + a Retry button for failed/skipped).

Net effect today: turning the toggle ON changes nothing — DMs still auto-fire.

## Plan

Wire the toggle end-to-end with a new `awaiting_review` status, an executor skip, and a dedicated approval queue inside the Comment-to-DM section.

### 1. Database migration

- Extend `ig_run_status` with `awaiting_review`.
- Add columns on `ig_comment_runs`:
  - `dm_draft text` — snapshot of the rendered DM the reviewer will approve.
  - `reviewed_by uuid`, `reviewed_at timestamptz`, `review_decision text`, `review_notes text`.
- Index `(branch_id, status, created_at desc)`.
- New RPC `approve_ig_run(p_run_id, p_decision, p_notes, p_edited_body)`:
  - Capability check via `has_capability('manage_communications')`.
  - Approve → write edited body back to `dm_draft`, flip status to `pending` (or `scheduled` if `delay_seconds>0`) so the existing cron picks it up.
  - Reject → status `skipped`, `skip_reason='rejected_by_reviewer'`, optional notes.

### 2. Edge function changes

- `_shared/ig-comment-automation.ts`: when `campaign.human_review === true` and no `skip_reason`, render the DM body now, store in `dm_draft`, and insert with `status='awaiting_review'`.
- `process-ig-comment-runs`: already only processes `pending`/`scheduled`, so `awaiting_review` is naturally held. Add a bump comment + version stamp.
- On `awaiting_review` insert, also enqueue a `notifications` row (category `lead`, action_url to the approval queue) so staff get the bell alert. Reuse existing notification pattern — no new edge function.

### 3. UI — Approval Queue

In `src/components/ig-automations/IgAutomationsPanel.tsx`:

- **KPI strip** at top: gradient indigo Vuexy card "Awaiting Review · N" with CTA "Open queue". Visible only when count > 0.
- **Per-campaign amber pill** "N awaiting review" on each campaign card; click filters the queue to that campaign.

New `IgApprovalQueueDrawer.tsx` (right-side `Sheet sm:max-w-2xl`):

- Filter chips: All campaigns / Specific campaign.
- For each pending run, a Vuexy card:
  - Header: campaign name · IG username · matched keyword · `formatDistanceToNow` age.
  - Quoted comment text.
  - **Editable textarea** pre-filled with `dm_draft` + char counter.
  - Buttons: **Approve & Send**, **Reject** (with reason chips: off-topic / spam / duplicate / other + free text).
  - Lead link if present, link to original IG post.
- Bulk: row checkboxes + sticky footer "Approve all visible" / "Reject all".
- Loading skeleton, empty state ("No DMs waiting — relax"), error fallback.
- Optimistic updates via TanStack Query; invalidate `['ig-approvals', branchId]` and `['ig-runs', campaignId]`.

`IgRunsLogDrawer.tsx`: add amber `awaiting_review` badge style (`ShieldAlert` icon).

### 4. Service / hooks (`src/services/igAutomationService.ts`)

- `useIgPendingApprovals(branchId, campaignId?)` — query awaiting runs.
- `useApproveIgRun()` / `useRejectIgRun()` — call the new RPC with optimistic update + toast.

### 5. Types (`src/types/igAutomations.ts`)

- Extend `IgRunStatus` with `"awaiting_review"`.
- Add `dm_draft`, `reviewed_by`, `reviewed_at`, `review_decision`, `review_notes` to `IgCommentRun`.

### 6. RBAC

- Queue visibility + RPC restricted to `manage_communications` capability (owner / admin / manager). Staff who don't have it see nothing.

### 7. Out of scope

- Keyword matching, daily cap, cooldown, AI tool registry — unchanged.
- Public comment replies — not gated (the toggle is for DMs only, matching current copy).
- No new edge function; reuses `process-ig-comment-runs` cron.

## Files touched

- **New migration** (enum value, columns, index, `approve_ig_run` RPC).
- **New** `src/components/ig-automations/IgApprovalQueueDrawer.tsx`.
- **Edit** `src/components/ig-automations/IgAutomationsPanel.tsx`, `IgRunsLogDrawer.tsx`.
- **Edit** `src/services/igAutomationService.ts`, `src/types/igAutomations.ts`.
- **Edit** `supabase/functions/_shared/ig-comment-automation.ts` (respect `human_review`, snapshot `dm_draft`, queue notification).
- **Edit** memory `mem://features/ig-comment-to-dm-automation` to document the review flow.

## Acceptance checks

- Toggle ON → next matched comment lands in `awaiting_review`; no DM sent.
- Approve → DM goes out within one cron tick (≤60s); run flips to `sent`.
- Reject → run flips to `skipped` with `rejected_by_reviewer`; counters not bumped.
- Bell notification fires when a new run needs review.
- Roles below manager cannot see the queue or call the RPC.
