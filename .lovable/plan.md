# Member Portal Alignment Sprint

Audit of the nine reported issues. Each item below names a confirmed cause and the fix.

## 1. Invoice download does nothing (and items are blank)

Two separate defects, both confirmed:

- The "Download" button in the member Invoice Details drawer calls a browser `alert()` with a text summary — no PDF is ever generated.
- Members cannot read `invoice_items` at all: the only access rule on that table is staff-only, so the drawer always shows "No item details available" (matches the screenshot).

Fix: wire the drawer's Download button to the existing shared invoice PDF generator (the same one staff use), with a spinner and error toast. Add a read rule so a member can read the line items of invoices that belong to them.

## 2. No way for a member to record measurements

The measurement capture drawer exists but is only mounted in staff and trainer screens. My Progress is read-only.

Fix: add a "Record measurement" action on My Progress that opens the existing capture drawer in a member-scoped mode (weight, height, body fat, key circumferences, optional progress photos, notes). Photos keep the existing private-bucket + signed-URL handling. Requires a write rule allowing a member to insert their own measurement rows; edits/deletes stay staff-only so history can't be rewritten.

## 3. All plans visible despite being turned off

Confirmed two-part bug:

- The "Visible to members" switch in the Edit Plan drawer is rendered and tracked in form state, but it is **not included in the update payload** — so switching it off never saves. Every plan in the database is still visible.
- The member Plans page never filters on that flag anyway.

Fix: include the flag in the plan update (and confirm it on create), and filter the member-facing plan list to visible + active plans only. The member's own current plan stays visible in the history tab even if hidden from the catalogue.

## 4. Assigned workout plan not visible / not downloadable

Mohit Gurjar (INC-26-0025) has two assigned workout plans in the database. Their content is stored as a **weeks → days → exercises** structure, but My Workout only reads a flat `days` array, so it falls through to "Your trainer is preparing the plan details." Neither row has a stored PDF, so there is nothing to download either.

Fix:
- Render the real structure on My Workout: week selector, day cards, exercise rows (sets / reps / rest / notes), with the flat-`days` shape still supported for older plans.
- Add a Download button that serves the stored PDF when present and otherwise generates it on demand from the same generator used for trainer-side delivery.
- Diet plan: My Diet gets the same treatment plus a clear empty state ("No diet plan assigned yet") with a request action, since none is assigned for this member.

## 5. Logo missing in member portal

The sidebar reads branding from organisation settings, and that table's read rule is limited to owner/admin/manager/staff. Members get nothing back and fall through to the placeholder.

Fix: allow authenticated users to read only the public branding fields (name, logo) while keeping the rest of the settings staff-only.

## 6. Freeze request offered on plans that don't allow it

My Requests always renders the freeze card. Most active plans have a freeze allowance of zero, so members can raise requests that staff must reject.

Fix: hide (or disable with an explanatory note) the freeze request when the member's plan allows no freeze days, and show remaining freeze allowance when it does.

## 7. Booking steam from the portal

The booking flow and slots exist (378 future slots), but the path is not obvious: My Benefits links to a generic "Book a Slot" page rather than the specific entitlement.

Fix: make each entitlement row on the dashboard and My Benefits deep-link straight into the booking page pre-filtered to that benefit, and show the next available slots inline.

## 8. Request Locker has no backend queue

The dashboard's "Request Locker" button links to My Requests, but that page has no locker request option at all, and nothing on the staff side surfaces such requests.

Fix: add a locker request flow (preferred size, notes) writing to the existing approvals table, and surface those requests on the staff Lockers screen with assign / decline actions that route into the existing locker assignment RPC.

## 9. "Change Trainer" shown when no trainer is assigned

The card title already switches to "Request Trainer", but the drawer heading, body copy and the request payload are still trainer-change specific.

Fix: make heading, description, and request type follow assignment state — assignment request when there is no trainer, change request when there is one — and show the current trainer's name when applicable.

## Technical notes

- Frontend: `MyInvoices` / `InvoiceDetailDrawer`, `MyProgress`, `MemberPlans`, `MyWorkout`, `MyDiet`, `MemberRequests`, `MyBenefits`, `MemberDashboard`, `EditPlanDrawer`, `AddPlanDrawer`, staff `Lockers`.
- PDF reuse: `src/utils/invoicePdf.ts` for invoices; existing fitness plan PDF builder for workout/diet.
- Database (single migration): member read access to their own `invoice_items`; member insert of their own measurement rows; authenticated read of public branding fields only. No schema changes needed for plan visibility (`is_visible_to_members` already exists) or locker requests (reuses `approval_requests`).
- All new data access stays branch- and owner-scoped; no widening of staff-only tables beyond the fields listed.
