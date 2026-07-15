## Findings from audit

### Issue 1 — Only 9928910901 got the message; 9887601200 didn't
- My earlier "test" only dispatched to `+91 99289 10901`; I never actually invoked dispatch for `+91 98876 01200`. The last real attempt to that number was campaign `00a6aad2` at 06:41 UTC and failed with Meta `#132018` (empty name variable — pre-fix).
- The template `choose_what_deserves_your_effort` has `header_type=image` with a stored `header_media_url`, but the dispatcher only attaches an image when the caller passes `attachment.url`. My text-only test therefore reached Meta without the image — that's why the received message (had it landed) would have been text-only.

### Issue 2 — "Recipient delivery breakdown" drawer shows 0 / no recipients
Root cause chain for campaign `00a6aad2` (Choose What Deserves Your Effort, `status=sending`, `recipients_count=0`):
1. Wizard resolved `audience_kind='contacts'` client-side → returned an empty list (no `contacts` rows for this branch).
2. `sendCampaignNow` called `send-broadcast` with `recipients: []`.
3. `send-broadcast` Path A guard is `if (Array.isArray(recipients) && recipients.length > 0)` — an **empty** array skips Path A and silently falls through to the Members path, which:
   - broadcasts to **every member in the branch** (unintended),
   - never inserts into `campaign_recipients`,
   - leaves the campaign stuck at `status='sending'` if it times out.
4. Drawer reads from `campaign_recipients` → shows 0.

## Fixes

### 1. `supabase/functions/send-broadcast/index.ts` — stop the silent fallthrough
- If the caller passed `recipients` **or** `member_ids` (even as an empty array), treat that as an *explicit* audience. Do not fall through to the whole-branch members path.
- On empty explicit audience: set `campaigns.status='failed'`, `last_run_error='audience_empty'`, return `{sent:0, failed:0, reason:'audience_empty'}`.
- In the Members path, also insert per-recipient rows into `campaign_recipients` (source_type='member') when `campaign_id` is present so the drawer works for member campaigns too.

### 2. `supabase/functions/dispatch-communication/index.ts` — auto-attach template header media
When resolving a Meta template that has `header_type ∈ {image,document,video}`:
- If `input.attachment` is not supplied, look up `templates.header_media_url` (already selected in the template read) and synthesize `input.attachment = { url, kind: header_type, filename }` before building the HEADER component.
- Log `delivery_metadata.header_source = 'template_default'` when this auto-fill fires so we can trace which sends used which media.

Result: any marketing template with a saved header image will always carry that image, whether triggered by campaigns, wizard test, or manual dispatch.

### 3. Wizard guardrail — `src/components/campaigns/CampaignWizard.tsx`
- Before calling `sendCampaignNow`, if the resolved audience is 0, block send with a toast: "Audience is empty — pick contacts/members before sending." No stuck `sending` campaign.

### 4. Recipient Delivery drawer — `src/services/campaignService.ts` + drawer component
- `getCampaignReport()` currently reads only `campaign_recipients`. Add a fallback: when the table is empty for a `campaign_id`, hydrate rows from `communication_logs` where `dedupe_key LIKE 'campaign:<id>:%'` so historic + in-progress sends are visible with status/error.
- KPI tiles (Total / Delivered / Failed / Queued) count from the merged set.

### 5. One-time data repair (migration)
- Reset campaign `00a6aad2-c467-4810-85bc-8f78f062b468` from `sending` → `failed` with `last_run_error='audience_empty (pre-fix)'` so the UI stops spinning.
- Backfill `campaign_recipients` rows for that campaign from any matching `communication_logs` (best-effort join on branch + phone + time window) so its drawer shows what actually happened.

### 6. Verification test — send with image to both numbers
After deploy, invoke `dispatch-communication` for each number with template `choose_what_deserves_your_effort` and explicit `attachment` = template's stored image; confirm both wamids returned and check the WhatsApp inbox for the image + copy. Then open the drawer for the campaign and confirm rows/KPIs render.

## Technical notes
- `campaign_recipients` insert on the members path must use `source_type='member'`, `source_ref_id=member.id`, and set `dispatched_at` + `error` on failures so the failure-grouping in `getCampaignReport` still works.
- Auto-attach media logic sits inside the existing `hasMediaHeader` branch so header parameters are always aligned with template requirements (avoids Meta `#131051`).
- Fallback in `getCampaignReport` is read-only and defensive — it never writes back to `campaign_recipients` to avoid duplicating rows once the primary path is fixed.
- No schema changes required beyond the data-repair migration; all fixes are in edge functions + one client guard + one service function.
