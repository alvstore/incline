
## Problem

Two PDF paths produce different output:

1. **Invoices list "Download" action** (`src/pages/Invoices.tsx`) — calls `resolveBrandAsync(invoice.branch_id, …)` so it picks up the branch's address/phone/email and the Incline logo URL (with bundled fallback).
2. **Invoice Details drawer "Download" button** (`src/components/invoices/InvoiceViewDrawer.tsx`) — passes `useBrandContext(null)` (global only, no branch_id), so the brand has no branch address and may miss the logo lookup chain.

Additionally:

- `buildInvoicePdf` is **synchronous** and explicitly skips raster logo rendering (see comment at `pdfBlob.ts:246`). So **neither** path actually paints the logo — only the wordmark.
- Membership line items currently show only `"Annual Plan - 365 days"` (raw `invoice_items.description`). The PDF does not expand membership rows with included benefits / "1 month extra" details.

## Fix plan

### 1. Single source of truth for invoice PDF generation

Create one async helper that both call sites use:

```ts
// src/utils/invoicePdf.ts (new)
export async function generateInvoicePdfBlob(invoice: any): Promise<Blob> {
  const input = await toInvoicePdfInputAsync(invoice); // enriches membership rows
  const brand = await resolveBrandAsync(invoice.branch_id, invoice?.branch?.name);
  return buildInvoicePdf(input, brand);
}
```

Replace both download handlers:

- **`InvoiceViewDrawer.tsx`** — drop `useBrandContext(null)`; `handleDownloadPDF` becomes async and calls `generateInvoicePdfBlob(invoice)`.
- **`Invoices.tsx`** (Download menu item) — call `generateInvoicePdfBlob(full)` instead of the inline `resolveBrandAsync + toInvoicePdfInput + buildInvoicePdf` triplet.
- **`InvoiceShareDrawer.tsx`** — same; both `buildInvoicePdf(buildPdfInput())` calls go through `generateInvoicePdfBlob(invoice)` so emailed/shared PDFs match.

Result: identical bytes whether the user downloads from the list, the drawer, or share.

### 2. Embed the Incline logo in the invoice PDF

Convert `buildInvoicePdf` (in `pdfBlob.ts`) to **async** so it can use the existing cached `loadLogoDataUrl(brand.logoUrl)` helper (already used by `buildPlanPdf`).

- If a logo loads, render it on the left of the gradient header (~22×22mm, vertically centered), and shift the wordmark to the right of the logo.
- If logo load fails, keep the current text-only wordmark — no regression.
- `resolveBrandAsync` already falls back to bundled `incline-logo.png`, so the logo will always be present unless fetch fails entirely.

All callers (`InvoiceViewDrawer`, `Invoices`, `InvoiceShareDrawer`, anything else from the grep) become `await buildInvoicePdf(...)`. Helper from step 1 hides that.

### 3. Branch "From" address always populated

After step 1, both paths feed the invoice's actual `branch_id` into `resolveBrandAsync`, which fetches `branches.address/phone/email/gstin`. The "FROM" card already renders these — no further change needed.

### 4. Enrich membership line items with plan details + benefits

Extend `toInvoicePdfInput` → async variant `toInvoicePdfInputAsync(invoice)`:

- For each `invoice_items` row where `reference_type === 'membership'`, fetch:
  ```sql
  select m.id, m.start_date, m.end_date, m.plan_id,
         p.name, p.duration_days, p.duration_type,
         (select json_agg(json_build_object('name', bt.name, 'quantity', pb.quantity, 'unit', pb.unit))
            from plan_benefits pb
            join benefit_types bt on bt.id = pb.benefit_type_id
           where pb.plan_id = p.id) as benefits
    from memberships m
    join membership_plans p on p.id = m.plan_id
   where m.id = :reference_id
  ```
- Build an expanded description: header line + a "Includes:" bullet list of benefits, and (if `duration_days > plan_duration_days`) a "+ 1 month complimentary" callout derived from `end_date - start_date` vs plan duration.
- Pass through new optional `meta` field on the item:
  ```ts
  items: [{ ..., meta: { subtitle?: string; bullets?: string[] } }]
  ```
- In `buildInvoicePdf`, when rendering each row's description cell, append `meta.subtitle` (smaller, muted) and `meta.bullets` (• list, 8pt) under the description so the PDF reads:
  ```
  Annual Plan - 365 days
  Includes 30 complimentary days
  • Sauna — 12 sessions
  • Ice Bath — 12 sessions
  • Personal Training — 4 sessions
  ```

### 5. Files touched

- `src/utils/pdfBlob.ts` — make `buildInvoicePdf` async, draw logo, render item meta.
- `src/utils/invoicePdfInput.ts` — keep sync mapper, add `toInvoicePdfInputAsync` that enriches membership rows.
- `src/utils/invoicePdf.ts` *(new)* — `generateInvoicePdfBlob(invoice)` single entry point.
- `src/components/invoices/InvoiceViewDrawer.tsx` — drop `useBrandContext`, use helper.
- `src/pages/Invoices.tsx` — Download menu item uses helper.
- `src/components/invoices/InvoiceShareDrawer.tsx` — both download/share PDF calls use helper.

### Acceptance

- Downloading INV-INC-26-0014 from either the drawer or the list produces a PDF with: Incline logo (left of wordmark), branch address in FROM card, line item showing "Annual Plan - 365 days" + plan benefits + complimentary period.
- Share drawer's attached PDF matches.
- No other PDFs (plan, payslip, thermal receipt) regress.

Used the **ui-ux-pro-max** and **senior-architect** skills.
