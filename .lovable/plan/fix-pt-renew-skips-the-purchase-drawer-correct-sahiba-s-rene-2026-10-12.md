# Fix: PT "Renew" skips the purchase drawer + correct Sahiba's renewal

## What happened (checked)

- On the PT Clients tab, **Renew** calls the renewal routine directly with no questions. It reuses the package's list price (₹10,000), defaults to **cash**, starts **today**, and the tax rule then issued a **GST INV** bill. That is how INV-INC-26-0163 (₹10,000, paid, 12 Oct) was made.
- Sahiba's previous package (Silver, ₹8,000 cash, BOS-INC-26-0039) ran 20 Aug – 19 Sep. The new one wrongly runs 12 Oct – 11 Nov.

## 1. Renew always opens the PT purchase drawer

- Renew (row button and the "..." menu) opens the **Purchase PT Package drawer** already filled in: same member, same trainer, same plan, start date = day after the last package ended (or today if it ended long ago — staff can change it).
- Staff confirm amount, discount, GST or no GST, payment mode, collect now / balance and due date — the same three steps as a new purchase. Nothing is created until **Charge & Assign** is pressed.
- The old one-click path is switched off behind a setting (`pt_renew_direct_enabled`, default **off**) so it can be turned back on if ever needed, without a code change.
- Accessibility: the drawer moves focus to its title, Renew buttons get clear labels ("Renew PT for Sahiba Mehndiratta"), loading is announced, 44px touch targets.
- Analytics: `pt_renew_opened`, `pt_renew_completed` (plan, mode, GST yes/no — no names or amounts per person), fired only after the server confirms.

## 2. Correct Sahiba's renewal (no cancellation)

Keep the same bill record and change it in place, with an audit note "corrected: renewal entered without drawer":

- Package dates: **20 Sep 2026 – 19 Oct 2026** (continues from her last expiry).
- Price **₹8,000**, payment **cash**, **no GST**.
- Bill INV-INC-26-0163 is re-numbered into the **BOS series** (next BOS number), GST lines removed, total and paid ₹8,000; the payment row becomes ₹8,000 cash.
- Trainer commission for Bhagirath Gurjar is recalculated on ₹8,000 for the corrected dates.
- Zoho: if this bill was already sent, it is flagged for you to delete in Zoho (BOS bills never go to Zoho). I'll confirm whether it reached Zoho before changing anything.

Note: with these dates her package ends **19 Oct** (7 days from now). Tell me if you meant a different start.

## Technical notes

- `PTSessions.tsx` `handleRenewPackage` → open `PurchasePTPackageDrawer` with new `renewFrom` prop (member, trainer, catalog package, suggested start); submit goes through existing `purchase_pt_package` (not `renew_pt_package`), so GST/BOS, partial payment and idempotency rules are identical to a new purchase.
- `renew_pt_package` RPC: refuse direct calls unless `settings.pt_renew_direct_enabled = true`.
- Data fix via one guarded SQL transaction: update `member_pt_packages`, `invoices` (number, gst_rate 0, amounts, series), `invoice_items`, `payments`, rebuild `pt_commission_installments`, write `audit_logs`. Check `zoho_sync_log` first.
- Test: renew now requires the drawer (server refuses direct call when flag off).
