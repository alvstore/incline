# Fix: PT Package purchase — trainer selection, commission preview, trainer conversion

## What's wrong today (verified)

- SAHIBA MEHNDIRATTA (INC-26-0100) has **no assigned trainer** in the database (`assigned_trainer_id` is empty).
- The Purchase PT Package drawer has **no trainer picker at all**. It silently reads the member's general-training trainer and, when there is none, falls back to a hard-coded **20% share** — that's how "trainer commission (preview) ₹1,600.00" appeared with nobody selected. The number is fiction.
- Because no trainer is assigned, the drawer also blocks the sale ("Assign a trainer to this member before purchasing"), forcing staff to leave, assign a trainer elsewhere, and come back.
- The purchase routine on the server accepts a trainer and pays commission to them, but it **never promotes that trainer to the member's assigned trainer**. So a member coached generally by trainer A who buys PT with trainer B keeps A on their profile.

## What we'll build

### 1. Trainer selection inside the drawer
- Add a required **Trainer** field at the top of the drawer (searchable select of active trainers in the branch, showing name, current client load and their PT share %).
- Pre-select the member's existing assigned trainer when there is one; otherwise it starts empty.
- Remove the dead-end "Assign a trainer to this member" warning — the picker replaces it. The Charge button stays disabled until a trainer is chosen.

### 2. Honest commission preview
- Commission preview only renders once a trainer is selected, and always uses **that trainer's own share %** (no 20% fallback).
- The preview line shows the trainer's name and the rate used, e.g. "Bhagirath Gurjar · 20% of ₹8,000 taxable = ₹1,600.00".
- With no trainer selected it shows "Select a trainer to see commission" instead of a number.

### 3. Convert general trainer → personal trainer on purchase
- When the selected trainer differs from the member's current assigned trainer, the drawer shows an inline notice: "Bhagirath Gurjar will replace <current> as this member's trainer."
- On a successful purchase the member's assigned trainer is switched to the PT trainer **inside the same server transaction**, so the profile, trainer dashboards and client counts stay consistent. An audit entry records the change (who, when, from → to).
- A small "Keep current trainer for general training" toggle lets an owner/admin/manager opt out of the switch in the rare case they want them separate.

### 4. Design pass on the drawer (house rules)
- Group the drawer into clear sections: Trainer → Package → Schedule & tax → Payment, each on a `rounded-2xl` card with a quiet uppercase section label.
- Commission and totals move into one sticky summary block above the footer so the money is the loudest element.
- Trainer picker gets a proper `<label>`, keyboard focus ring, and 44px touch targets; loading state uses skeletons matching the trainer rows.

## Technical notes

- `src/components/pt/PurchasePTPackageDrawer.tsx`: new `trainerId` state seeded from `members.assigned_trainer_id`; new query for active branch trainers with `pt_share_percentage` and profile names; `trainerShare` derived from the selected trainer with no default; `commissionPreview` returns `null` when no trainer; `_trainer_id` passed from state; the idempotency draft key includes the trainer so switching trainers mints a fresh key.
- Database migration: extend `purchase_pt_package` / `_purchase_pt_package_impl` with `_reassign_member_trainer boolean default true`; when true and `_trainer_id` differs, `UPDATE public.members SET assigned_trainer_id = _trainer_id` plus an audit-log insert. Existing callers keep working via the default.
- Trainer list query is branch-scoped and respects existing RLS; commission math still comes from `generate_pt_commission` server-side — the drawer number is preview only.
- Nothing else about pricing, GST (5% inclusive / exempt) or the payment flow changes.

## Verification

- Open the drawer for SAHIBA (no trainer): confirm no commission number until Bhagirath Gurjar is picked, then ₹ preview matches his share.
- Complete a purchase and confirm the member's profile now shows Bhagirath as trainer, the commission ledger row points at him, and the invoice/GST split is unchanged.
- Re-run the purchase for a member who already has a different general trainer and confirm the replace notice, the switch, and the opt-out toggle.
