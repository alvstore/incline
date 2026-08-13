# Plan: Enhanced Dues Console and Payment Transparency

Improve the "Money Movement" console (Payments page) to provide deeper insights into outstanding dues, specific invoice items, and payment history per member. This addresses the user's request to identify invoice items, last payment details, and the tax/GST nature of transactions.

## User Review Required

> [!IMPORTANT]
> - The "Dues" tab currently groups by member. The new layout will include a collapsible "Items" section for each member.
> - "GST paid invoice" vs "Cash invoice" will be identified by the existence of a `tax_amount > 0` or `gst_rate > 0` on the invoice.

## Technical Details

### 1. Database & Queries
- Update the `all-overdue-invoices` query in `src/pages/Payments.tsx` to include `invoice_items(description, unit_price, quantity)` and `tax_amount`.
- Fetch the last payment for each member in the dues list to show the "Last payment mode".

### 2. UI/UX Enhancements (`src/pages/Payments.tsx`)
- **Dues Tab Overhaul**:
    - Add a `Collapsible` row for each member in the Dues table.
    - **Items Breakdown**: Show specific items (e.g., "Sauna Bath x 1", "Ice Bath x 1") inside the expanded row.
    - **Payment Context**: Display "Last Payment: [Method] · [Date]" for each member to help staff identify if they previously paid in cash or UPI/Credit Card.
    - **GST/Invoice Type Indicator**: Add a badge or icon to indicate if an invoice is GST-compliant (based on `tax_amount`).
- **Enhanced Search**: Ensure the member search in the record payment flow clearly shows the last transaction method as a hint.

### 3. Components
- Use Lucide icons (`Info`, `History`, `Tag`) to distinguish item types and history.
- Ensure the "Earliest Due Date" remains high-priority in the layout.

## Context Inventory
- `src/pages/Payments.tsx`: Main console for money movement.
- `src/lib/payments/paymentDisplay.ts`: Helper for formatting payment channels and labels.
- `src/lib/members/resolveMemberDisplay.ts`: Standard member naming logic.
