
## Audit findings

**GST today (PT):**
- `pt_packages.gst_percentage` (default 18) + `pt_packages.gst_inclusive` are the source of truth.
- `PurchasePTPackageDrawer` reads these and uses `computePtCheckout()` in `src/lib/payments/ptCheckout.ts`. There is no "no GST" path — `gstPct=0` is technically possible but not exposed as a clean toggle, and `AddPTPackageDrawer` forces a numeric input that snaps back to 18 on blur.
- Org-level rates live in `organization_settings.gst_rates` (`TaxGstSettings.tsx`, `useGstRates`) — currently unused by PT drawers.

**Commission today:**
- `trainers.pt_share_percentage` (default 20–40 depending on migration) drives the cut.
- `purchase_pt_package` RPC computes `_commission_amount = _price_paid * rate / 100`. `_price_paid` is whatever the client passes — currently the GST-inclusive total from the drawer. That over-pays the trainer when GST is on, and the commission base is inconsistent across catalog vs custom.
- Monthly packs amortise across `duration_months`; session packs book one lump on sale. Both work, but both inherit the wrong base.

**Trainer-side attendance today:**
- `log_pt_session` RPC exists and correctly handles both modes (decrements for session-based, validates expiry for monthly). It is **not wired into any UI** — `TrainerDashboard.tsx` and `MyClients.tsx` only show stats. Trainer has no button to mark a PT session attended.
- Gym check-in attendance (table `attendances`) is separate from PT session attendance (`pt_sessions`). Today a PT session does not also write a gym check-in for the member.

## Plan

### Epic 1 — GST toggle for PT (catalog + checkout)

1. **`AddPTPackageDrawer` / `EditPTPackageDrawer`**
   - Add a `gst_enabled` Switch above the GST % input. When OFF: hide % + inclusive controls, persist `gst_percentage = 0`, `gst_inclusive = false`.
   - Replace the free-text GST % input with a Select driven by `useGstRates()` (org-configured rates, default 5/12/18/28). Default to 18 when toggled on.
   - Update the live breakdown to read "GST not applied" when disabled.

2. **`PurchasePTPackageDrawer`**
   - Sticky checkout bar: add **"Charge GST"** Switch (Vuexy pill). Default = the package's stored value (`gstPct > 0`). When the staff flips it OFF for a single sale, force `gstPct=0` in the breakdown.
   - In **Custom Builder**: same toggle + same `useGstRates` Select.
   - Pass a new explicit `gstPct` and `gstInclusive` snapshot in `custom`/selected breakdown to `computePtCheckout` (already supports `gstPct=0`).

3. **`computePtCheckout` (no change needed)** — already returns `tax=0` when `gstPct=0`. Keep math single-source.

### Epic 2 — Commission base = subtotal, GST-aware

1. **`purchase_pt_package` RPC** (new migration):
   - Add two parameters: `_subtotal numeric` and `_tax_amount numeric` (both optional, default `NULL`).
   - Compute commission base: `COALESCE(_subtotal, _price_paid)` — i.e. honour the GST-stripped subtotal when the client provides it; fall back to legacy behaviour for old callers.
   - Persist `subtotal` and `tax_amount` onto `member_pt_packages` (add columns) so reports show the true sale base.
   - Keep the amortised monthly schedule logic; just amortise the new base.

2. **`ptService.purchasePTPackage`** + drawer call site:
   - After `computePtCheckout`, pass `subtotal` + `tax` into the RPC.
   - `price_paid` continues to equal `total` (what staff actually collects).

3. **`TrainerEarnings` + `TrainerDashboard`**:
   - No formula change — they read `trainer_commissions.amount`, which is now correctly net-of-GST.
   - Add a tiny "Commission base: net of GST" tooltip on the earnings KPI for transparency.

### Epic 3 — Trainer-side attendance (both modes)

1. **New trainer UI: "Mark Today's Session" panel** on `TrainerDashboard.tsx`
   - Card lists today's assigned PT clients (active `member_pt_packages` with `trainer_id = me`) using existing `fetchActiveMemberPackages(branchId)` filtered client-side.
   - Each row: member name + package badge (`PtPackageBadge` already built) + **"Mark Attended"** primary button + notes popover.
   - Clicking calls `logPtSession({ packageId, trainerId, notes })` via `ptService.logPtSession`. Toast on success showing "Sessions left: X" (session-based) or "Days left: X" (monthly).

2. **Gym attendance side-effect** (the "respect both attendance" requirement)
   - Extend `log_pt_session` RPC: after inserting `pt_sessions`, also INSERT a row into `attendances` for that member + branch + `check_in_at = now()` **only if** the member doesn't already have an attendance row for today. Source = `'pt_session'` so reports can distinguish.
   - This means trainer marking a PT session also satisfies daily gym check-in. No duplicates.

3. **`MyClients.tsx`**: add the same "Mark Attended" inline action per client row.

4. **Member side (`MyPTSessions.tsx`)**: no UI change — existing `PtStatusHero` reads `sessions_remaining` / `expiry_date` which the RPC already updates.

### Epic 4 — QA

- Vitest cases for `computePtCheckout`: `(10000, 0, false)` → subtotal 10000, tax 0, total 10000.
- Manual test matrix:
  - Catalog session pack, GST 18 ON → commission base = 10000, not 11800.
  - Catalog monthly pack, GST OFF at checkout → invoice shows ₹10000, no tax line; trainer monthly amortisation totals 10000 × rate.
  - Custom pack, GST OFF → no GST shown anywhere.
  - Trainer clicks "Mark Attended" on session pack at 1 remaining → row flips to `completed`, package status = completed.
  - Trainer clicks "Mark Attended" on monthly pack past expiry → toast error "Package expired".
  - Attendance side-effect: marking PT session creates a single `attendances` row for the day; second click same day does not duplicate.

## Files

**New**
- `supabase/migrations/<ts>_pt_gst_commission_attendance.sql` — adds `member_pt_packages.subtotal`, `tax_amount`; new `purchase_pt_package` overload with `_subtotal`, `_tax_amount`; extends `log_pt_session` to write `attendances`.
- `src/components/pt/TrainerTodayPanel.tsx` — today's clients + Mark Attended.

**Edited**
- `src/components/pt/AddPTPackageDrawer.tsx`, `EditPTPackageDrawer.tsx`, `PurchasePTPackageDrawer.tsx` — GST toggle + org rate Select.
- `src/services/ptService.ts` — pass `subtotal`/`tax` to RPC; thin wrapper for `logPtSession` (already exists, verify signature).
- `src/pages/TrainerDashboard.tsx` — mount `TrainerTodayPanel`.
- `src/pages/MyClients.tsx` — inline Mark Attended button.
- `src/integrations/supabase/types.ts` — regen after migration.
- `mem://features/pt-dual-mode` — append GST toggle + attendance side-effect rules.

## Technical notes (for reviewer)

- `purchase_pt_package` will get a new overload (`uuid,uuid,uuid,uuid,numeric,text,text,numeric,numeric`) to avoid breaking existing 7-arg callers. Old overload kept; new client always calls the new one.
- The attendance side-effect uses an idempotency guard: `WHERE NOT EXISTS (SELECT 1 FROM attendances WHERE member_id=... AND check_in_at::date = CURRENT_DATE)`.
- GST = 0 is treated as "GST not applicable", not "0% GST line" — invoice generators already skip the tax row when `tax_amount = 0`.
- No change to `trainers.pt_share_percentage` semantics; commission is still % of the new (net) base, so 40% on a ₹10,000 sale = ₹4,000 whether GST is on or off.

