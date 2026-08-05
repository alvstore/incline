# Add-On Packages: enum fix, member visibility, and a proper buy/book experience

## What the audit found (all verified against the live database)

**1. The "sauna" enum error is a code bug, not a missing enum value.**
`AddBenefitPackageDrawer` saves `benefit_type` by copying the benefit type's *code* straight through (`enumValue = selected?.code`). The branch's benefit type codes are `steam_room`, `ice_bath`, `3d_body_scanning`, `sauna`, `locker_access`, plus two merged female variants. Of those, only `ice_bath` exists in the database `benefit_type` enum — so every other benefit type fails to save with a 400. A safe mapper (`safeBenefitEnum` in `src/lib/benefitEnums.ts`) already exists but this drawer never calls it, and it is missing the newer values (`body_scan`, `posture_scan`).

**2. Members literally cannot see any add-on package.**
The read policy on `benefit_packages` is:
`is_active AND (branch_id IS NULL OR branch_id IN (SELECT user_visible_branch_ids(auth.uid())))`
and `user_visible_branch_ids` only returns branches for owners/admins or rows in `staff_branches`. A member has neither, so the query returns zero rows — which is exactly the "No benefit add-on packages configured for this branch" empty state in the screenshot. The one real package (Cold Plunge Recovery, INCLINE branch) is active and correctly configured; it is being hidden by row-level security.

**3. Descriptions are being clipped.**
Both the store card and the purchase drawer render the description with `line-clamp-2` and collapse newlines, so the multi-paragraph benefit copy shows as a single truncated line.

**4. The purchase RPC ignores the GST configured on the package.**
`purchase_benefit_credits` writes `subtotal = total_amount = price` with no tax split, even though packages carry `tax_rate`, `tax_inclusive`, `hsn_code` and `gst_category`. Add-on invoices will therefore never reconcile against the 5% GST rules the rest of the system enforces.

**5. There is nowhere to store safety terms/precautions** for sauna and ice bath — `benefit_types` has no such column — so nothing can be shown before purchase or booking.

## The fix

### Database
- Extend the `benefit_type` enum with the values the catalog actually needs (`sauna`, `steam_room`, `body_scan_service`) *or* keep the enum stable and rely on the code mapper — we will do the latter, since `benefit_type_id` is already the real link and the enum is only a coarse bucket.
- Replace the `benefit_packages` read policy so members can see active packages at their own branch (resolved via `get_member_id()`/the member's `branch_id`), keeping the existing staff/owner scope intact.
- Add `safety_notes text` and `terms text` to `benefit_types` so precautions and conditions live next to the service.
- Update `purchase_benefit_credits` to honour `tax_rate` / `tax_inclusive`: split the package price into subtotal + tax on the invoice, carry `hsn_code` onto the invoice item, and keep the total equal to the price the member was shown.

### Admin (Membership Plans → Benefit Add-On Packages)
- `AddBenefitPackageDrawer`: map the selected benefit type's code through a corrected `safeBenefitEnum` before insert/update, defaulting GST to 5% (project standard) instead of 18%.
- Extend `src/lib/benefitEnums.ts` with the full valid enum list and a code→enum alias map (`sauna` → `sauna_access`, `steam_room` → `steam_access`, `3d_body_scanning` → `body_scan`, `locker_access` → `locker`, merged female variants → their base type).
- Add a Safety & Terms section (precautions, conditions) editable per benefit type from the same admin surface.

### Member experience
- `AddOnShowcase` (Member Store) and `EligibleAddOns`: keep the compact card, but move the full description, session count, validity and price breakdown into the purchase drawer instead of clipping it on the card. Render description text with preserved line breaks.
- `PurchaseAddOnDrawer` (member mode): redesign the benefits tab as selectable package cards showing credits, validity, price incl. GST, existing credit balance, a "Before you go" precautions panel for sauna/ice bath, and a required acknowledgement checkbox before the buy button enables.
- After purchase: show the invoice reference, credits added and expiry date, with a direct "Book a slot" action into `/book`.
- Expiry and reminders: surface remaining credits and days-to-expiry on the member dashboard benefit cards, using the existing credits query.

### Verification
- Create a Sauna Therapy package from the admin drawer — saves without a 400.
- Sign in as a member at INCLINE: Cold Plunge Recovery appears in the store, full description reads correctly, purchase creates an invoice with a 5% GST split and credits with the right expiry.
- Booking the purchased credit at `/book` decrements it; a maintenance-locked facility still blocks the booking.
