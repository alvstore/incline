
## Problem audit

I traced all three complaints to the same underlying flaw: **the Campaign Wizard treats "Submit to Meta" as a side quest that has no relationship with the campaign the user is actually building.**

Concretely, in `src/components/campaigns/CampaignWizard.tsx`:

- `handleSubmitMetaTemplate()` (line 277) creates a `templates` + `whatsapp_templates` row named `campaign_<timestamp>` and stops there. **It never writes to `campaigns`.** That is why `whatsapp_templates` has `campaign_1784104215124` but `SELECT count(*) FROM campaigns` returns 0 — the Campaigns page has nothing to show.
- `handleSubmit()` (line 411) hard-blocks scheduling whenever `blockedByTemplate` is true, and the picker (`approvedTemplates` query, line 93) only lists `status='APPROVED'` rows. So a user who just submitted a template for approval **cannot schedule a send at all** — the flow forces them to either wait days for Meta or send freeform (which fails for cold audiences).
- The picker returns every approved WhatsApp template in the workspace (91 rows), unfiltered by campaign type, name prefix, or "this session's submission". That is the "confusion" the user is describing.

Everything below fixes these three symptoms as one connected change.

---

## Plan

### 1. "Submit to Meta" persists a draft campaign (issue #1)

In `handleSubmitMetaTemplate()`:

- After the `manage-whatsapp-templates` call succeeds, `upsert` a row in `campaigns` with:
  - `name` = the user-typed campaign name (fallback to `safeName`)
  - `status` = `'pending_template_approval'` (new status value)
  - `template_id` = the local `templates.id` just created
  - `channel`, `campaign_type`, `message`, `subject`, `audience_filter`, `attachment_*`, `event_meta` = current wizard state
  - `trigger_type` = whatever is selected (`send_now` becomes `draft` here — nothing sends yet)
- Store the returned `campaign.id` in wizard state (`draftCampaignId`) so any later "Save"/"Schedule" click *updates* that row instead of creating a duplicate.
- Toast changes to: *"Template submitted to Meta · draft campaign saved. You can schedule it now — it will send once Meta approves."*
- Invalidate `['campaigns', branchId]` so the Campaigns list renders it immediately with a "Awaiting Meta approval" badge.

Campaigns list badge: add `pending_template_approval` to `CampaignStatusBadge` (amber, "Awaiting Meta approval"). The existing `getCampaignReport()` path is unaffected.

### 2. Allow scheduling while template is PENDING (issue #2)

Wizard changes:

- Extend the picker query to include `status IN ('APPROVED','PENDING')` when `trigger === 'scheduled'` or `trigger === 'automated'`. `SelectItem` shows a small amber "PENDING" chip next to pending rows.
- Relax `blockedByTemplate`: for scheduled/automated triggers, a PENDING template counts as "picked" and the Schedule button becomes enabled. Freeform `send_now` still requires APPROVED (unchanged, matches Meta rules).
- In `handleSubmit()`, when the template is PENDING and trigger is scheduled/automated:
  - Save campaign as `status='scheduled'` with `template_id` set. Add a `delivery_metadata.awaiting_template_approval = true` flag.
  - Show summary line: *"Will send at 8:00 PM IST — only if Meta has approved the template by then."*

Worker (`process-scheduled-campaigns` edge fn) changes:

- Before dispatching, re-fetch `whatsapp_templates` by the linked local `templates.meta_template_name`.
  - `APPROVED` → send as today.
  - `REJECTED` / `DISABLED` / `PAUSED` → mark campaign `status='failed'`, write `last_run_error='Meta rejected/disabled template <name>: <reason>'`, and fire a `dispatchCommunication` internal alert to the owner/creator so they see it in the notification bell + email.
  - Still `PENDING` at fire time → move the scheduled slot forward by 30 min, up to 24h. After 24h, fail with `last_run_error='Template still pending Meta approval after 24h grace window'`.
- Reconciler already exists (`reconcile-whatsapp-pending`); no change needed there.

### 3. Template picker auto-scopes to the current campaign (issue #3)

Two-tier filter in the `approvedTemplates` query, in this priority:

1. **This-campaign templates first** — anything with `templates.meta_template_name` matching the auto-generated `campaign_<timestamp>` naming convention **or** matching `campaigns.template_id` on rows the user created in this wizard session (tracked via `draftCampaignId`). These render at the top of the Select under a `"For this campaign"` group.
2. **Campaign-type-matching templates** — filter by `templates.evergreen_kind = campaignType` (promotion / event / announcement / lead_reengagement). Rendered under `"Suggested for {campaign_type}"`.
3. A small `"Show all approved templates"` toggle at the bottom of the Select expands the full list — for the rare case the user wants a template outside their campaign type. Default: off.

Also: when the user hits "Submit to Meta", auto-set `useApprovedTemplate = true` and `selectedTemplateId = <local templates.id>` for the just-created row so it is pre-selected the moment Meta approves (via the existing realtime subscription on `whatsapp_templates`).

### 4. Small UX polish (touch-ups only, no scope creep)

- The Trigger step shows a callout when a PENDING template is attached: *"This template is still awaiting Meta approval. If approved before your scheduled time, we will send. If rejected, the campaign fails with a notification."*
- Campaigns list row for `pending_template_approval` shows a "View Meta status" link that deep-links to Settings → Communication Templates → the row, so the user can chase approval without hunting.

---

## Files affected

- `src/components/campaigns/CampaignWizard.tsx` — draft-campaign persistence, extended picker query, relaxed block logic, PENDING callout.
- `src/services/campaignService.ts` — accept new `status='pending_template_approval'`, small helper to upsert-or-update the draft campaign, and grouping helper for the picker.
- `src/components/campaigns/CampaignStatusBadge.tsx` (or equivalent) — new amber badge for `pending_template_approval`.
- `supabase/functions/process-scheduled-campaigns/index.ts` — pre-dispatch template status check with PENDING regrace + REJECTED failure path + owner notification.
- `supabase/migrations/<new>.sql` — extend `campaigns.status` allowed values if enforced by CHECK constraint (verify first; if `text` no migration needed).

## Verification

- Submit a fresh template from the wizard → campaign row appears immediately in Campaigns list with amber "Awaiting Meta approval" badge.
- Schedule a send for +5 min while template is PENDING → row saves as `scheduled`; worker log shows the regrace behavior; when I manually flip the template to `APPROVED` in the DB, next tick sends successfully.
- Manually flip the template to `REJECTED` → next tick fails the campaign and fires an in-app notification.
- Reopen the wizard on a new campaign of type `promotion` → picker shows only promotion-tagged templates + a "Show all" toggle, not all 91 rows.
