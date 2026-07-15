# Plan — Align RCS/Telinfy, add bulk export, mitigate WA 131049

## Context found in audit

- **Dispatcher** (`dispatch-communication` v1.17.0) already routes `channel:'rcs'` → `send-rcs` (Telinfy). Telinfy RCS is template-only; freeform falls back to SMS.
- **RCS Hub** exists at `Settings → RCS Hub` (Templates / Test Send / Wallet / Reports / Webhooks) — but the **Campaign Manager wizard has no RCS option**. `CampaignChannel = 'whatsapp' | 'email' | 'sms'` in `src/services/campaignService.ts`. That's the root of the "how to send RCS from campaigns" gap.
- **Telinfy bulk-send format** (from `SampleData.xlsx`): columns `CountryCode | MSISDN | <var1> | <var2> | …` — first row is the header, MSISDN is digits only (no `+`), CountryCode separate (91). Extra columns are per-template `lcustomParam` variables (named exactly as in the Telinfy template, e.g. `name`, `amount`, `due_date`, and for the INCLINE template `CUSTOM_PARAM1`).
- **WA 131049** = Meta's per-user pacing throttle on marketing templates when quality/engagement is low. Not a code bug — Meta silently drops the send. Only mitigations are behavioural: use a warmer/opted-in audience, throttle send rate, prefer utility/authentication categories, rotate templates, and (crucially) not resend the same paced template to the same number.

## Changes

### 1. Add RCS as a first-class campaign channel

- `src/services/campaignService.ts` → `CampaignChannel = 'whatsapp' | 'email' | 'sms' | 'rcs'`.
- `src/components/campaigns/CampaignWizard.tsx`:
  - Add RCS tile to the channel picker (icon `Radio`, purple).
  - When `channel === 'rcs'`:
    - Show an **RCS template picker** sourced from `rcs_templates` (branch + global) — reusing the same query pattern as WhatsApp templates. Template selection is **mandatory** (Telinfy RCS has no freeform).
    - Render a **variable-mapping block**: for each `{{param}}` / `lcustomParam` key on the picked template, allow choosing a CRM field (`first_name`, `full_name`, `email`, static value, etc.) — mirrors the WhatsApp variable panel already in the wizard, so users don't need to guess `{{1}}` vs `{{CUSTOM_PARAM1}}` again.
    - Live preview showing the resolved message for the first audience member (fixes the recurring "what am I actually sending" confusion the earlier turns were about).
    - Test-send button already exists — route it via `dispatchCommunication({ channel:'rcs', template_id, payload:{ variables } })`.
  - Hide the freeform body editor when channel is RCS (or show it read-only as "SMS fallback text").
- `send-broadcast` edge fn: pass `channel:'rcs'` and the resolved `variables` map through to the dispatcher (dispatcher already handles the Telinfy call and SMS fallback for `status:'unsupported'`).

### 2. Bulk export "Telinfy Emergency Send" CSV/XLSX

New button on the Campaigns page toolbar and inside the wizard's Review step: **"Download Telinfy bulk file"**.

- Component: `src/components/campaigns/TelinfyBulkExport.tsx`.
- Input: the resolved audience (`resolvedMemberIds` already computed in the wizard) + selected template's variable keys.
- Output: an `.xlsx` matching the Telinfy sample exactly:
  - Row 1 header: `CountryCode`, `MSISDN`, then one column per template variable (using the template's actual param names, e.g. `CUSTOM_PARAM1` for the INCLINE template).
  - Row N: `91`, digits-only phone (strip `+91`), then resolved variable values per contact.
- Uses `xlsx`/`SheetJS` (already in the project via existing CSV utilities) to write the workbook client-side; falls back to CSV if xlsx bundle not desired.
- Works for **any** channel selection but is labelled "For Telinfy manual upload (emergency)" so operators know it's a fallback path.

### 3. WhatsApp 131049 pacing — product-level mitigations

Not a fix in code (Meta pacing is opaque), but the app should stop making it worse and give the operator visibility:

- **Retry suppression**: in `process-whatsapp-retry-queue`, treat `131049` as **terminal** (do NOT retry). Currently it retries, which further tanks template quality. Add `131049` to the terminal-error set alongside `131026`, `131047`, `132000`, `132015`, `132016`.
- **Per-recipient cooldown**: before enqueuing a marketing send, check `communication_logs` for a `131049` failure to the same `recipient + template_id` in the last 24 h → skip with `delivery_status='suppressed'`, reason `pacing_cooldown`.
- **Wizard warning banner**: on the Review step, if the selected template has ≥3 `131049` events in the last 7 days (quick count query on `communication_logs`), show an amber banner: *"Meta is pacing this template. Consider rotating templates, warming the audience, or using RCS/SMS."* with a one-click "Switch to RCS" if an equivalent RCS template exists.
- **Docs**: add a short section to `docs/communication-dispatcher.md` explaining 131049 and the mitigations above so the team stops treating it as a bug.

### 4. Variable-alignment recap (from earlier turns, now closed)

Already fixed in prior edits — restating so this plan is self-contained:
- CRM template `variables` array is derived from the highest `{{N}}` in the body, and the dispatcher's `orderedTemplateKeys` maps `first_name → {{1}}` without duplicating parameters.
- The new RCS variable-mapping UI extends the same pattern to `lcustomParam` keys so both Meta WhatsApp templates and Telinfy RCS templates behave identically in the wizard.

## Files touched

- `src/services/campaignService.ts` — add `'rcs'` to `CampaignChannel`.
- `src/components/campaigns/CampaignWizard.tsx` — RCS tile, RCS template picker, variable mapper, preview, hide freeform body.
- `src/components/campaigns/TelinfyBulkExport.tsx` *(new)* — xlsx export in Telinfy format.
- `src/components/campaigns/RcsTemplatePicker.tsx` *(new)* — reads `rcs_templates`, exposes param keys.
- `supabase/functions/send-broadcast/index.ts` — accept `channel:'rcs'` + `variables` map.
- `supabase/functions/process-whatsapp-retry-queue/index.ts` — add `131049` to terminal set.
- `supabase/functions/dispatch-communication/index.ts` — pre-send 24 h pacing cooldown for `131049`.
- `docs/communication-dispatcher.md` — 131049 mitigation notes.

## Out of scope

- Changing Meta template categories or resubmitting templates (requires Meta approval, not a code change).
- Auto-syncing Telinfy template param names into the CRM — currently Telinfy templates are already synced by `rcs-templates-sync`; we just surface their param keys in the wizard.
