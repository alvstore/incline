# Plan: Resolve Manual Invoice Creation Ambiguity and UI Enhancements

The image and user message indicate a "Could not choose the best candidate function" error for `purchase_member_membership` (which was previously addressed but may have persisted in UI caching or edge cases) and a request to enhance `CreateInvoiceDrawer.tsx` with searchable facility/PT/membership packages, backdated start dates, and due-date presets.

## Proposed Changes

### 1. Database Layer
- Final audit of `purchase_member_membership` and `create_manual_invoice` overloads.
- Drop any remaining legacy overloads for `purchase_member_membership` to ensure PostgREST selects the correct 18-argument version.
- Ensure `create_manual_invoice` correctly handles its arguments without ambiguity.

### 2. UI Enhancements (CreateInvoiceDrawer.tsx)
- **Member Search**: Enhance `InvoiceMemberPicker` to ensure it supports searching by name, email, phone, or code via the `search_members` RPC.
- **Catalog Integration**: Already using `InvoiceCatalogPicker`, but ensure it correctly displays "Sauna", "Ice Bath", and "PT Package" as per user request.
- **Backdating**: Add a "Bill Date" or "Start Date" field to support backdated invoices ( yesterday/manual yesterday).
- **Due Date Presets**: Implement `DUE_DATE_PRESETS` (3, 7, 10, 15 days) similar to `PurchaseMembershipDrawer.tsx`.
- **Payment Sync**: Add UTR/Transaction ID field if the manual invoice is being settled immediately (though usually invoices are created first, then paid). Add a "Mark as Paid" toggle with UTR field for immediate settlement.

### 3. Identity & Logic
- Ensure the drawer correctly handles "Walking" members (non-members) vs "Members" by allowing search to find existing records or fallback to generic details.

## Technical Details
- **File**: `src/components/invoices/CreateInvoiceDrawer.tsx`
- **File**: `src/components/invoices/InvoiceMemberPicker.tsx`
- **RPC**: `purchase_member_membership` (Audit/Drop legacy)

## Constraints
- Follow Vuexy premium aesthetic.
- Use Sheets for forms.
- No `any` types.
- INR (₹) formatting.
