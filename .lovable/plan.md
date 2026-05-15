## Audit findings

**1. Edit / Delete UI is missing on campaign cards**
`src/components/campaigns/CampaignsPanel.tsx` renders campaign cards that only open `CampaignDetailDrawer` (read-only). There is no menu, no edit, no delete, no "duplicate", and no cancel-schedule. `campaignService.ts` also has no `updateCampaign` / `deleteCampaign` / `cancelScheduledCampaign` helpers.

**2. Wizard cannot pick an approved Meta template**
`CampaignWizard.tsx` only sends freeform text. It has a "Submit body to Meta" button (line 416) but never lets you pick an already-approved template. The downstream stack already supports it end-to-end:
- `send-broadcast` v3.1.0 already accepts `template_id` and forwards it to `dispatch-communication` (line 92).
- `dispatch-communication` v1.11.0 already resolves `template_id` → `templates` row → Meta `template_name` and sends as a native WhatsApp template (header_type document/image/video supported, line 460+).
- `send-whatsapp` already has `message_type === 'template'` branch (line 258).

So nothing in the backend is missing — the wizard just never offers the picker, which is exactly why marketing video/PDF sends fail with Meta error 131047 outside the 24h window.

**3. AI template "syncing for approval" is actually working**
`AIGenerateTemplatesDrawer.tsx` (line 161) already calls `manage-whatsapp-templates` with `action: 'create'`, which submits to Meta. `manage-whatsapp-templates` v2.3.0 has full `create` / `edit` / `list` (sync) / `get_status` actions. The "stuck syncing" perception is because:
- After submit, status shows `PENDING` until Meta approves (this is normal, takes minutes to hours).
- The CRM Templates tab doesn't aggressively re-poll Meta for status — user must hit "Sync from Meta" manually.
- No automated `get_status` poll for recently-submitted templates.

## Plan

### A. Campaign list — add edit / delete / duplicate / cancel

**`src/services/campaignService.ts`** — add four helpers:
- `deleteCampaign(id)` — hard delete row (cascades to `campaign_runs`).
- `updateCampaign(id, patch)` — for draft/scheduled only (name, message, subject, scheduled_at, audience_filter, attachment_*, template_id). Block for `sending`/`sent`.
- `duplicateCampaign(id)` — clone as a new `draft`.
- `cancelScheduledCampaign(id)` — flip `scheduled` → `draft`, null `scheduled_at`.

**`src/components/campaigns/CampaignsPanel.tsx`** — add a `DropdownMenu` (three-dots `MoreVertical` button, top-right of each card, `e.stopPropagation()` so it doesn't open the drawer) with:
- View details (existing behaviour)
- Edit — opens `CampaignWizard` in edit mode (only when status ∈ {draft, scheduled})
- Duplicate — clones, opens wizard on the clone
- Cancel schedule — only when `scheduled`
- Delete — `AlertDialog` confirm, then `deleteCampaign` + `invalidateQueries(['campaigns'])`

Wire `useMutation` for each, with toast feedback. Disable edit/cancel/delete when status ∈ {sending, sent}.

**`src/components/campaigns/CampaignWizard.tsx`** — accept optional `editingCampaign?: Campaign` prop. When present:
- Pre-fill all fields (name, channel, message, subject, audience_filter, attachment_*, scheduled_at, template_id).
- On save: call `updateCampaign(id, …)` instead of `createCampaign(…)`.
- Hide "Send Now" when editing a `scheduled` campaign (only "Save schedule").

### B. Approved Meta template picker (cold-audience fix)

**`src/components/campaigns/CampaignWizard.tsx`** — on Message step, when `channel === 'whatsapp'`:
- Add a "Send via approved Meta template (recommended for cold leads)" toggle.
- When ON, show a `Select` populated from `whatsapp_templates` filtered by `branch_id`, `meta_template_status = 'APPROVED'`. Show name + category + preview of body.
- Selecting a template:
  - Auto-fills the message body with the template body (read-only when toggle is ON).
  - Stores `template_id` in wizard state.
  - If template `header_type ∈ {image, video, document}`, force the Creative step's attachment kind to match and require an upload (Meta needs the header media at send time).
- Persist `template_id` on `campaigns.template_id` (column needs to exist; if not, add it via migration: `ALTER TABLE campaigns ADD COLUMN template_id uuid REFERENCES templates(id);`).
- Pass `template_id` through `createCampaign` → `sendCampaignNow` → `send-broadcast` (already plumbed).
- Show an explainer card: "Approved templates can be sent to anyone, no 24h window. Freeform messages only deliver to contacts who messaged you in the last 24h."
- When toggle is OFF and audience contains leads/contacts → show the existing 24h warning.

### C. Template approval visibility (small UX nudge)

**`src/components/settings/CommunicationTemplatesHub.tsx` / CRM Templates sub-tab** — add an auto-poll: every 30s, if any local templates have `meta_template_status = 'PENDING'`, invoke `manage-whatsapp-templates` `action: 'get_status'` for each and refresh. Stop polling when none are pending. This removes the "is it approved yet?" friction without manual sync.

### D. Database migration (only if `campaigns.template_id` is missing)

```sql
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.templates(id) ON DELETE SET NULL;
```

### Files touched
- `src/services/campaignService.ts` (add CRUD helpers + `template_id` on Campaign type)
- `src/components/campaigns/CampaignsPanel.tsx` (dropdown menu, mutations, edit-mode handoff)
- `src/components/campaigns/CampaignWizard.tsx` (edit mode, Meta template picker, attachment-kind sync)
- `src/components/settings/CommunicationTemplatesHub.tsx` (pending-status auto-poll)
- New migration only if `campaigns.template_id` doesn't exist (verify on apply)

### Acceptance
- Each campaign card has a 3-dot menu with Edit, Duplicate, Cancel schedule, Delete (gated by status).
- Editing a draft/scheduled campaign re-opens the wizard pre-filled and saves in place.
- Wizard offers a "Use approved Meta template" toggle for WhatsApp; selecting one stores `template_id` and the resulting send goes through Meta's native template path (delivers to cold leads outside the 24h window).
- Pending Meta templates auto-refresh their status every 30s in the CRM Templates list.
