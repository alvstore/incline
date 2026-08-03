# My Workout / My Diet theming + Razorpay convenience fee

## Part 1 — Make My Workout and My Diet look like one product

Today the two member pages were built at different times, so they diverge: My Workout has a gradient hero and the new day-wise viewer (`WorkoutPlanViewer`), while My Diet still uses plain cards plus its own hardcoded meal accent map (`bg-warning/10`, `bg-success/10`, `bg-accent/10`) that does not follow the Vuexy token set the rest of the app uses.

What changes (presentation only — no query or data changes):

1. **Shared plan shell.** Extract the hero used on My Workout into a reusable `PlanPageHero` (title, goal chip, trainer/validity meta, download action slot) and use it on both pages, so the gradient, radius, shadow and spacing are identical.
2. **Diet page restyle.** Rebuild the diet body with the same card language as the workout day cards: `rounded-2xl`, soft slate shadow, no borders, `text-slate-500` uppercase section labels, `lucide-react` icons in tinted round badges.
3. **Token cleanup.** Replace the ad-hoc meal accent palette with the project's semantic tokens (primary / accent / success / warning) so both light and dark themes stay correct.
4. **Consistent states.** One shared skeleton, empty state and error state component for both pages (currently the diet page and workout page render different loaders and empty copy).
5. **Optional parity, kept in scope:** give the diet plan the same segmented Today / Day / Week rhythm as the workout viewer, so a member switching tabs gets the same mental model. Meals for the selected day, week grid for the whole plan.

## Part 2 — Razorpay convenience fee (membership only)

### What Razorpay is actually charging you

Confirmed from the payment records:

| Payment | Amount | Razorpay fee | GST on fee | Net received |
|---|---|---|---|---|
| pay_TJDQMX77ASPTvP | ₹13,000 | ₹306.80 | ₹46.80 | ₹12,646.40 |
| pay_TI8rh1IsinMqhA | ₹30,000 | not captured | not captured | not captured |
| pay_TIZnfIftcLHeK2 | ₹30,000 | not captured | not captured | not captured |

So the effective rate on the one fully captured record is about **2.36% + 18% GST** (card). The two ₹30,000 payments were settled by an older reconciler build that did not store `gateway_fee` / `gateway_tax`, which is why the deduction shows blank in Payments and the member drawer.

### Backfill the missing deductions

Both missing rows carry a real `pay_...` id, so the fee is recoverable from Razorpay. Add a small admin-triggered backfill (`backfill-razorpay-fees` edge function) that:
- finds `payments` rows with `payment_source` in (`razorpay`, `gateway`) and a `pay_...` transaction id where `gateway_fee` is null,
- calls Razorpay `GET /payments/{id}` with the stored branch/global credentials,
- writes back `gateway_fee`, `gateway_tax`, `net_settlement_amount` on both `payments` and the matching `payment_transactions` row,
- returns a per-payment report so you can see exactly what was recovered.

Run it once for the two ₹30,000 payments; it stays available for any future gap.

### Charging a convenience fee going forward

New settings on the Razorpay integration (stored in `integration_settings.config`, editable from Integrations → Razorpay, no code change to alter rates):

- `convenience_fee_enabled` (on/off)
- `convenience_fee_percent` (e.g. 2.36)
- `convenience_fee_fixed` (flat add-on, optional)
- `convenience_fee_gst_percent` (default 18)
- `convenience_fee_cap` (optional maximum)
- `convenience_fee_label` (what the member sees, default "Online payment convenience fee")
- `convenience_fee_scope` — locked to membership/PT invoices; **POS and store product invoices are excluded**

Behaviour:
- When a member opens the checkout for an eligible invoice, the fee is computed server-side and shown as a clearly labelled extra line before they pay: plan amount, convenience fee, total payable.
- Paying by cash/UPI-at-desk never adds the fee — it only applies to the online gateway path.
- The fee is recorded as its own invoice line item so GST reporting and the invoice PDF stay correct, and the settled payment still reconciles against the invoice total.
- Finance gets a "Gateway cost vs convenience fee recovered" comparison so you can see whether the configured rate actually covers what Razorpay deducts.

### Where the fee is NOT applied

POS sales and store product checkouts keep their current totals untouched — the trigger that recomputes store totals server-side stays authoritative and ignores the convenience-fee config.

## Technical notes

- Frontend: `src/pages/MyWorkout.tsx`, `src/pages/MyDiet.tsx`, new shared components under `src/components/member/plan/`.
- Config: extend `payment_gateway_razorpay` in `src/config/providerSchemas.ts` with the config-section fee fields.
- Server: fee computation lives next to order creation (`create-payment-order`, `create-razorpay-link`) so the client can never set its own fee; the fee line is appended to the invoice atomically.
- Backfill: new `supabase/functions/backfill-razorpay-fees`, reusing the credential resolution already in `reconcile-razorpay-links`.
- Display: `src/lib/payments/paymentDisplay.ts` gains a recovered-vs-cost helper used by Payments and the member profile drawer.
