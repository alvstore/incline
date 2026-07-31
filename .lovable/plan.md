## Verified findings

- **Invoice edit actions already exist** in `src/pages/Invoices.tsx` (Record Payment / Correct Amount / Cancel), but they are gated by `can.cancelInvoice(roles)` where `roles` from `AuthContext` is an array of **objects** (`UserRoleInfo[]`), while `permissions.ts` expects `string[]`. The capability check therefore always returns false — that is why the menu shows only View/Download/Send link/Share.
- **Shoyab aalam (INC-26-0055)**: membership end date is already correct (31 Jul 2026 → 09 Aug 2027 = 365 + 10 days), but the `membership_free_days` ledger row still says **20 days** — so the UI badge "+20d gift" and "375d" are wrong. One ledger row, id `cfffe408…`.
- **`howbody_posture_reports` has no `posture_type` / `body_shape_profile` columns** (confirmed against the live schema). `src/hooks/useHowbodyReports.ts:37` selects them → 400.
- **`assign_locker_with_billing` has two overloads, and both reference `item_type`**, a column that does not exist on `invoice_items` (verified column list) → locker assignment fails.
- **Void Payment uses `AlertDialog`** in `src/pages/Payments.tsx` (violates the side-drawer standard for multi-field forms).
- **Members list** orders only by `created_at desc` (`src/pages/Members.tsx:152`); no relevance/membership-aware ordering after search.

## Plan

### 1. Unlock invoice editing (root cause fix)
- Add a shared `useRoleNames()` (or normalize inside `permissions.ts` `hasCapability` to accept `string[] | {role}[]`) so every `can.*` call works regardless of shape. Normalizing inside `permissions.ts` fixes all pages at once.
- Verify the same gating bug isn't silently hiding actions elsewhere (grep `can.` usages passing `roles`).
- Result: Owner/Admin/Manager see **Record Payment · Correct Amount · Cancel Invoice** on every invoice row, including paid ones. `CorrectInvoiceDrawer` already supports amount + GST adjustment with payment reconciliation.

### 2. Gift/benefit days: data fix + editing UI
- Data: update Shoyab's ledger row from 20 → 10 days (end date stays 09 Aug 2027, already right).
- UI in `MemberProfileDrawer` active-membership card: each complimentary-days entry gets **Edit** and **Remove** actions (owner/admin only).
- New RPC `adjust_membership_free_days(_free_day_id, _new_days | _delete)` that atomically updates/deletes the ledger row **and** shifts `memberships.end_date` by the delta, writing an audit entry. No client-side multi-step writes.

### 3. Members list ordering
- Default sort becomes: active membership first, then scheduled, then no-membership, then `created_at desc`.
- While a search term is present, order by match relevance (exact code/phone > name prefix > contains), so members without memberships no longer float to the top.

### 4. HowBody posture 400
- Remove `posture_type, body_shape_profile` from the select in `useHowbodyReports.ts` and derive display labels from existing columns (`score`, `body_slope`, `head_forward`, etc.), or drop those fields from the card/drawer types if unused.

### 5. Locker assignment RPC
- Migration: drop the stale 9-arg overload, recreate the 10-arg `assign_locker_with_billing` with the `invoice_items` insert using real columns (`description, quantity, unit_price, tax_rate, tax_amount, total_amount, hsn_code, reference_type, reference_id`) — no `item_type`.

### 6. Void payment → side drawer + Edit for owner/admin
- Replace the `AlertDialog` with a `Sheet` (`VoidPaymentDrawer`) matching the drawer standard.
- For owner/admin, the row action becomes **Edit payment** (amount, method, date, notes, reference) backed by a new atomic `edit_payment` RPC that voids-and-reissues internally so the invoice balance/status stay consistent and the audit trail is preserved. Void remains available inside that drawer as a secondary destructive action; staff/manager keep void-only.

### 7. MIPS photo parity (Gate 1: 41 faces, Gate 2: 31)
- Audit `sync-to-mips`: persons are queued at server level but face images are apparently pushed per-device and partially failing on Gate 2.
- Add a per-device face reconciliation: compare each device's face list against the person list and re-push missing photos; surface a "Photo parity" row per device in `MIPSDashboard` with a **Re-sync photos** button.
- Log per-device failures to `error_logs` via `log_error_event` so gaps are visible instead of silent.

## Technical notes
- All DB changes go through migrations; the gift-days and payment edits are new `SECURITY DEFINER` RPCs restricted to owner/admin via `has_any_role`.
- Ledger correction for Shoyab is a data update, run separately from schema migrations.
