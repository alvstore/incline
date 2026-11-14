# Payment links: the server sets the amount, and part payments need a reason

## What changes for you
- **Full balance (default):** staff no longer send an amount. The server reads what is owed on the invoice and charges exactly that.
- **Part payment:** any staff member can still send a link for less than the balance, but has to type a reason first (for example "Member paying ₹5,000 now, rest on 30 Nov"). The reason is saved in the audit log with the staff member's name, the invoice and the amount. It also appears on the payment record and in the Razorpay notes.
- **Members** (app, website, WhatsApp, reminders) can only pay the full balance, as they do today.
- Nobody can charge more than what's owed, and nobody can charge ₹0 or a negative amount.

## Screens
- **Send Payment Link drawer:** the options become "Balance due" (default) and "Part payment". Choosing Part payment shows a required Reason box (at least 5 characters) and the remaining balance. The old "Full invoice total" option goes away, because it could ask for more than is owed after an earlier payment.
- **Sell membership / POS checkout with "payment link":** always sends the full new invoice balance, with no amount sent from the screen.

## Technical details
- `create-razorpay-link` v2.3.0:
  - The request body becomes `{ invoiceId, branchId, mode?: 'due'|'partial', partialAmount?, partialReason? }`. A legacy `amount` is accepted only when it equals the due amount; anything else is treated as partial and needs a reason.
  - The server computes `due = total_amount − amount_paid` and requires `due > 0`.
  - Partial requires a staff caller (owner/admin/manager/staff, branch-checked), `0 < partialAmount < due`, a reason of 5–300 characters, and Zod validation of the whole body.
  - Member self-pay and internal callers are always charged the due amount; their amount input is ignored.
  - A partial link writes an `audit_logs` row (action `payment_link_partial`, with actor, invoice, amounts and reason). The reason is also stored in Razorpay `notes.partial_reason` and in `payment_transactions.webhook_data`.
  - The link-reuse check also matches the reason, so an old partial link is not reused for a different request.
- Clients: `SendPaymentLinkDrawer.tsx`, `PurchaseMembershipDrawer.tsx` and `POS.tsx` stop sending a free-form amount. The internal callers (`send-reminders`, `ai-tool-executor`, `whatsapp-member-menu`, `MemberStore`) are checked so they still work and get charged the due amount.
- Small tests cover the amount rule: due is used by default; partial without a reason is refused; partial ≥ due is refused; a member's partial request is refused.
- Deploy the function, re-run the security scan and mark both payment-link findings fixed. The other 20 warnings are out of scope for now.
