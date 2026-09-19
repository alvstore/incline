# Sauna shows as "Other" — make benefit names and usage consistent

## What is wrong today

Vineet's usage history shows two rows for the same thing: one labelled **Sauna Access**, one labelled **Other**. Both are in fact Sauna Therapy sessions — his two purchased sessions, one used today via the booking and one recorded by hand.

Two separate causes were confirmed in the data:

1. The usage history table does not load the real benefit name, so it falls back to a generic code. Custom benefits such as Sauna Therapy are stored internally under the generic code "other", which is what is being printed.
2. The manual Record Usage entry saved itself under that same generic code instead of Sauna, because the purchased add-on record still carries the old generic code, so the two rows look like different benefits.

His balances are correct: two sauna sessions bought, both now used. No balance correction is needed.

## What will change

**1. Always show the real benefit name**
Usage history, and every other place a usage row is listed, will show "Sauna Therapy" (the name staff actually see on the benefit card) instead of "Other" or "Sauna Access". Old rows will display correctly too, because the name is resolved from the linked benefit, not from the stored code.

**2. One consistent benefit code per session**
When a session is recorded — by booking or by hand — it will be saved against the correct benefit code derived from the benefit itself, so booking-created rows and manually created rows line up exactly. Existing add-on credit and usage rows carrying the stale generic code will be corrected to point at the right benefit.

**3. Block accidental double deduction**
If a session for that benefit on that date was already deducted by a booking, Record Usage will refuse the second entry and explain that it is already recorded from the booking, with the booking time shown. Staff can still record a session for a different date.

**4. Bookings and benefit tracking stay in sync**
The Facility Bookings page and Benefit Tracking will read the same names and the same usage rows, so an attended sauna booking always appears once, under the same label, on both screens.

## Technical notes

- `src/services/benefitService.ts` — `fetchBenefitUsageHistory` joins `benefit_types:benefit_type_id(name, code)`; returned rows expose a resolved `label`.
- `src/pages/BenefitTracking.tsx` — usage history badge uses the resolved label; purchased-only balance cards derive `benefit_type` from `safeBenefitEnum(benefit_types.code)` instead of the credit row's stored enum.
- `src/components/benefits/RecordBenefitUsageDrawer.tsx` — resolves the enum from the benefit type before calling the RPC; pre-checks `benefit_usage` for an existing `booking_id` row matching benefit type + date and blocks submit with an explanatory inline message (Vuexy alert styling, no new dialog).
- Data fix (no schema change): update `member_benefit_credits` and existing `benefit_usage` rows for custom types so `benefit_type` matches `safe_benefit_enum(benefit_types.code)` where `benefit_type_id` is set. Balances untouched.
- Query keys invalidated through the existing `invalidateBenefitData` helper so all bookings, credits and tracking views refresh together.
