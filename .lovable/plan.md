## What's actually broken (audit)

Confirmed against the database and code:

1. **`wait_is_over_july` is APPROVED at Meta but missing from the wizard's "Send via approved Meta template" picker.**
   - `whatsapp_templates` (Meta cache) row exists: status=APPROVED, category=MARKETING.
   - `templates` (CRM) row does **not** exist.
   - The picker in `CampaignWizard.tsx` (line 87) queries `templates` only. The Meta sync in `manage-whatsapp-templates` only **updates** existing `templates` rows by `meta_template_name`; it never inserts stubs. So any template approved at Meta but without a matching CRM row is invisible to the wizard.

2. **Wrong category (Marketing template shown / submitted as UTILITY).**
   - The AI generator returns a `category`, but the review UI in `AIGenerateTemplatesDrawer.tsx` shows it as a read-only badge — there is no override, no validation against event semantics, and no "force MARKETING for promo events" guard. The drawer submits whatever the model returned.

3. **Header `video` missing on submit.**
   - `AIGenerateTemplatesDrawer` has no header type/media controls in the review step. If the model returned `header_type='none'` you can't change it; if it returned `video` you can't attach a real sample. Meta requires a real uploaded handle for VIDEO/IMAGE/DOCUMENT headers.

4. **"Create Marketing Campaign → Send to Meta" silently fails / mis-categorizes.**
   - `handleSubmitMetaTemplate` derives category from `campaignType`, but doesn't pass `local_template_id`, doesn't show the actual Meta error_user_msg, and doesn't refresh the picker after submit. Video header sample upload path exists in the edge fn but the wizard never lets the user attach a real video before submit.

5. **Picker requires approval but offers no path to refresh / no auto-fetch.**
   - No realtime/poll on `whatsapp_templates`, no "Sync now" inside the wizard, no helpful empty-state pointing the user at the Meta panel.

## Fix plan

### A. Make Meta-approved templates always visible (1 SQL migration + 1 edge fn change)

**Migration** — backfill + future-proof:
```sql
-- Insert stub templates rows for every approved Meta template that doesn't have one.
INSERT INTO public.templates (branch_id, type, name, content, meta_template_name, meta_template_status, header_type, is_active)
SELECT
  wt.branch_id,
  'whatsapp',
  wt.name,
  COALESCE(
    (SELECT (c->>'text') FROM jsonb_array_elements(wt.components) c WHERE c->>'type' = 'BODY' LIMIT 1),
    ''
  ),
  wt.name,
  wt.status,
  LOWER(COALESCE(
    (SELECT (c->>'format') FROM jsonb_array_elements(wt.components) c WHERE c->>'type' = 'HEADER' LIMIT 1),
    'none'
  )),
  true
FROM public.whatsapp_templates wt
WHERE NOT EXISTS (
  SELECT 1 FROM public.templates t
  WHERE t.meta_template_name = wt.name
    AND (t.branch_id = wt.branch_id OR t.branch_id IS NULL)
);
```

**`manage-whatsapp-templates` (list action)** — change the post-sync templates update from UPDATE-only to UPSERT-by-`meta_template_name` so future Meta-side templates auto-appear.

### B. AI Generate drawer — category + header controls (review step)

In `AIGenerateTemplatesDrawer.tsx` review step, add per-proposal:
- **Category select** (`UTILITY` / `MARKETING` / `AUTHENTICATION`) — editable badge, defaulted from AI but overridable. Add a soft warning when the event name suggests marketing (offer/promo/event/birthday/referral/win_back) but category is UTILITY.
- **Header type select** (`none` / `image` / `video` / `document`) with a media URL field that appears when type ≠ none. For `video`, allow paste of an MP4 URL or upload to `campaign-attachments` bucket; pass that URL as `header_sample_url` so `manage-whatsapp-templates` can convert it to a Meta media handle.

Also tighten the AI system prompt to **map event → category deterministically** (e.g. `wait_is_over_*`, `*_offer`, `*_promo`, `*_event`, `*_announcement` → MARKETING) before the model returns.

### C. Campaign Wizard — read from `whatsapp_templates`, not `templates`

In `CampaignWizard.tsx`:
- Replace the `approvedTemplates` query to read from `whatsapp_templates` where `status='APPROVED'` (filter by branch + global), and join the CRM `templates.id` by `meta_template_name` so we still pass a valid `template_id` downstream.
- When the picker is opened, surface category/language/header-format chips so the user picks the right one.
- Add a small **"Sync from Meta"** button next to the picker (calls the same `manage-whatsapp-templates` list action) and a realtime subscription on `whatsapp_templates` so newly approved templates appear without a refresh.
- On the "Submit to Meta" path inside the wizard, pass `local_template_id` (create the CRM row first, like AI drawer does), surface `meta_error.user_msg` in the toast, and invalidate the picker query on success.

### D. Helpful empty state

If the picker has zero APPROVED templates, show: "No approved Meta templates yet. Generate one in **Settings → Communication Templates → AI Studio**, or open **Meta Approved** to sync."

## Files touched

- `supabase/migrations/<new>.sql` — backfill stubs.
- `supabase/functions/manage-whatsapp-templates/index.ts` — UPDATE → UPSERT in the list action.
- `supabase/functions/ai-generate-whatsapp-templates/index.ts` — sharpen category mapping in system prompt.
- `src/components/settings/AIGenerateTemplatesDrawer.tsx` — category + header_type + media URL controls in review step.
- `src/components/campaigns/CampaignWizard.tsx` — picker reads `whatsapp_templates`, sync button, realtime, better submit error UX.

## Out of scope

- No changes to `dispatch-communication`, `send-whatsapp`, or `send-broadcast` — they already accept `template_id` and resolve Meta name correctly once the CRM row exists.
- No new tables or RLS changes.
