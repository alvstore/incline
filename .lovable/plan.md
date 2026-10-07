# Response to the 6-point security report (checked live)

## What the live database shows

| # | Report claim | Live result | Action |
|---|---|---|---|
| 1 | Backend URL + public key hardcoded in code | True, but this key is meant to be public: it has no admin rights, and the row security rules decide what it can reach. Every web app ships it to the browser. That file is generated automatically and can't be edited. | No code change. Keep the GitHub repo Private. Changing the key wouldn't help, because the new key would be just as visible in the browser. |
| 2 | Payment gateway keys readable by members | False. Only owners and admins can read `integration_settings`. A member's request comes back empty. | Optional hardening: the member checkout stops reading that table at all and only gets the provider name from the server. |
| 3 | `purchase_member_membership` has no guard and accepts ₹0 | Already fixed. It now checks who is calling, members can only buy for themselves with amount paid forced to 0 (pending invoice), and anonymous users can't run it. | Re-test as a member only. |
| 4 | `book_facility_slot` doesn't check the caller | **Real, and worse than reported.** The function never checks who is calling. A signed-in member can: (a) book for any other member and use up their sessions, (b) pass any admin's ID as "staff" with force-add on and skip credits, maintenance, schedule and gender rules. | **Fix now** (see below). |
| 5 | Memberships table has no insert block for members | False. Insert, update and delete each have staff/management-only rules. Members can only read their own rows. | None. |
| 6 | Member purchase drawer skips payment check | Covered by #3: the server ignores what the member's browser says was paid. The membership stays pending until a verified Razorpay payment settles the invoice. | None beyond the re-test. |

## Fix for #4: booking function caller check

Add a check at the start of `book_facility_slot`, without changing its signature, so the app and WhatsApp/concierge keep working:

- If the caller is a signed-in user:
  - **Staff of that branch** (owner/admin/manager/staff/trainer): allowed. The staff identity is always the real signed-in user, never the value sent in.
  - **Member**: `p_member_id` must be their own member record. Force-add and staff ID are rejected, and the source must be `member_portal`.
  - Anyone else: refused.
- Service/system calls (WhatsApp AI, concierge, crons) keep working as they do today.
- Force-add privilege is checked against the real caller, not `p_staff_id`.
- Membership check: `p_membership_id` must belong to `p_member_id`, be `active`, and have `end_date >= today`, unless an authorised staff member force-adds it.
- Keep `EXECUTE` limited to signed-in users and the service role. Anonymous users are already blocked.

## Verification (live, after approval)
1. Sign in as the test member (INC-26-0014) and try these, each must be refused: book for another member; force-add using an admin's ID as staff; book with someone else's or an expired membership.
2. As the same member, a normal booking for themselves still works and uses one session (then cancel it to give the session back).
3. Staff booking from the admin screen still works.
4. WhatsApp/concierge booking still works (service call).
5. As a member, try `purchase_member_membership` with ₹0: it must create only a pending invoice, not an active membership.

## Technical notes
- One migration: `CREATE OR REPLACE FUNCTION public.book_facility_slot(...)` with an `auth.uid()` / `auth.role()` caller block. It resolves the caller's member record via `get_member_id(auth.uid())`, checks branch staff via the existing `is_staff_or_system()` and branch-visibility helpers, and sets `p_staff_id := auth.uid()` for staff.
- Optional #2 hardening: `fetchActiveGateway` in `paymentService.ts` returns only `provider` and drops `config`. The member checkout already gets the Razorpay key from `create-payment-order`.
- Generated files stay untouched (client config, types, env).
