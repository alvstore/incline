# Duration Presets for Plan Assignment

Replace the confusing manual "Valid Until" date picker in the Assign Plan drawer with one-tap duration presets that auto-calculate the end date.

## What changes

**Duration chips (primary control)**
- Presets: 7, 15, 30, 45, 60, 75, 90 days.
- The preset matching the plan's own length (e.g. a 1-week plan → 7 days, a 4-week plan → 30 days) is pre-selected and marked "Recommended".
- Selecting a chip instantly computes and displays the end date, e.g. "Starts 05 Aug 2026 → Ends 11 Aug 2026 (7 days)".
- Chips show both the number and a friendly label (1 week, 2 weeks, 1 month, 6 weeks, 2 months, 10 weeks, 3 months).

**Start date**
- Defaults to today. A small "Starts today" row with an optional "Change" link reveals a date input for the rare backdated / future start. End date recalculates automatically.

**Manual override**
- A "Custom date" chip at the end of the row reveals the existing date input, so nothing is lost for edge cases.

**Warning for mismatch**
- If the chosen duration is shorter than the plan's own content length (e.g. 90-day plan content assigned for 7 days), show an inline amber note: "This plan contains 12 weeks of content — members will lose access before finishing it."

## UI/UX polish (Vuexy)

- Duration chips: `rounded-full`, selected = primary fill, unselected = bordered/muted, 44px touch targets, visible focus rings.
- The validity block becomes a full-width card (`rounded-2xl` soft shadow) instead of being cramped into a half-width grid cell next to "Notify on"; "Notify on" moves to its own row so both breathe.
- Computed end date shown as a bold data value with the day-of-week, so staff can sanity-check at a glance.
- Section labels use the uppercase tracking-wider style.
- Same treatment applied to the sheet's summary strip so the header badge reflects the selected duration, not just the plan's own weeks.

## Technical notes

- File: `src/components/fitness/AssignPlanDrawer.tsx` (presentation only).
- New local state: `durationDays` (number | 'custom'), `startDate`.
- End date = `addDays(startDate, durationDays - 1)` (inclusive), consistent with the membership duration convention already used in `src/lib/memberships/duration.ts`.
- Pass `valid_from: startDate` alongside `valid_until` to `assignPlanToMembers` — the service and `member_fitness_plans` already support `valid_from` but the drawer never sent it, so assignments always recorded today. This also fixes future-dated starts.
- `sendPlanToMember` payload gains `valid_from` so the PDF header shows the real window.
- Duration preset helper extracted to a small module so the same chips can later be reused by the resend/reassign flows.
- No database or edge function changes.
