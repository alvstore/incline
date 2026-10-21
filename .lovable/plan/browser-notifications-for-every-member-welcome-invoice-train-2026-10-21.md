# Browser notifications for every member: Welcome, Invoice, Trainer

## What I found
- Browser push already mirrors every in-app notification to devices that opted in (Monika Jain, INC-26-0223, has 1 device enabled).
- **Trainer assigned** already works: Monika received "Meet your coach".
- **Welcome**: no member-facing notification exists. The "New Member Registered" alert only goes to staff.
- **Invoice**: a member alert fires only when an invoice is *inserted* as non-draft. Invoices created as draft and later finalised, and payments recorded, never notify the member. Monika has no invoice notification.
- A member whose app login is created after registration misses alerts sent before the login existed.

## What will change
1. **Welcome message** — when a member gets an app login (new registration or login created later), they get "Welcome to Incline" with a link to their dashboard. Sent once per member.
2. **Invoice details** — member is notified when an invoice is issued (including draft → issued) and when a payment is received ("Payment received for invoice INV-…"). Link opens their invoices page. One per invoice event, no duplicates.
3. **Trainer** — keep the existing "Meet your coach"; also send it for PT package trainer assignment if not already covered.
4. **Lock-screen privacy stays**: phone lock screen shows only "You have a new update"; amounts and names are visible after opening Incline.
5. **Respect preferences**: invoice alerts follow "Payment receipts" topic; welcome/trainer are transactional. Quiet hours and Do-Not-Contact still apply.
6. **Monika test**: send her a marked test welcome + latest invoice notification to confirm delivery on her device.

## Technical details
- New migration: `notify_member_welcome(member_id)` called from login provisioning (`members_after_insert_provision_login` path and when `members.user_id` changes from NULL); dedupe via `notifications.metadata->>'event'` + member id.
- Replace `tg_notify_member_on_invoice` with AFTER INSERT OR UPDATE OF status trigger: fires on transition into pending/paid/partial from NULL/draft; separate "payment received" on status → paid/partial. Uses `notify_member` with `action_url='/my-invoices'` and category `billing`.
- Existing `enqueue_web_push` trigger handles device delivery; no worker changes.
- Add a small test for the invoice transition rule (draft→pending notifies, pending→pending does not).
