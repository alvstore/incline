# Finance Page Audit + GST Fix + Sales Report Tab

## Audit findings (`/finance` → GST Report tab)

Current implementation reads from a single source (`invoices` table, filtered by `is_gst_invoice = true`). That's why the screenshot shows **"GST Invoices (0)"** even though POS sales exist.

**Gaps identified**

1. **POS sales are invisible to GST report.** `pos_sales` rows without a linked `invoice_id` (currently 100% of them) never appear. By Indian law, retail/supplement sales are taxable supplies @ 18% GST and must be in GSTR-1.
2. **HSN codes are not aggregated.** `invoice_items.hsn_code` and `products.tax_rate` exist but the report doesn't group by HSN — required for GSTR-1 HSN summary.
3. **Membership / PT / Add-on classification is implicit.** `invoices.source` and `invoice_type` fields exist (`manual`, `pos`, `membership`, `pt_package`, `addon`, etc.) but the report doesn't break revenue down by stream.
4. **Tax split is naive.** CGST/SGST hard-split 50/50 with no IGST handling (inter-state GSTIN); fine for single-state but should be explicit.
5. **No month-wise pivot / GSTR-ready export.** Only one flat CSV. Accountants need a month picker + GSTR-1 B2B + B2C + HSN summary CSVs.
6. **No Sales Report view at all** — Today / Week / Month / Date-range, by stream, by branch, by staff.
7. Minor UX: GST tab cards aren't using the Vuexy gradient hero; tables aren't scroll-locked; download button missing for HSN summary and non-GST.

## Plan

### 1. Rewrite GST Report tab (`GstReportTab`)

Unify revenue sources into one in-memory ledger before bucketing:

```text
sources:
  - invoices (is_gst_invoice=true)          → taxable supplies w/ explicit rate
  - invoices (is_gst_invoice=false)         → non-GST income (membership refunds, etc.)
  - pos_sales (no invoice_id)               → treat as B2C @ 18% HSN-derived
                                              (back-calc taxable = total / 1.18)
  - invoice_items                            → for HSN summary on GST invoices
```

New sub-sections inside the tab:
- **Month picker** (defaults to current FY month) + branch filter (already global)
- **Hero KPI strip** (Vuexy gradient): Taxable Value · CGST · SGST · IGST · Total Tax · Gross Sales · Non-GST income
- **Revenue by Stream** card: Memberships · PT Packages · Add-ons · POS Retail · Other — counts + taxable + tax
- **GST Rate Breakdown** (existing, extended with IGST column when customer_gstin state ≠ branch state)
- **HSN Summary** (NEW): groups `invoice_items.hsn_code` (+ inferred `9972` for membership, `999723` for PT, `2106`/`3004` for supplements from product.hsn or default 18%). Columns: HSN · Description · UQC · Qty · Taxable · CGST · SGST · IGST · Total. This is the GSTR-1 Table-12 layout.
- **B2B Invoices** (with customer_gstin) and **B2C Invoices** (no GSTIN) split tables
- **POS Sales (taxable)** table — currently missing entirely
- **Non-GST Income** (existing) kept

Exports (all month-scoped CSVs ready for CA):
- `GSTR1_B2B_<month>.csv`
- `GSTR1_B2C_<month>.csv`
- `GSTR1_HSN_Summary_<month>.csv`
- `Sales_Register_<month>.csv` (consolidated income)
- `Non_GST_Income_<month>.csv`

### 2. Default HSN map (no schema change required)

Use existing `organization_settings.hsn_defaults` JSONB; seed defaults if empty:

```text
membership  → 999723 (Health & fitness services, 18%)
pt_package  → 999723 (18%)
class       → 999723 (18%)
addon       → 999723 (18%)
pos:supplement → 2106  (18%)   ← Indian "food preparations not elsewhere specified"
pos:apparel    → 6109  (12%)
pos:equipment  → 9506  (18%)
pos:default    → 2106  (18%)
```

Resolution order at report time: `invoice_items.hsn_code` → `products.hsn_code/tax_rate` → category map → org default (18%).

### 3. NEW "Sales Report" tab

Added as 4th tab in the Income/Expenses/GST tablist.

Layout (uses `/skill:ui-ux-pro-max` Vuexy guardrails):
- **Range chips**: Today · Yesterday · This Week · This Month · Last Month · Custom date range (uses existing `DateRangePicker`)
- **Hero gradient strip**: Gross Sales · Net Sales (ex-GST) · Transactions · Avg Order Value · Refunds · Net Profit
- **Trend chart**: daily sales bar + 7-day moving avg line (recharts, already in project)
- **By Stream donut**: Memberships / PT / POS / Add-ons / Classes
- **By Payment Method** mini-card row: Cash · Card · UPI · Bank · Wallet
- **By Branch** table (visible only when "All Branches" selected)
- **By Staff** leaderboard (top 10 by collections, from `payments.collected_by` / `pos_sales.sold_by`)
- **Date-wise sales table**: Date · Txn count · Gross · Tax · Net · Refunds · Net Sales (sortable, exportable)
- **Top Products / Plans** card (from POS items + invoice line items)
- **Export**: per-day CSV + per-stream CSV + "Accountant pack" zip-style multi-CSV trigger (one click, downloads all 5 GST CSVs + sales register for the selected range)

### 4. Architecture / code structure

```text
src/pages/Finance.tsx          (orchestrator, add 4th tab)
src/components/finance/
  GstReportTab.tsx            (extract from inline, rewrite)
  SalesReportTab.tsx          (NEW)
  hooks/
    useGstReport.ts           (unifies invoices + pos_sales + items)
    useSalesReport.ts         (range-aware aggregation)
    useHsnResolver.ts         (HSN/rate lookup w/ org_settings cache)
  exports/
    gstr1Exports.ts           (B2B / B2C / HSN CSV builders)
    salesExports.ts           (daily / stream / accountant pack)
```

All queries: TanStack Query, branch-scoped, RBAC-gated (owner/manager only — staff cannot see GST/Sales).

### 5. Out of scope (call out)

- No DB migration. (`invoice_items.hsn_code`, `products.tax_rate`, `organization_settings.hsn_defaults` already exist.)
- No e-invoicing / IRN generation.
- No backfill of historical POS sales into `invoices` table — handled at report time only.
- GSTR-3B summary (different return) — can add later if requested.

## Open question

POS sales currently bypass `invoices`. Two options for the GST report:
- **A (recommended, no migration):** treat unlinked `pos_sales` as B2C taxable supplies at report time using HSN map — instant fix, no data change.
- **B (heavier):** backfill an invoice row for every POS sale (trigger + script). Cleaner long-term, but a separate task.

I'll proceed with **A** unless you prefer B.
