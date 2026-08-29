# GST tab, renewal invoices & online-payment tax treatment

## 1. Date filter (fixed now)

Findings:
- The calendar committed the end date at **00:00**, so "1 Jul → 31 Jul" actually meant "1 Jul 00:00 → 31 Jul 00:00" and silently dropped the last day.
- The picker's internal state never re-synced with the applied range, and **Apply** just closed the popover without committing a half-finished selection — so a range often looked selected but nothing changed, which is why the numbers appeared identical.
- The GST tab showed no indication of which period was being reported.

Done:
- Every range is normalised to whole days (`00:00:00.000` → `23:59:59.999`), reversed ranges auto-corrected.
- Calendar syncs with the applied value; **Apply** now commits (single-day selection allowed).
- GST tab shows a "Filing Period" banner with the exact dates and document counts.

Verified live data (IST months, GST-eligible only): July 2026 = 42 invoices, ₹8,74,285.64 taxable, ₹43,714.51 tax; August 2026 = 37 invoices, ₹7,25,714.17 taxable, ₹36,285.88 tax. The two months are genuinely different, so once the filter commits correctly the values change.

## 2. Renewal invoices being auto-issued (root cause)

`generate_renewal_invoices()` runs daily and, for every membership expiring in 7 days, inserts a **real invoice**. The numbering trigger stamps a legal document number on insert, so:
- members who never renew leave permanent gaps/dead documents in the series,
- they land in the **BOS** series (no `is_gst_invoice`), polluting bills-of-supply numbering,
- Table 13 (Documents Issued) counts them as issued documents.

Proposed fix (no legal document until the member commits):
1. Add `invoices.is_proforma boolean default false` and let the numbering trigger issue a **PRO-** number (separate non-statutory counter) when `is_proforma` is true.
2. `generate_renewal_invoices()` creates the renewal offer as `is_proforma = true`, `status = 'draft'`.
3. On first successful payment (or staff confirmation), a `convert_proforma_to_invoice()` RPC flips `is_proforma = false`, assigns the next **INV** number from the tax-invoice counter, sets GST fields, and keeps the PRO number in `notes` for traceability.
4. Auto-expire unconverted proformas after the membership lapses (they never consume INV/BOS numbers).
5. Exclude proformas from the GST report, Table 13 and the Zoho sync; show them in a "Renewal offers" bucket on `/invoices` instead of the pending list.
6. Backfill: cancel the 6 open pending BOS renewal invoices and record them as cancelled documents in Table 13 (numbers already burned cannot be reused).

## 3. Online / Razorpay sales must be tax invoices

Rule to enforce: **BOS is only for genuinely exempt supplies; every gateway-collected sale is a taxable supply.**
1. Renewal/payment-link/gateway invoice creation paths set `is_gst_invoice = true`, `gst_rate = 5` before insert, so the trigger issues an **INV** number and tax is split into subtotal/tax.
2. Add a DB guard: an invoice that is settled through `payment_transactions` with a gateway may not be BOS — a trigger raises instead of silently issuing a bill of supply.
3. Convenience fee stays out of the invoice (unchanged, quoted at gateway only).
4. Existing August gateway sales sitting in BOS are listed for review; re-issuing them as tax invoices is a manual accounting decision — nothing is rewritten automatically.

## Files touched in phases 2 & 3
- Migration: `generate_renewal_invoices`, `generate_invoice_number`, new `convert_proforma_to_invoice`, gateway/BOS guard trigger.
- `src/lib/finance/useGstReport.ts`, `src/components/finance/GstReportTab.tsx` — exclude proformas.
- `src/pages/Invoices.tsx` — "Renewal offers" bucket.
- `supabase/functions/zoho-books-sync/index.ts` — skip proformas.
