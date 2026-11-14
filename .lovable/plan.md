# Reusable payment link template + live, animated Webhook Activity

## 1. Reusable "payment link" WhatsApp message (Meta, Utility)
- Submit one new Meta template, `payment_link_v1`, in the Utility category, worded to work for any purchase (membership, PT, store, locker, part payment):
  "Hi {{1}}, your payment of ₹{{2}} for {{3}} (ref {{4}}) is ready. Pay securely here: {{5}}. Reply to this message if you have any questions. — Team Incline"
- The variables are name, amount, what it's for, the invoice number and the link. Meta will get sample values for each.
- Save it in CRM Templates under a new `payment_link_sent` event so it shows in Coverage and Automations.
- Wherever staff send a payment link (Collect Due, invoice and purchase drawers), WhatsApp will use this template automatically, so links reach members even outside the 24-hour chat window. Email and SMS stay as they are.
- Submit it only once, avoiding the earlier duplicate mistake. It starts as PENDING; Meta usually approves within 48 hours.
- After approval, resend Nayan Suhalka's link (INV-INC-26-0198) through it.

## 2. Webhook Activity page: live updates and motion
- Live: new or changed deliveries slide in on their own, with no hard refresh. Each new row gets a short highlight and a "Live" dot in the header. The 30-second polling stays as a quiet backup, and the open filters, page and expanded row are kept.
- Motion, matching the Approvals and Tasks pages: animated title, staggered entrance for the summary cards, count-up numbers for the totals, and row entrance when filters or pages change. Reduced-motion settings are respected.
- Nothing else changes: no filters, columns or payment logic.

## Technical details
- Template: one `manage-whatsapp-templates` submit call. Add `payment_link_sent` to `systemEvents.ts` and a `whatsapp_triggers` row. The link sender (`create-razorpay-link` caller paths) calls `dispatchCommunication` with `event_key: 'payment_link_sent'` and positional variables, with the dedupe key set to the plink id.
- Realtime: check that `payment_transactions` is in the realtime publication and add it if it's missing (doorbell pattern). Debounce invalidation, track ids that are new since the last render for the highlight, and use one stable channel name.
- Motion: reuse `src/components/motion/pageMotion.ts` (`usePageEntrance`, `useRowsEntrance`, `CountUp`, `SplitTitle`) in `IntegrationWebhooks.tsx` and `WebhookActivityPanel.tsx`.
