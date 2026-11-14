# Fix: Razorpay payment links not being captured

## What I found
- The link sent today at 6:03 PM (INV-INC-26-0198: invoice ₹18,000, link ₹18,424.80 with the online convenience fee) is still "created". The invoice shows ₹0 paid.
- **Razorpay has never delivered a payment webhook here.** None of the 59 link records has webhook data, the payment webhook function has no logs, and the last capture was on 29 Jul. All 56 links are still "created", so Webhook Activity has nothing to show.
- The backup checker (runs every 5 minutes) is our only safety net, and it has a bug: when a link includes the convenience fee, it tries to record the full charged amount (₹18,424.80) against a ₹18,000 invoice. The webhook code already splits off the fee, but the checker doesn't, so a paid link with a fee can fail every run without any visible error.
- I haven't confirmed yet whether the member actually paid. Step 1 checks that.

## Plan
1. **Check today's link with Razorpay first** (read-only). If it's paid, record it right away: ₹18,000 to the invoice, ₹424.80 as the convenience fee.
2. **Fix the backup checker:** split the convenience fee the same way the webhook does. Credit the invoice with the base amount and keep the fee and Razorpay deductions in the payment details. One rule shared by both paths, with tests (₹18,424.80 paid → ₹18,000 credited, ₹424.80 fee).
3. **No more silent failures:** every checker result (paid, still waiting, expired, amount mismatch, error) is logged to Webhook Activity with a reason, and mismatches go through the standard error log so they show up in System Health.
4. **Webhook Activity page:**
   - a "Webhook not connected" banner when Razorpay hasn't delivered anything in 7 days, showing the exact URL and events to set up in Razorpay
   - a "Check with Razorpay now" button on each pending link
   - an "Auto-checked" label on payments the checker recorded
5. **Clean up the 56 old links:** run the checker once on all of them. Paid ones get recorded (no duplicates, because entries are keyed by the Razorpay payment ID). Expired or cancelled ones get marked as failed.
6. **Keep duplicate protection:** the webhook and checker both stay keyed by the Razorpay payment ID, so replaying the same event does nothing the second time. Signature checks stay strict.

## What you need to do in Razorpay (I can't do this part)
Under Settings → Webhooks, add the payment webhook URL (shown in the new banner). Select payment_link.paid, payment.captured and payment.failed, and use the same webhook secret saved in Integrations. Until then, payments will still come through via the 5-minute checker after this fix.

## Technical notes
- `reconcile-razorpay-links` v3.1.0: base = invoice balance at link time from `webhook_data`/fee quote; `p_amount = base`, fee in metadata; logs outcome rows into `payment_transactions.webhook_data.reconcile`.
- Shared `_shared/razorpayAmounts.ts` + bun test.
- Banner query: latest `payment_transactions` with `webhook_data ? 'event'`.
