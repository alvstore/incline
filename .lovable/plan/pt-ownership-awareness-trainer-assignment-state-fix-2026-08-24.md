# PT ownership awareness + trainer assignment state fix

## What's actually happening (verified in the database)

SAHIBA MEHNDIRATTA (INC-26-0100) **does** have a PT package with Bhagirath — but its status is `pending_payment`, not `active`. Two consequences today:

- The profile drawer only looks for `status = 'active'`, so it shows a plain **Buy PT** button and a **0 PT Sessions** tile. Nothing tells staff a package already exists and is awaiting payment — that's exactly how a second package gets sold.
- Her `assigned_trainer_id` **is** set to Bhagirath in the database, but the profile drawer passes the *list-row* copy of the member into the Assign Trainer drawer instead of the freshly-fetched detail record, so the button can read "Assign Trainer" and the drawer can open with nothing preselected.

## What we'll change

### 1. PT state instead of a blind "Buy PT" button
The button becomes state-aware, driven by all of the member's PT packages (not just active ones):

| Member's PT state | Button | Behaviour |
|---|---|---|
| No package ever | Buy PT | unchanged |
| Package `pending_payment` | Complete PT Payment | opens that invoice; a secondary "Sell another" is behind a confirm |
| Package `active` | Manage PT / Add Sessions | opens purchase drawer in "additional package" mode with a warning |
| Expired / exhausted | Renew PT | pre-selects the previous trainer and package |

A small PT status strip sits under the KPI tiles: package name, trainer, status badge (amber = awaiting payment, emerald = active, slate = expired), sessions remaining and expiry — so the situation is visible before anyone clicks.

### 2. Duplicate-sale guard in the purchase drawer
When the drawer opens it loads the member's existing PT packages. If an `active` or `pending_payment` one exists it shows a blocking notice at the top ("Bhagirath Gurjar · Monthly PT · awaiting payment since 20 Aug") with two choices: **Open existing invoice** or **Sell an additional package anyway** (owner/admin/manager only; members self-serving are blocked outright). The Charge button stays disabled until that choice is made. The same rule is enforced server-side in `purchase_pt_package` so an API-level retry can't slip a duplicate through.

### 3. Assign General Trainer preloads correctly
- The profile drawer passes the resolved `assignedTrainerId` (detail record, falling back to the list row) to both the button label and the drawer, so "Change Trainer" and the preselected radio are always right.
- The drawer keeps the selection in sync if the trainer id arrives after open, marks the current trainer with a "Current" badge pinned to the top of the list, and hides the "Recommended" upsell when a trainer is already assigned.
- It also shows a read-only line when the member has a PT trainer: "Personal trainer for PT sessions: Bhagirath Gurjar" — with a hint that PT purchases can promote that trainer to general trainer.

### 4. Design pass (house rules)
Status is always a coloured badge, never plain text; the PT strip is a `rounded-2xl` card with a quiet uppercase label; trainer rows get 44px touch targets, visible focus rings and skeleton loading; the duplicate-sale notice uses the amber warning treatment rather than a toast.

## Technical notes

- `MemberProfileDrawer.tsx`: derive `ptState` from `memberDetails.member_pt_packages` (active → pending_payment → latest expired precedence); replace the hardcoded Buy PT button and the `activePTPackage`-only tiles; pass `assignedTrainerId` (already computed at line ~849) to `AssignTrainerDrawer` and the button label.
- `PurchasePTPackageDrawer.tsx`: new query for the member's non-terminal packages; `duplicateAck` state gating `canSubmit`; role check via `can.X(roles)`.
- `AssignTrainerDrawer.tsx`: sync effect on `currentTrainerId` changes (not just `open`), sort current trainer first, add PT-trainer context row.
- Migration: `purchase_pt_package` / `_purchase_pt_package_impl` gain `_allow_duplicate boolean default false`; raise a clear exception when an active/pending package exists and the flag is false. Existing callers pass the flag from the drawer.
- No change to pricing, GST, commission or the payment flow.

## Verification

- Open Sahiba's profile: PT strip shows Bhagirath · awaiting payment; primary action reads "Complete PT Payment"; Assign Trainer button reads "Change Trainer" and the drawer opens with Bhagirath selected.
- Try to sell her a second package: blocked until "Sell an additional package anyway" is confirmed; the RPC rejects the call without the flag.
- A member with no PT package still sees the plain Buy PT flow, unchanged.
