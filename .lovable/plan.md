
## Audit: why +91 98876 01200 (Rajat) failed

Rajat is a **staff/admin recipient** of the internal new-lead alert (not the lead itself). Three failures in `communication_logs` all show:

```
error: 132018: template_param_empty:staff_name,lead_name
       (blocked pre-flight; provide full_name or use a no-name template)
template: internal_lead_alert
category: new_lead
```

### Root cause

Meta template `internal_lead_alert` body:
```
Hi {{1}}, a new lead has been generated. Name: {{2}}, Interest: {{3}}, Source: {{4}}.
```
Local `whatsapp_templates.variables` maps positional slots → `[staff_name, lead_name, plan_interest, lead_source]`.

In `supabase/functions/notify-lead-created/index.ts`:
- The `vars` bag built at line 155 contains `lead_name`, `plan_interest`, `lead_source` — **but never `staff_name`**.
- `sendTeamBundle` fetches admin/manager profiles with only `id, phone, email` (no `full_name`), then dispatches the same shared `vars` for every recipient.
- Dispatcher pre-flight (`dispatch-communication/index.ts:727`) sees `staff_name` empty → hard-fails with 132018 before hitting Meta.
- Retry queue re-runs the same payload → same failure. That is exactly the pattern for Rajat's row (`dedupe_key: retry:...:2`).

`lead_name` shows up in the "missing" list on some rows because those particular leads had no `full_name` captured (self-onboard first step). The `|| "Guest"` default is fine going forward; the real gap is `staff_name`.

### Fix

**1. `supabase/functions/notify-lead-created/index.ts`**
   - Include `full_name` in the `profiles` selects for admins and managers.
   - Change `sendTeamBundle` to accept the recipient profile's name and pass a **per-recipient variables override** to `dispatch`, merging `{ staff_name: profile.full_name || 'Team' }` on top of the shared `vars`.
   - Update the `dispatch()` helper to accept an optional `varsOverride` and merge it into the payload's `variables`.
   - Keep `lead_name: lead.full_name || 'Guest'` default (already correct).

**2. `supabase/functions/dispatch-communication/index.ts` (defence-in-depth)**
   - In the pre-flight `missingRequired` check, when `input.category === 'new_lead'`, auto-fill any missing `staff_name`/`team_member_name`/`recipient_name` key with `'Team'` before evaluating (so a future caller that forgets can't block internal ops). Still enforce for genuinely lead-facing MARKETING sends.

**3. Clear the poisoned retry rows**
   - Mark the three still-`failed` new_lead logs for +91 98876 01200 as `suppressed` (with metadata note `manual_backfill: pre_flight_bug_fixed`) so the retry queue doesn't keep churning on the old payloads. New lead events after deploy will use the fixed path.

### Files touched
- `supabase/functions/notify-lead-created/index.ts` — vars override + fetch `full_name`
- `supabase/functions/dispatch-communication/index.ts` — `new_lead` fallback for `staff_name`
- One-shot SQL update on `communication_logs` for the 3 stuck rows

### Not changed
- Meta template stays as-is (already APPROVED with 4 vars).
- No schema changes; no client changes.
- Retry queue logic unchanged — the fix removes the source of the failure.

### Verify after deploy
- Create a test lead → check `communication_logs` for a `sent` row with `delivery_metadata.template=internal_lead_alert` to Rajat's number, no `pre_flight_block`.
- Confirm Meta message renders `Hi Rajat, a new lead has been generated. Name: <lead>, Interest: <plan>, Source: <src>.`
