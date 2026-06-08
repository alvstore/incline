## Problem

v8.0.0 introduced new `ops_config` fields the existing UI doesn't expose:
- `schedule_minutes: number[]`
- `window_hours: number`

The `HandleOpsSettings` panel for `lead_nurture` only edits the original four fields:
- `enabled`, `delay_hours`, `max_retries`, `cooldown_hours`

Result: changing values from the UI does nothing — the edge function reads keys that aren't on the form. No new UI is wanted; the edge function must honour what the existing UI saves.

## Fix — make the edge function respect the UI contract

Rewrite the cadence block in `supabase/functions/lead-nurture-followup/index.ts` (no UI changes, no schema/migration, keep freeform-only + 24h window + angle rotation/tone variety):

1. **Read only the UI fields** from `ai_purposes.ops_config`:
   - `enabled` (bool)
   - `delay_hours` (number, default 2) — wait before the first nudge
   - `max_retries` (number, default 3) — total nudges per lead
   - `cooldown_hours` (number, default 6) — wait between subsequent nudges
2. **Derive the per-retry wait** internally (no DB field, no UI change):
   - `retryCount === 0` → `delay_hours`
   - `retryCount >= 1` → `cooldown_hours`
3. **Keep the 24h freeform-window guard** but hardcode the window to `24` (WhatsApp protocol constant — not a tunable, so the UI rightly doesn't expose it). Outside window → skip silently and stamp `last_nurture_at`.
4. **Tone intensity** still scales by `attempt / maxRetries` so retries feel different (warm → soft check → soft urgency).
5. **Remove** all references to `schedule_minutes` and `window_hours` from the function, and remove the seed migration line that wrote those keys into `ops_config` (leave the angle seeds — those are still used).
6. Bump header to `v8.1.0 — honour UI ops fields (delay_hours / max_retries / cooldown_hours)`.

## Files

- `supabase/functions/lead-nurture-followup/index.ts` — cadence read + header comment.
- Migration: `UPDATE ai_purposes SET ops_config = ops_config - 'schedule_minutes' - 'window_hours' WHERE purpose = 'lead_nurture';` to clean orphan keys. Keep cron at `*/15 * * * *` (still correct for ~2h granularity).

## Out of scope

- No new settings fields, no new tables, no UI changes.
- Angle rotation, similarity guard, freeform-only path, NurtureVarietyCard — all stay as v8.0.0.

Used the senior-architect skill.