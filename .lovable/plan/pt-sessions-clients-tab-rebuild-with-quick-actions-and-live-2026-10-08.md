# PT Sessions → Clients tab: rebuild with quick actions and live sync

## What the live data shows today
- 21 active PT packages. **4 of them still belong to Ritesh Sharma, who is inactive.** The tab doesn't flag this, so the members look fine while nobody is coaching them.
- 6 active packages have a bill that's still unpaid or part-paid. The tab shows them as plain "Active".
- Sessions left match completed sessions on every package (no counting errors).
- 6 expired packages and 1 reversed package exist, but the tab only shows active ones, so staff can't see who recently finished or who needs a renewal.
- The "Cancel invoice" action always sends ₹0 paid and "pending" status, whatever the real bill says.

## What we'll build

### 1. Status filters along the top (chips with live counts)
All · Needs trainer · Payment due · Expiring in 7 days · Low sessions (≤2) · Expired (last 30 days). Click a chip to filter the list. "Needs trainer" and "Payment due" are shown in warning colours so problems stand out.

### 2. Clearer rows
- Member (avatar, name, member code) · Package · Trainer (with an "Inactive" badge in red when the trainer has left) · Progress ring · Expiry with days left · Payment badge (Paid / Part-paid ₹X due / Unpaid) · Status.
- Click any row to open that member's profile drawer.

### 3. Quick actions per row (menu, plus one main button)
- The main button changes with the problem: **Change trainer** when the trainer is inactive, **Collect payment** when money is due, **Renew** when the package is expiring or low on sessions, otherwise **Schedule**.
- The menu has: Schedule session (member and trainer filled in), Change trainer (opens the new transfer drawer), Collect payment (opens the existing payment drawer for that bill), Renew, View member, Cancel invoice (owner/admin only, using the real bill amounts).

### 4. Group action
In the "Needs trainer" view, a **Transfer all to…** button opens the transfer drawer with every package already selected. This handles Ritesh's 4 clients in one step.

### 5. Keeping everything in sync
- After a transfer, payment, renewal, booking or cancellation, the list, the summary cards at the top, Today's sessions and payroll all refresh straight away.
- The list also refreshes live when a package, PT session or bill changes elsewhere, for example when a payment arrives from Razorpay.
- Loading placeholders, an error message with a Retry button, and a clear empty message for each filter.

### 6. Design and accessibility
Uses the existing rounded card style and colours. Headers stay visible when you scroll, buttons are at least 44px tall, filter chips work with the keyboard, and table headers are labelled for screen readers. On phones, each row becomes a card with the same actions.

## Technical notes
- `fetchActiveMemberPackages` (ptService): accept statuses `active`, `pending_payment` and `expired` (last 30 days only); join `trainers.is_active` and the invoice's `status`, `total_amount` and `amount_paid`; extend `PTMemberPackageRow` with `trainer_active`, `invoice_status`, `invoice_total`, `invoice_paid`, `due`.
- `ClientsTable.tsx`: rewritten with filter chips (counts built from the rows), a per-row primary action picker, mobile card layout, and row clicks opening `MemberProfileDrawer`. Remove the broken trainer-only filter that uses `as any` (trainers can't open this page anyway).
- `PTSessions.tsx`: connect the schedule drawer with member and trainer filled in, `TransferPTClientsDrawer` (one or many packages; add a `packageIds` prop), the existing payment drawer, and send the real bill amounts to cancel-invoice. Add live refreshes for `member_pt_packages`, `pt_sessions` and `invoices` using `useRealtimeInvalidate` (topics get random suffixes).
- Shared refresh helper that invalidates `active-member-packages`, `member-pt-packages`, `trainer-sessions`, PT stats and payroll keys.
- No database changes. Branch filtering stays as it is.

## Verification
- On live data: "Needs trainer" shows exactly Ritesh's 4 packages, and "Payment due" shows the 6 unpaid ones with the right amounts due.
- Transfer one package and confirm it leaves "Needs trainer" without reloading the page, and the payroll preview matches.
- Check the page in the browser as owner and as front-desk staff, on desktop and phone width, with no console errors.
