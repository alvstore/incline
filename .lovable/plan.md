## Audit findings (confirmed in DB + code)

### 1. WhatsApp Error 131049 — "not delivered to maintain healthy ecosystem engagement"

**Reality check:** there is **no separate "Marketing API"**. Marketing templates use the same Cloud API. 131049 is Meta's *pacing/ecosystem* drop applied to MARKETING templates when:
- recipient hasn't engaged with your number recently,
- your template's quality rating is low/medium,
- you send the same template repeatedly to the same number, or
- the recipient has many recent marketing messages from other senders.

It is **not a code bug** — it's a deliverability signal. We can only mitigate it.

**Mitigations to ship:**
- Per-recipient cooldown (default 7 days for same MARKETING template) inside `dispatch-communication`.
- Honour `communication_preferences.marketing_opt_in = false` and skip those recipients up-front (we already drop on category, but UI must expose it on Member profile + a 1-click STOP keyword handler in `meta-webhook`).
- Throttle `send-broadcast` MARKETING sends to ≤ 50 / minute per WABA.
- Surface Meta `error_code` + `error_subcode` + human-readable hint in the Campaign Report (`131049 → "Meta paced this message — recipient hasn't engaged recently. Lower frequency, improve template quality, or move to UTILITY"`).
- Add a "Template Quality" column on the Templates Hub that mirrors `whatsapp_templates.quality_score` so the user sees when a template is dropping to LOW.

### 2. Yogita (admin) didn't receive WhatsApp for new leads

Root cause confirmed in `supabase/functions/notify-lead-created/index.ts` lines 162-167: admin alerts are sent as **freeform `type:"text"`** WhatsApp messages. Admins are almost always **outside the 24h customer-service window** for our number → Meta silently drops the message (HTTP 200, wamid issued, no `delivered` webhook). That's why we have no error to look at — the API call succeeded.

**Fix:**
- Add a system event `lead_captured_staff_alert` (UTILITY) to `systemEvents.ts` and seed an approved template (`lead_alert`) with body `New lead: {{1}} ({{2}}) from {{3}} for {{4}}` mapped to `{{lead_name}}, {{lead_phone}}, {{lead_source}}, {{branch_name}}`.
- Rewrite `notify-lead-created` to call `dispatch-communication` with `template_id` for staff/admin/manager alerts (instead of building text body manually). Lead's own welcome message stays as-is (lead just submitted form → they ARE in 24h window).
- Until the new template is APPROVED, fall back to the existing **`lead_notification`** template if already approved (the wizard sync already pulls Meta-approved rows into `templates`).
- Add a delivery-watchdog: if `communication_logs.status='sent'` for >10 min with no `delivered` webhook AND channel='whatsapp' AND no template_id, mark `silently_dropped` and queue an SMS fallback to admins.

### 3. "Hi Sample" is being sent literally

Confirmed in DB. The approved row `whatsapp_templates.wait_is_over_july` was submitted to Meta with body:

```
Hi Sample👋
I'm excited to finally share what we've been building at Incline…
```

There is **no `{{1}}` placeholder** in the BODY component and `variables` is `[]`. Meta has nothing to substitute, so every recipient sees the literal example string "Sample". This is an **AI generator regression** — it dropped the variable into the example instead of keeping it as `{{1}}` in the body.

**Fix:**
- In `ai-generate-whatsapp-templates`, before POSTing to Meta, run a validator:
  - If category = MARKETING/UTILITY and the body contains a name-like word (`Sample`, `friend`, `there`, `Member`) that is **not** wrapped in `{{…}}`, force-replace with `{{1}}` and add `{{1}}: "Sample"` to `example.body_text`.
  - Reject submission if BODY has zero variables but the prompt referenced personalization.
- Mirror the same guard server-side in `manage-whatsapp-templates` so a manually entered template can't reach Meta without placeholders.
- Resubmit a corrected template (Meta does not allow editing an APPROVED template's body — submit `wait_is_over_v2` with `Hi {{1}}👋…`). Existing approved row stays read-only with a warning badge "Static body — no personalization" in the Templates Hub.

### 4. Trainer/Staff code missing (`—` in Staff table)

`trainers.trainer_code` is nullable and has no auto-generation trigger. New trainers created via UI never get a code, so payslips/contracts use the random `id.slice(0,6)` fallback in `hrmService.ts` line 304.

**Fix (migration):**
- Add SQL function `generate_trainer_code(branch_id)` returning `TR-{branch_code}-{seq}` (same pattern as `EMP-{branch_code}-{seq}`).
- Add `BEFORE INSERT` trigger on `trainers` to set `trainer_code` when NULL.
- Backfill existing rows where `trainer_code IS NULL`.
- Same audit on `employees.employee_code` — Bhagirath shows `EMP-MOZWZUNA` (random suffix) because the UI generator at `AddEmployeeDrawer.tsx:94` uses `Math.random()` instead of a sequence. Replace with DB-side function for both.

### 5. Edit Trainer drawer fetches blank fields when opened from HRM page

Root cause in `src/services/hrmService.ts` line 270:

```ts
.select('id, full_name, email, avatar_url')  // missing phone, dob, address, etc.
```

`EditTrainerDrawer` reads `trainer.profile.address / date_of_birth / phone / gender / postal_code / emergency_contact_*`. From HRM page these are all undefined → form shows blank. (Trainers page uses `useTrainers` which already selects the full set, so the bug is HRM-specific.)

**Fix:**
- Expand the profile SELECT in `getUnifiedPayrollStaff` to: `id, full_name, email, phone, avatar_url, gender, date_of_birth, address, city, state, postal_code, emergency_contact_name, emergency_contact_phone, government_id_type, government_id_number`.
- As defence-in-depth, change `EditTrainerDrawer`'s `useEffect` to refetch the trainer via `getTrainer(trainer.id)` when `open` flips to true. This guarantees fresh data even if the caller passes a thin record.

---

## Files to change

| # | File | Change |
|---|------|--------|
| 1 | `supabase/functions/dispatch-communication/index.ts` | Per-recipient MARKETING cooldown, surface 131049 hint in `error_message`, throttle. |
| 1 | `supabase/functions/meta-webhook/index.ts` | STOP keyword → set `communication_preferences.marketing_opt_in=false`. |
| 1 | `src/components/communications/CampaignReportDrawer.tsx` | Show error-code hint table including 131049. |
| 2 | `supabase/migrations/...` | Seed `lead_alert` (UTILITY) template + system event. |
| 2 | `supabase/functions/notify-lead-created/index.ts` | Switch admin/manager sends to `dispatch-communication` w/ `template_id`. |
| 2 | `supabase/functions/process-comm-retry-queue/index.ts` | Add "silently_dropped" watchdog + SMS fallback. |
| 3 | `supabase/functions/ai-generate-whatsapp-templates/index.ts` | Placeholder validator before Meta POST. |
| 3 | `supabase/functions/manage-whatsapp-templates/index.ts` | Same server-side guard for manual submits. |
| 3 | `src/components/settings/TemplateManager.tsx` | Badge "Static body — no personalization" for approved rows with 0 variables. |
| 4 | new migration | `generate_trainer_code()` + trigger + backfill; same for `employees.employee_code`. |
| 4 | `src/components/employees/AddEmployeeDrawer.tsx` & `AddTrainerDrawer.tsx` | Stop generating code client-side; let DB trigger assign it. |
| 5 | `src/services/hrmService.ts` | Expand profile SELECT in `getUnifiedPayrollStaff`. |
| 5 | `src/components/trainers/EditTrainerDrawer.tsx` | Refetch via `getTrainer(id)` on open as safety net. |

## Out of scope (will not touch)

- Switching to a different WhatsApp BSP.
- Editing the already-approved `wait_is_over_july` body (Meta forbids it — we'll submit `_v2`).
- Replacing the existing dispatcher architecture.

## Verification

- 131049: trigger a marketing send to a number with no recent engagement; confirm log row shows `error_code=131049` + hint, and the same recipient is skipped on retry within 7 days.
- Lead alert: create a test lead with Yogita as admin; confirm `communication_logs` row has `template_id` set and a `delivered` webhook arrives.
- "Hi Sample": run AI generator with a personalised prompt; confirm body contains `{{1}}` and `example.body_text=[["Sample"]]` before POST to Meta.
- Trainer code: insert a trainer via UI; confirm `trainer_code` is `TR-INC-0004` (next in sequence).
- Edit Trainer: open Ritesh Sharma from HRM page; confirm DOB / address / phone / gender pre-fill.
