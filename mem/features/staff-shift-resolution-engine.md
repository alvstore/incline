---
name: Staff shift resolution engine
description: How a staff gate/manual punch is matched to a roster block (dual shifts, night, overrides) and how lateness is computed
type: feature
---
# Staff shift resolution engine

Canonical order for every staff punch — never assume morning:

actual punch time → IST date → `staff_shift_overrides` (date override wins) → weekly `staff_shifts` → correct block → grace → late → store → notify.

## Resolver
- `public.resolve_staff_shift(user_id, ts, branch_id)` is the only place a block is chosen. Returns `shift_type, scheduled_start, grace_min, is_off, has_schedule, shift_date, is_overnight`.
- `_staff_roster_for_date` gives date overrides precedence, and an override inherits `late_grace_min` from the matching weekly roster row.
- Dual shifts (e.g. 06:00–11:00 + 18:00–22:00) are separated by an early-arrival window `hr_settings.pre_shift_match_min` (default 120 min) plus a midpoint/gap rule — NOT `evening_start - grace`. A 16:57 punch resolves to the 18:00 evening block and is on time.
- Small-hours punches attach to the previous day's night block (`is_overnight`).
- Grace precedence: roster `late_grace_min` → branch `hr_settings` → 15 min.

## Recording
- `staff_record_punch(user_id, branch_id, check_in, source, notes)` is the ONLY write path for gate/manual/imported punches. One row per `(user_id, shift_date, shift_type)`; repeat scans inside the block return NULL and are ignored. Never insert into `staff_attendance` directly.
- `check_in` must always be the real hardware scan time. Webhook arrival time / cron run time are forbidden — they invent lateness.

## MIPS timestamps
- `supabase/functions/_shared/mipsTime.ts` is the single parser used by both `mips-webhook-receiver` and `reconcile-mips-pass-records`. Naive `YYYY-MM-DD HH:mm:ss` values are IST (terminal local time); numeric values are epoch (unit inferred from magnitude). Both paths must resolve the same instant or the two importers disagree.
