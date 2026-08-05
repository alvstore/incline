# Meal Catalog CSV + GST 2.0 Filing-Grade Reports

Two independent workstreams.

---

## Part 1 — Meal Catalog: CSV import/export + seed the reference catalog

Today `/meal-catalog` only supports one-at-a-time entry through the Add Meal sheet, and the table has no place for micronutrients (columns are name, diet, cuisine, meal type, quantity, calories, protein, carbs, fats, fiber, tags, notes).

### What gets built
- **Download CSV** — exports the currently filtered list with every field, in the exact same column order the importer expects, so a download → edit → re-upload round-trip works.
- **Download Template** — a 2-row sample CSV for people starting fresh.
- **Upload CSV** — a right-side sheet (per the no-dialog rule): pick file → parsed preview table showing New / Update / Error per row with inline reasons (bad meal type, non-numeric macros, missing name) → "Import N valid rows" button. Invalid rows are skipped, never silently coerced. Matching is by name (case-insensitive) within the branch, so re-uploading updates instead of duplicating.
- **Micronutrients** — new optional text column on meals (e.g. "Calcium, Magnesium, B vitamins"), shown in the meal card, the view sheet, the edit form, and both CSV directions.

### The uploaded document
`INCLINE_Fitness_Meal_Catalog.docx` contains ~30 Indian meals with calories/protein/carbs/fat plus a Key Micronutrients column, and a trailing micronutrient reference table (Iron, Vitamin D, B12, Omega-3 and their sources). I will convert the meal table into the seed catalog (mapped to meal type, dietary type and cuisine, with micronutrients filled in) and load it via the same importer. The micronutrient reference table is guidance, not meals — it will not be inserted as catalog rows.

---

## Part 2 — GST reports fit for GSTR-1 filing

### What is wrong today (verified against live data)

1. **Exempt / non-GST sales are being taxed in the report.** `useGstReport` builds a line for *every* invoice, and for a non-GST invoice it emits rate 0 with the full amount as "taxable". Those rows then land in the B2C table and in the B2C CSV. Your screenshot shows exactly this — `INV-INC-26-0089` and `INV-INC-26-0087` sitting in "B2C Invoices & POS" at 0% and ₹0 tax. There are 25 such invoices in the database against 53 GST invoices.
2. **Cancelled invoices are counted.** No status filter exists, so 2 cancelled invoices (₹18,000 + ₹1,500) are inflating taxable value, tax and the CSVs.
3. **POS sales are hard-coded at 18%.** Every unlinked POS sale is force-taxed at 18% regardless of the product's actual rate — while your invoice GST standard is 5%.
4. **Tax split is always CGST+SGST.** IGST is hard-wired to 0 with no place-of-supply check, so an out-of-state customer would be filed wrong.
5. **Single document series.** Both GST and non-GST invoices share `INV-INC-26-####` (GST: 0016–0091, non-GST: 0014–0089, fully interleaved). GSTR-1 Table 13 "Documents Issued" wants series with a from/to range and a cancelled count; an interleaved series cannot be declared cleanly, and your CA cannot tell taxable from exempt by invoice number.
6. **Sales Register is buried.** It is a lone button inside the "Non-GST Income" card and its CSV dumps every line, GST and exempt mixed, with no running/opening context.

### What gets fixed

**Report engine**
- Exclude `cancelled` (and voided) invoices from every bucket, with a visible "N cancelled invoices excluded" note so the number is never silently missing.
- Split the pipeline into **taxable supplies** (B2B / B2C) and **exempt & non-GST supplies** (GSTR-1 Table 8 "Nil rated, exempted and non-GST outward supplies"). Non-GST invoices no longer appear in the B2C table or the B2C CSV — they get their own section and their own CSV.
- Derive POS tax rate from the product/line item rather than assuming 18%, falling back to the organisation's default rate instead of a literal.
- Add place-of-supply handling: if the customer's state code differs from the branch's GSTIN state code, the line files as IGST; same state stays CGST+SGST.

**New filing-grade sections**
- **Table 8 — Exempt / Nil-rated / Non-GST supplies**: invoice-wise list plus a total, own CSV.
- **Table 13 — Documents Issued**: per series — nature of document, from number, to number, total issued, cancelled. This is the section the portal asks for and it currently does not exist anywhere in the app.
- Reworked **Accountant Pack**: B2B, B2C, HSN summary, exempt supplies, documents issued, and a full sales register, each labelled with the period so the CA can attach them to the return as-is.

**Sales Register redesign**
- Promoted to its own card with its own filters (all / GST only / exempt only) instead of hiding behind the Non-GST card.
- Columns: date, series, invoice #, customer, GSTIN, place of supply, supply type badge (Taxable / Exempt / Non-GST), HSN-SAC, taxable, rate, CGST, SGST, IGST, total, status.
- Column totals in a sticky footer row, colour-coded supply-type badges, and a CSV that mirrors the on-screen columns exactly.

### Document series — confirmed decisions
- **Separate bill-of-supply series.** From now on, exempt / non-GST invoices are numbered `BOS-INC-26-####` from their own counter, while taxable invoices continue on `INV-INC-26-####`. The 78 invoices already issued keep their numbers and are classified in reports by supply type; Table 13 therefore declares three series (taxable, exempt, and the legacy mixed range) with honest from/to and cancelled counts.
- **POS rate: per-product only, no fallback.** The hard-coded 18% is removed. A POS line without a resolvable tax rate is not silently taxed — it lands in a "Rate missing — needs attention" bucket at the top of the GST tab with a direct link to the sale, and is excluded from the filing CSVs until fixed, so nothing wrong is ever sent to the CA.


---

## Technical notes

- New migration: `meal_catalog.micronutrients text`; optionally `invoices.document_series text` + a bill-of-supply counter in `invoice_number_counters` if series separation is approved.
- `src/lib/finance/useGstReport.ts` — status filter, taxable/exempt split, POS rate resolution, place-of-supply IGST logic, documents-issued aggregation.
- `src/lib/finance/csvExports.ts` — B2C export takes the filtered taxable set; new `exportExemptSupplies`, `exportDocumentsIssued`; widened sales register.
- `src/components/finance/GstReportTab.tsx` — new Table 8 and Table 13 cards, promoted Sales Register card, corrected copy on the B2C card.
- `src/services/mealCatalogService.ts` — `bulkUpsertMealCatalog`, CSV parse/serialise helpers.
- New `src/components/fitness/MealCatalogImportSheet.tsx`; `src/pages/MealCatalog.tsx` gains Upload / Download / Template actions.
- Parsing uses a small hand-rolled CSV reader (quote-aware) — no new dependency.
