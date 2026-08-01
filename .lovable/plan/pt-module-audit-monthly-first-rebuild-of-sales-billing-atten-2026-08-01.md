# PT module audit — monthly-first rebuild of sales, billing, attendance and commission

Your catalogue is already 100% monthly (Silver, Gold, Platinum, Ascent 90 — all `package_type = monthly`, `total_sessions = 0`), but most of the PT engine was written for session packs. That mismatch is where the conflicts are.

## What the audit found (verified against the live database and code)

**1. Two different session engines are live at the same time**
- `log_pt_session` (canonical, used by the trainer attendance tab and Mark-status menu) handles monthly correctly: checks expiry, does not consume sessions, auto-creates a gym check-in.
- `complete_pt_session` (legacy, still wired to the PT dashboard's Complete button) does `price_paid / sessions_total`. Every current package has `sessions_total = 0`, so this is a **division-by-zero crash on monthly packs**. It also hardcodes a 10% commission, ignoring the trainer's `pt_share_percentage`, and writes the commission without the `earned_unconfirmed` gating the purchase flow uses.

**2. GST is contradictory**
The purchase RPC hard-rejects anything other than 5% inclusive, but the catalogue holds `Platinum = 18%` and `Ascent 90 = 0% exclusive`. The create-package drawer defaults to GST off / 18% and offers 5-12-18-28. So the price a manager sets and the price the invoice charges can disagree.

**3. Creating a monthly/quarterly subscription package can fail**
The create drawer sends `sessions_per_month`, which does not exist on `pt_packages`.

**4. Duration math is 30-day based, not calendar**
Purchase sets expiry as `CURRENT_DATE + duration_months * 30`, and the custom-pack path in the purchase drawer does the same. Memberships already moved to calendar-month math; PT did not, so a 3-month pack sold on 31 Jan expires on a different day than the equivalent membership.

**5. No lifecycle for monthly PT**
There is no cron job and no automation rule that expires `member_pt_packages`. An expired monthly pack stays `active`, keeps counting in the "Active Memberships" KPI and trainer revenue, and only fails at the moment a trainer tries to log a session. There is also no renewal path — the only way to continue a monthly client is to sell a brand-new pack.

**6. Legacy `session_type` vs `package_type`**
Two overlapping fields describe the same thing; badges and filters read different ones in different places.

**7. Dashboard reads as session-first**
Active packages show "0/0 sessions" for monthly clients, the CSV export has session columns only, and the completion-rate KPI only looks at sessions from today forward.

## What will be built

### A. One session engine
- Retire `complete_pt_session`; point the PT dashboard's complete/cancel actions at `log_pt_session` (with the existing status menu: present / late / absent / holiday).
- Commission for session-based packs moves into `log_pt_session` using the trainer's real share, written as `earned_unconfirmed` like the purchase path.

### B. Monthly-first sales flow
- Rebuild the purchase drawer around monthly as the default tab: plan card, start date, duration, calendar-correct end date preview, GST-inclusive breakdown, trainer + share preview, pay now / payment link.
- Add a staff-facing "Sell PT" entry directly on the PT dashboard (member picker inside the drawer) so PT is sellable without opening a member profile first.
- Custom packs use calendar months, inherit the 5% inclusive rule.

### C. Billing consistency
- Force PT catalogue to 5% GST inclusive: create/edit drawers lock the rate and explain it; a migration normalises the four existing rows (Platinum 18 → 5, Ascent 90 0/exclusive → 5/inclusive) without changing the displayed price.
- Remove the `sessions_per_month` write; add the field to the schema only if you want it tracked (say the word and I will include it as a real column with an "expected sessions/month" label).

### D. Monthly renewal + expiry lifecycle
- New `renew_pt_package` RPC: extends the same client on the same plan from the current expiry (no gap), issues its own invoice, schedules the next commission tranche.
- New automation-brain rule `expire_pt_packages` (daily): flips `active` monthly packs past `expiry_date` to `expired`, and fires an expiry-soon nudge at T-5 days through the standard dispatcher.
- Renewal-due list on the PT dashboard: who expires in the next 14 days, with one-click renew.

### E. Attendance and commission truth
- Monthly attendance panel keyed by days-remaining and sessions-this-month rather than a depleting counter.
- Commission tranches for monthly packs release against confirmed payment/renewal instead of a fixed 30-day drip; the release path in `activate_pt_package` will be read and adjusted in the same pass.
- Trainer earnings screen splits "confirmed" vs "awaiting payment" clearly.

### F. Dashboard UI (2026 pass)
- KPI row reworked for monthly: active monthly clients, MRR from PT, renewals due, attendance rate this month.
- Active-clients table shows plan, trainer, start, expiry, days left, this-month attendance, payment status — with session columns only for session-based rows.
- CSV export matches the new columns.

## Technical notes

- Migrations: normalise PT GST rows; add `pt_calendar_expiry(start date, months int)` helper and switch `_purchase_pt_package_impl` to it; new `renew_pt_package` and `expire_pt_packages` RPCs; drop `complete_pt_session` after the UI is repointed.
- Frontend: `src/pages/PTSessions.tsx`, `src/components/pt/PurchasePTPackageDrawer.tsx`, `AddPTPackageDrawer.tsx`, `EditPTPackageDrawer.tsx`, `PtAttendanceTabContent.tsx`, `src/services/ptService.ts`, `src/hooks/usePTPackages.ts`, plus a new `RenewPtPackageDrawer.tsx` and `PtRenewalsDueCard.tsx`.
- All new drawers follow the Sheet-only rule and Vuexy card styling; all queries stay branch-scoped and role-gated (`can.*`).
- The single existing member PT row is `reversed`, so there is no live data to migrate — the cleanup is safe to do now.
