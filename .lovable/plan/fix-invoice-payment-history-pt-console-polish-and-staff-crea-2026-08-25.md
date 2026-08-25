# Fix invoice payment history, PT console polish, and staff-created welcome messages

Three follow-ups from the last round, verified against the live database and code.

## 1. Invoice drawer shows voided payments as if they were real

Invoice BOS-INC-26-0042 lists two ₹15,000 payments. One is `completed`, one is `voided` — the drawer renders every payment row identically in green, so it looks like the member paid twice.

Changes in `src/components/invoices/InvoiceViewDrawer.tsx`:
- Show a status chip on each payment row (Paid / Voided / Refunded) using the existing `reversalLabel()` helper from `src/lib/payments/paymentDisplay.ts` — void is never labelled "refund".
- Render voided rows muted with a strikethrough amount so they read as history, not money received.
- Add a line under the list: "Counted toward this invoice: ₹X" summing only non-voided payments.
- Item descriptions for PT packages currently render the raw idempotency key; fall back to the package name (or a readable "Personal Training — <plan>") when the description looks like a generated key.

## 2. PT Coaching Console polish

`src/components/pt/TodaySessionsPanel.tsx` and `ClientsTable.tsx`:
- Replace initials-only circles with real member/trainer photos (`Avatar` + `AvatarImage`, initials as fallback), matching the attendance grid which already loads avatars.
- Show a dues indicator on the clients table so a trainer can see at a glance that a client is behind on payment.
- Remove the dead `filteredSessions` memo in `TodaySessionsPanel` (it returns the input unchanged in both branches); trainer scoping already happens in the parent query.
- Add missing `SheetDescription` on PT drawers that lack one to clear the Radix "Missing Description" console warnings.

## 3. Welcome messages never send for staff-created members

Confirmed root cause: when a member is added from the admin UI, `create-member-user` calls the `onboard_member` database function with welcome scheduling on. That function only **inserts a row into `communication_logs` with status `pending`** — nothing ever dispatches it. The public `/register` flow is unaffected; it calls the dispatcher directly.

Fix:
- Stop writing the fake pending log row from `onboard_member` (migration to update the function).
- After a successful onboard, `create-member-user` dispatches the welcome through `dispatch-communication` with `event_key: member_created` on WhatsApp + Email (same variables as the register flow), so it goes through templates, preferences, pacing and retry like every other message.
- Clean up the orphaned `pending` welcome rows already sitting in `communication_logs`.

## Technical notes

- Files: `src/components/invoices/InvoiceViewDrawer.tsx`, `src/components/pt/TodaySessionsPanel.tsx`, `src/components/pt/ClientsTable.tsx`, `supabase/functions/create-member-user/index.ts`, plus one migration for `public.onboard_member`.
- No schema changes; the migration only replaces the function body.
- `create-member-user` will be redeployed after the edit.
