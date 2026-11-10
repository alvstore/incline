# POS & Store stock: show the truth, check before ordering, flag backorders

## What the audit found
- Sales DO reduce stock. Three sold options (Peanut Butter Crunchy, Whey Caramel, Oats Chocolate 1kg) are now at 0 in the database.
- The product card shows the main product (the parent), not the option. The parent never has its own stock row, so the app reads "no stock row = not tracked = Available / In stock". That is why sold-out items still look available.
- Same rule exists in the Member Store (`getStockDisplay`: no row → "Available") and in the POS grid (`getStock` returns null → no badge, add allowed).
- Options with no stock row at all can still be added and sold without limits.

## What will change
1. **One stock rule everywhere** (`src/lib/store/stockStatus.ts`, with tests)
   - A product with options = sum of its options' stock in this branch. 0 → "Out of stock".
   - A sellable item with no stock row = 0 (Out of stock), not "Available".
   - Low-stock badge uses the item's minimum level.
2. **POS (desk)**
   - Cards and option chips show Out of stock / "N left" from the rule above; out-of-stock options greyed but announced to screen readers.
   - Cart quantity capped at stock; server (`create_pos_sale`) already refuses overselling and stays the final check — tighten it so an item with no stock row is also refused.
   - Optional **"Take as backorder"** action on out-of-stock items (owner/manager only, behind a per-branch switch, off by default): creates the bill, marks the line "Awaiting stock", does not make stock negative.
3. **Member Store**
   - Same Out of stock display; "Add to cart" disabled when 0. Checkout re-checks stock on the server and shows a clear message if it ran out meanwhile.
   - If the branch backorder switch is on, members see "Order now — we'll arrange stock" instead, and the confirmation says the order is taken and stock is being arranged.
4. **Backorder notifications** (only when a backorder is taken)
   - In-app alert + task to the branch manager/front desk: "Arrange stock: item, qty, member, bill no.", via the existing notification dispatcher.
   - Member gets an in-app note "Order received — we're arranging stock", and another when stock is received and the order is ready.
   - Audit log entry for each backorder and its fulfilment.
5. **Fulfilment**: when stock is added (bill import / stock adjustment), open backorders for that item are listed in Inventory with a "Mark fulfilled" button that deducts stock then.

## Technical details
- Migration: `branch_settings` flag `allow_backorders` (default false); `pos_backorders` table (sale/invoice, product, qty, status pending|fulfilled|cancelled, branch) with grants + branch-scoped RLS; `create_pos_sale` guard for missing inventory rows and backorder path; audited `fulfil_pos_backorder` RPC that writes `stock_movements`.
- Frontend: shared stock helper used by `POS.tsx`, `MemberStore.tsx`; query invalidation of `pos-products`/`inventory` after sale (already present) plus member store.
- Tests: stock helper (parent sum, missing row = 0, low stock) and backorder flag off = refusal.

## Not changing
Prices, GST, invoice numbering, existing sales or stock counts.
