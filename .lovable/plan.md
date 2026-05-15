## What's broken

Two independent bugs in the Marketing & Campaigns wizard for "WAIT IS OVER":

### Bug 1 — Audience size always shows 0 (Leads / Mixed)
The Postgres RPC `resolve_campaign_audience(branch_id, filter)` raises:
```
ERROR: operator does not exist: lead_status = text
WHERE l.branch_id = p_branch_id
  AND (cardinality(v_lead_status)=0 OR l.status = ANY(v_lead_status))
```
`leads.status` is enum `lead_status`; the filter array is built as `text[]`. Without a cast the RPC errors for **Leads, Mixed, and any audience that touches lead_status**. `AudienceBuilder` swallows the error in TanStack Query, so the live size badge stays at "0 recipients" even though there are 34 leads in the branch. Same RPC is called by `send-broadcast` resolver path → 0 recipients sent → campaign "delivers" to nobody.

**Fix:** migration to redefine `resolve_campaign_audience` with `l.status::text = ANY(v_lead_status)` (and the same cast for any other enum compared against the JSONB string arrays — `member_status`, `contact_segment_id`, etc., audited in the migration). Bump the function comment to `v2`.

Also surface RPC errors in `AudienceBuilder` so the live-size card shows a red "Audience query failed: …" instead of silently rendering 0.

### Bug 2 — WhatsApp video attachment never delivers
Audit of `CampaignWizard → send-broadcast → dispatch-communication → send-whatsapp → Meta`:

1. **`send-whatsapp` has no `video` branch.** Today MP4 is uploaded to Meta with `Content-Type: application/pdf` (the document fallback) and Meta rejects it.
2. **Dispatcher v1.6.0 force-collapses `kind=video` → `document`** in the freeform path.
3. **Marketing freeform to leads is blocked outside the 24h window** (Meta error 131047). The wizard never asks for an approved Meta template, so even a perfect MP4 fails for cold leads.
4. **Wizard accepts `.mov`/`.webm`** which Meta rejects, with no preview and no client-side mime check.

---

## Fix plan

### A. Database (single migration)
Redefine `public.resolve_campaign_audience(uuid, jsonb)` so all enum comparisons cast to text:
- `l.status::text = ANY(v_lead_status)`
- `m.status::text = ANY(v_member_status)` (verify the column type, apply same cast if enum)
- Re-grant `EXECUTE` to `authenticated`.

### B. Edge functions

1. **`send-whatsapp/index.ts` → v2.5.0**
   - Add `message_type === 'video'` branch with `metaPayload.video = { link | id, caption? }`.
   - Extend the Meta upload pre-step to accept `video`, `fallbackType: 'video/mp4'`.

2. **`dispatch-communication/index.ts` → v1.7.0**
   - Stop collapsing video to document in the freeform branch:
     `kind = rawKind === 'image' ? 'image' : rawKind === 'video' ? 'video' : 'document'`
   - For video: pass `media_mime_type: 'video/mp4'`, omit filename.
   - Native template-header path is already video-aware, leave untouched.

3. **`send-broadcast/index.ts`** — version bump only (`v3.4.0`).

Deploy: `send-whatsapp`, `dispatch-communication`, `send-broadcast`.

### C. Wizard UX (`src/components/campaigns/CampaignWizard.tsx` + `AudienceBuilder.tsx`)

- `AudienceBuilder`: render RPC error inline (red card) instead of falling back to 0.
- Step 3 (Message / Creative):
  - Inline notice when `channel === 'whatsapp'` + audience contains leads/contacts: "Cold WhatsApp marketing requires an approved Meta template — pick one below or change audience."
  - Optional Meta template picker (filtered to `header_type IN ('image','video','document','none')`); selected `template_id` is forwarded to `sendCampaignNow` (already plumbed).
  - File picker: enforce `file.type === 'video/mp4'` (reject `.mov`/`.webm` with toast), keep 16 MB cap, show "WhatsApp limit: 16 MB · MP4 / H.264 / AAC".
  - Show `<video controls>` thumbnail preview after upload.
  - Surface dispatcher error verbatim in the result toast.

### D. QA
1. Open wizard → pick Leads → live size shows 34, not 0.
2. Send "WAIT IS OVER" MP4 to a member who messaged us in last 24h → freeform video arrives.
3. Same campaign to cold leads with no template → wizard blocks send with clear reason.
4. Same campaign with approved video-header template → native template video arrives, no 24h restriction.
5. Upload 20 MB MP4 → blocked client-side. Upload `.mov` → blocked client-side.

---

## Files touched

- **Migration**: redefine `resolve_campaign_audience` with enum→text casts.
- `supabase/functions/send-whatsapp/index.ts` (add video branch + Meta upload)
- `supabase/functions/dispatch-communication/index.ts` (stop downgrading video)
- `supabase/functions/send-broadcast/index.ts` (version comment)
- `src/components/campaigns/AudienceBuilder.tsx` (surface RPC error)
- `src/components/campaigns/CampaignWizard.tsx` (template picker, mime/preview, error toast)
- `src/services/campaignService.ts` (verify `template_id` is forwarded; tiny patch if not)

No schema change beyond the function body.