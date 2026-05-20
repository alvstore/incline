## Audit findings

**Bug 1 — False "Awaiting delivery events"**
`DeliveryTimeline` reads ONLY from `communication_delivery_events`. For many channels (in-app, and any provider that doesn't write per-stage rows), the dispatcher updates `communication_logs.status` / `delivery_status` / `sent_at` directly but never inserts timeline events. Result: even messages that are `sent`/`delivered`/`read` show the amber "Awaiting…" card. The parent log already proves delivery — we just aren't using it.

**Bug 2 — Row overlap in Live Feed**
In `LiveFeed.tsx` the row button is `flex items-center gap-3` with the right-side status column + chevron rendered as siblings of `flex-1 min-w-0`. The right column has no `flex-shrink-0` on the chevron wrapper and the inner header uses `flex-wrap` which lets the WhatsApp pill wrap up next to the timestamp on narrow widths, visually colliding with the message line shown in the screenshot. Long single-line messages also push the right column because the row itself lacks `overflow-hidden`.

**Bug 3 — Visual polish**
- Timeline shows `HH:mm:ss` per stage but `queued` is rarely emitted as an event, so its timestamp is blank. We have `created_at` — use it.
- Awaiting card kept for the rare truly-pending case but needs to be a true *pending* state, not the default for already-delivered messages.

## Fix plan

### 1. `DeliveryTimeline.tsx` — synthesize stages from the log row
Accept new props: `logStatus`, `logDeliveryStatus`, `logSentAt`, `logCreatedAt`, `logErrorMessage`.

After fetching `communication_delivery_events`, build a merged event list:
- If events table has rows → use them as today.
- If empty → derive a synthetic chain from the log row:
  - Always add `queued` at `created_at`.
  - If resolved status ∈ {`sent`,`delivered`,`read`,`replied`} → add `sent` at `sent_at ?? created_at`.
  - Add the highest reached stage (`delivered`/`read`/`replied`) at `sent_at ?? created_at`.
  - If `failed`/`bounced` → add failed stage with `error_message`.
- Only render the amber "Awaiting" card when synthetic chain has just `queued` (i.e. log status is still pending/queued AND no events).

Reuse existing `normalizeStatus` logic (lift a small helper into a shared file or duplicate locally — small enough to duplicate).

Also: for the `queued` dot show `created_at` so the first pill no longer reads blank.

### 2. `LiveFeed.tsx` — row layout hardening
- Pass the extra props to `<DeliveryTimeline />`: `logStatus={log.status}`, `logDeliveryStatus={log.delivery_status}`, `logSentAt={log.sent_at}`, `logCreatedAt={log.created_at}`, `logErrorMessage={log.error_message}`.
- Row button: add `overflow-hidden` to the outer button, wrap right-side status+timestamp column in `flex-shrink-0 ml-auto`, and add `flex-shrink-0` to the chevron container.
- Header line inside the row: remove `flex-wrap`; keep name truncating, render recipient + channel pill as `flex-shrink-0` so they never wrap onto the message line.
- Message paragraph: keep `truncate`; add `pr-2` so it doesn't kiss the status column.
- Ensure parent row container has `min-w-0` chain intact (`flex-1 min-w-0` → inner `min-w-0`).

### 3. Polish (no behaviour change)
- Awaiting card copy: when log status is `pending` show "Waiting for provider acknowledgement"; when `queued` keep current copy. Subtle but more accurate.
- Replace ping animation tint on Awaiting with a softer amber/20 to match Vuexy palette.

## Out of scope
- KPI strip, channel tabs, search bar, pagination footer (already redesigned).
- Backend / `communication_delivery_events` writes.
- Other Communication Hub tabs.

## Files touched
- `src/components/communications/DeliveryTimeline.tsx`
- `src/components/communications/LiveFeed.tsx`

## Verification
- Open Live Feed → an in-app or already-delivered WhatsApp row should now show the full 5-stage timeline (queued → sent → delivered, with `created_at` and `sent_at` timestamps) instead of the amber "Awaiting…" card.
- Long messages and the WhatsApp pill should stay on one line each; status column stays right-anchored with no overlap at 1113px and at 375px mobile.
- A genuinely brand-new pending row (no `sent_at`, status `pending`, no events) still shows the Awaiting card.

Used the ui-ux-pro-max skill for layout audit.