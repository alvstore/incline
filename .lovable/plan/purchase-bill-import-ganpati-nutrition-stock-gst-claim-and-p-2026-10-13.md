# Purchase Bill Import — Ganpati Nutrition stock, GST claim and product photos

## What the sheet contains
- 3 supplier bills from Ganpati Nutrition (GSTIN 08GJVPM7898N1ZI), all dated 12 Sep 2026: bills 007, 008, 009.
- 22 items, 5% GST (2.5% CGST + 2.5% SGST), taxable ₹38,867.26, GST ₹1,943.36, total ₹40,810.62.
- The rates are **what we paid**, not selling prices. They will be saved as purchase cost only.

## Problems found in the sheet (shown as warnings before saving)
- Some HSN codes look wrong for the item: Pintola masala oats = 1104, MyFitness peanut butter = 1806, Pintola peanut butter = 2008. Staff can correct them in the preview before import.
- Several HSN codes are 4 digits (2106). Accepted, but flagged as "short HSN".
- Rates are rounded (e.g. 228.57 × 4), so totals differ by a few paise; the app keeps the bill total from the sheet.

## How it will work (Store → Purchases → Import purchase bill)
1. Upload the Excel/CSV (same columns as this sheet). A downloadable blank template is provided.
2. Preview screen groups rows by bill number. For each line: match to an existing product or "Create new product". Edit HSN, GST rate and quantity inline. Warnings shown with text and icon, not only colour.
3. Choose branch and whether the bill is paid (payment method, date) or still due.
4. Save. In one server step the app:
   - creates one **vendor bill** per supplier invoice (bill no., date, vendor, GSTIN, taxable, CGST, SGST, total) under Expenses, so the GST input credit is recorded;
   - creates new products as **inactive / not for sale**, with purchase cost, HSN and GST rate filled in, and no selling price;
   - adds a **stock batch** per line (quantity received, cost per unit, supplier, supplier bill no.) so stock goes up.
   - Importing the same bill number twice from the same vendor is refused.
5. After import, a "Ready to activate" list shows the new products. For each: upload photo, set selling price, then switch on "Available for sale". Products without a photo or selling price cannot be switched on.

## Settings, analytics, accessibility
- Feature switch `purchase_bill_import` (on for owner/admin/branch manager only); front desk cannot import or see costs.
- Events: `purchase_import_started`, `purchase_import_completed` (bill count, line count — no amounts or vendor names), `product_activated`.
- Drawer flow (no pop-up forms), keyboard reachable table, labelled inputs, error messages linked to fields, live announcement of import result.

## Technical details
- Migration: add `hsn_code`, `is_sellable` (default false) to `products`; add `vendor_gstin`, `taxable_amount`, `cgst_amount`, `sgst_amount`, `igst_amount`, `gst_rate` to `expenses`; new `expense_items` table (expense_id, product_id, batch_id, hsn_code, qty, rate, taxable, gst_rate, tax amounts) with branch-scoped RLS; unique (branch_id, vendor_gstin, bill_number) on vendor bills.
- One SECURITY DEFINER RPC `import_purchase_bill(payload jsonb)` with `rpc_guard_applies()` + branch manager/owner check, explicit GRANT to authenticated; atomic insert of bill, items, products, batches.
- Parsing in browser with the existing spreadsheet library; validation with Zod; TanStack Query mutations with invalidation of products, inventory, expenses.
- Store/POS lists filter `is_sellable = true` so imported products never appear for members until activated; photo upload reuses the existing product image upload.
- GST report input-credit section reads the new tax columns.
- Tests for: duplicate bill refused, GST split 2.5/2.5, product cannot be activated without photo and selling price.
- After build, import this sheet into the main branch and verify bill totals ₹40,810.62 and stock quantities.
