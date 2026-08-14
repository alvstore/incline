# Revenue and POS Hardening Plan

The user reported that a payment (Mohit Gurjar, ₹10,399, UPI) is stuck in a "Pending" status and "Cancelled" invoices are not updating correctly in the Store Management dashboard. This plan addresses the audit and hardening of revenue calculations, status tracking, and the Store UI.

## User Feedback Integration
- "i have marked cancelled from admin side but its not updated"
- "payment is stucked at pending status"
- "audit carefully to understand recent transactions / profits calculations / invoice / payments / configured payments"

## 1. Data Integrity & Logic (Backend)
- **Fix Invoice Cancellation:** Verify and harden the `cancel_invoice` logic to ensure it correctly voids any associated "awaiting_payment" POS sales or pending transactions.
- **Revenue Calculation:** Audit `totalRevenue` in `StorePage.tsx`. Currently, it sums `paid` online orders and ALL `posSales` regardless of status. It must exclude `awaiting_payment` and `cancelled` sales.
- **Status Mapping:** Ensure "awaiting_payment" in `pos_sales` is explicitly linked to the invoice status so that marking an invoice as cancelled or paid (cash) instantly resolves the POS row.

## 2. Store Management Console (UI/UX)
- **Visual Status Hardening:** Use premium Indigo/Violet gradients for the "Store Overview" as per Vuexy standards.
- **Revenue Clarity:** Update the Profit and Revenue cards to show "Net Realized Revenue" (Paid) vs "Projected Revenue" (Awaiting/Pending).
- **Recent Transactions Audit:** Filter the "Recent Transactions" list to show only realized (Paid) payments to avoid confusion with pending/stuck entries.
- **Actions Column:** Ensure the "Actions" dropdown correctly reflects available states (e.g., don't show "Cancel" if already cancelled).

## 3. Revenue Service Hardening
- **Refactor Calculations:** Move revenue calculation logic to a shared utility or use the `income_logs` table (if available) for authoritative reporting.
- **Real-time Sync:** Verify `useRealtimeInvalidate` covers all edge cases for store updates.

## Technical Details
- **File:** `src/pages/Store.tsx`
- **Logic Change:** Change `posTotal` calculation to `posSales.filter(s => s.payment_status === 'completed' || s.payment_status === 'paid').reduce(...)`.
- **Logic Change:** Ensure `posSales` query explicitly pulls the latest `payment_status` from the joined `invoices` table if not already synced.
- **UI Change:** Update `sparklineData` to only include successful transactions for the profit chart.
