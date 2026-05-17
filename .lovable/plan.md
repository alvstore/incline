# PT Dual-Mode — Finalization Plan

Three remaining workstreams to close out the dual-mode PT epic without breaking existing flows.

## Epic 1 — Commission base = pre-GST subtotal

**Problem:** `purchase_pt_package` currently computes trainer commission on `_price_paid` (GST-inclusive total). When GST is enabled, trainers get over-paid by the GST rate.

**Fix (single migration, additive):**
- Extend `purchase_pt_package` RPC with two new optional params: `_subtotal numeric DEFAULT NULL`, `_tax_amount numeric DEFAULT NULL`.
- Inside the function: `_commission_base := COALESCE(_subtotal, _price_paid)`; commission = `_commission_base * trainer.pt_share_percentage / 100`.
- Persist `subtotal` and `tax_amount` columns on `member_pt_packages` (nullable, default NULL — backward compatible).
- Monthly amortisation unchanged (still splits commission across `duration_months`).
- Old callers that don't pass `_subtotal` keep existing behavior — zero regression risk.

**Frontend:**
- `PurchasePTPackageDrawer` already computes `subtotal` + `tax` via `computePtCheckout`. Pass both into the RPC call in `ptService.purchasePackage`.

## Epic 2 — Global GST toggle audit (read-only audit + targeted fix)

**Scope:** Audit only — do NOT change membership/store flows unless they're already broken. The user's intent is PT-specific GST exemption.

Files to audit:
- `MembershipPurchaseDrawer` / membership checkout — confirm it reads `gst_percentage` from plan and doesn't hardcode 18%.
- Store/POS checkout — confirm it honors per-item `gst_percentage`.
- `useGstRates` hook — confirm presence and correct rate list.

Action: If audit finds a hardcoded 18% in membership or store, fix in same migration; otherwise document the audit result in memory and skip. **No new toggles added to membership/store unless user explicitly asks** (avoids scope creep).

## Epic 3 — Sync & dedup checks

**Attendance dedup:** `log_pt_session` already inserts `member_attendance` with idempotency guard (one per member per day). Verify guard query uses `(member_id, branch_id, date_trunc('day', check_in_at))` — add a partial unique index if missing to prevent race conditions.

**TrainerTodayPanel ↔ MyClients dedup:** Both call `log_pt_session`. RPC is the single source of truth — already correct, no change.

**Receipt dispatch:** Confirm `pt_session_logged` event fires exactly once per RPC call (not once per UI) by emitting from the RPC return path in `ptService.logSession`, not from each component.

## Epic 4 — QA pass

**Vitest cases** for `src/lib/payments/ptCheckout.ts`:
- `computePtCheckout(10000, 0, false)` → subtotal 10000, tax 0, total 10000
- `computePtCheckout(10000, 18, false)` → subtotal 10000, tax 1800, total 11800
- `computePtCheckout(11800, 18, true)` → subtotal 10000, tax 1800, total 11800 (inclusive)
- `computePtCheckout(10000, 5, false)` → subtotal 10000, tax 500, total 10500

**Manual test matrix** (document in mem):
| Scenario | GST | Expected commission base |
|----------|-----|-------------------------|
| Session pack, GST off | — | price_paid |
| Session pack, GST 18% exclusive | 18% | subtotal (price_paid − tax) |
| Monthly pack, GST off | — | price_paid / duration_months |
| Custom pack, GST 5% inclusive | 5% incl | subtotal |

## Files

**Migration (1 file):**
- `supabase/migrations/<ts>_pt_commission_subtotal.sql` — extend RPC, add columns, add partial unique index for attendance dedup if missing.

**Edited:**
- `src/services/ptService.ts` — pass subtotal/tax to RPC.
- `src/lib/payments/ptCheckout.test.ts` — new vitest file.
- `mem://features/pt-dual-mode` — append commission base rule + GST audit findings.

**No UI changes** beyond the service-layer RPC param additions (drawers already pass through correct values).

## Risk & rollback

- Migration is additive (new params with defaults, new nullable columns). Safe to deploy without coordinating frontend release.
- If commission math regresses, revert by removing `_subtotal` param from frontend call — RPC falls back to `_price_paid`.
- Attendance dedup index is `CREATE INDEX IF NOT EXISTS` — idempotent.