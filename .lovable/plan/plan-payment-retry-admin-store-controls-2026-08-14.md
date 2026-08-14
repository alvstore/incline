# Plan: Payment Retry & Admin Store Controls

Enhance the member payment experience by adding a "Retry Payment" button to pending invoices and improve the Admin Store Management dashboard by adding controls to handle stuck "Awaiting Payment" transactions.

## User Review Required

> [!IMPORTANT]
> - The "Retry Payment" feature requires an active online payment gateway (e.g., Razorpay) to be configured for the branch.
> - Admin "Cancel Invoice" action will permanently void the invoice and its associated POS sale entry.

## Proposed Changes

### Member Dashboard Improvements
- **Add "Pay Now" Button to Invoice Drawer:**
  - Update `InvoiceDetailDrawer.tsx` to include a primary "Pay Now" button if an invoice is in `pending` or `partial` status and has an amount due.
  - This will navigate the member to the `/member/pay?invoice={id}` portal.

### Admin Store Dashboard Improvements
- **Fix "Awaiting Payment" Visibility:**
  - Update the "POS History" table in `Store.tsx` to include an "Actions" column.
- **Add Action Menu for Invoices:**
  - **Cancel/Void:** Allow admins to cancel a pending POS sale invoice if the payment failed or was abandoned.
  - **Mark as Paid:** Allow admins to manually settle an "Awaiting" invoice if the payment was received via another channel (e.g., cash) after the POS session was initiated.
- **Visual Feedback:**
  - Use high-contrast badges for "Awaiting Payment" to ensure staff don't miss unpaid transactions.

## Technical Details

### Components & Pages
- **`src/components/members/InvoiceDetailDrawer.tsx`**:
  - Add logic to check `invoice.status` and `amountDue`.
  - Add a "Pay Now" button that triggers `onPayNow` (or navigates to `/member/pay`).
- **`src/pages/Store.tsx`**:
  - Update the POS History table schema to include `invoice_id`.
  - Add a dropdown menu for each row to "Cancel Invoice" or "Settle Payment".
  - Integrate `record_payment` and `cancel_invoice` (or `void_payment`) RPCs.

### Database / Backend
- No schema changes required; utilizing existing `record_payment` and `invoices` status management.
- Ensure RLS allow staff to update invoice status in the store context.

## Design
- Adhere to **Vuexy Premium** aesthetic: `rounded-2xl` buttons, `indigo-600` primary actions, and `destructive` (red) for cancellation.
- Use `lucide-react` icons: `CreditCard` for payment retry, `XCircle` for cancellation.
