## Audit findings — `choose_what_deserves_your_effort`

I queried Meta's approved template payload for this template and confirmed it has **only a `BODY` component, no `HEADER`**. So Meta was never asked to approve an image header — that's why every send is text-only, regardless of what the dispatcher tries to attach.

### Why the header was dropped at submission

`manage-whatsapp-templates/index.ts` (v2.4.0, action `create`, lines 531–580) auto-uploads the sample image to Meta's resumable-upload endpoint to obtain the required `h:...` handle. If it can't, it **silently strips the HEADER** and submits body-only:

```
} else if (hasMediaHeader) {
  console.warn(`... — submitting as text-only template ...`);
}
components.push(bodyComponent);   // header never added
```

The upload is skipped whenever:
1. `credentials.app_id` is missing on the WhatsApp integration **and** `META_APP_ID` env is unset, **or**
2. The resumable upload itself errors (bad URL, wrong content-type, <256 bytes).

I checked `integration_settings` — the active `meta_cloud` row has `has_app_id = false`. So condition (1) was true: every media-header submission from this workspace has been quietly downgraded to text-only. The UI never told the user; the DB row was stored with `status='APPROVED'` and no header component; the dispatcher can now do nothing (v1.x correctly refuses to attach media that Meta hasn't approved).

### Why the message arrived as "Hi —,"

Meta template body is `Hi {{1}},\nThank you...`. Dispatcher substituted `{{1}}` with an em-dash / blank because the recipient (raw phone) had no matching member and `member_name` resolved to empty. There's no "safe fallback" (e.g. `there`) when personalization is missing.

---

## Plan

### 1. Stop silent header drops in `manage-whatsapp-templates/index.ts`

Replace the silent `console.warn` fallback with a **hard 400** whenever `header_type ∈ {image, video, document}` but no valid Meta handle could be resolved. Message must tell the user exactly which precondition failed:

- `app_id` missing on the WhatsApp integration → "Add the Meta App ID to Settings → Integrations → WhatsApp so image/video/document headers can be uploaded to Meta."
- Upload succeeded on Meta side but returned no handle → surface Meta's error.
- Sample URL unreachable / too small → surface fetch status.

Also return `header_upload_diagnostics` in the JSON response so the wizard can render an inline banner instead of the current success toast.

### 2. Wizard UX — never let users think an image-template was approved when it wasn't

In `TemplateWizard` (or the equivalent submit dialog under `Settings → Communication Templates → WhatsApp → CRM Templates`):

- Read `header_upload_diagnostics` from the response.
- If present, show a red inline error and keep the local `templates` row as `DRAFT` (do not persist status=`PENDING/APPROVED`).
- Add a pre-flight check: if `header_type='image|video|document'` and the wizard cannot detect `credentials.app_id` on the active WhatsApp integration, block "Submit for Approval" with a link to Settings → Integrations.

### 3. Expose `app_id` on the WhatsApp integration

In `Settings → Integrations → WhatsApp` (Meta Cloud form), add an **App ID** field (text, required for media-header templates, optional otherwise) and persist to `integration_settings.credentials.app_id`. Existing rows keep working for body-only templates.

### 4. Backfill the broken approved template

`choose_what_deserves_your_effort` is already `APPROVED` at Meta as body-only. Meta doesn't let you add a HEADER to an approved template via edit. Path forward:

- Add a "Re-submit with image header" action on the row that:
  - clones the template under a new safe name (e.g. `choose_what_deserves_your_effort_v2`),
  - includes the HEADER component using the newly-uploaded handle,
  - marks the old row `is_stale = true` so the wizard hides it.

### 5. Safe personalization fallback in `dispatch-communication`

When resolving `{{1}}` / `{{member_name}}`:

- If the resolved value is empty, whitespace, `—`, `-`, `null`, or `undefined`, substitute the string `there` (configurable per-branch later).
- Log `delivery_metadata.name_fallback = true` so we can audit how often this fires.
- This alone would have turned "Hi —," into "Hi there,".

### 6. Verification

- Re-open the wizard, confirm the App ID field appears and is required for image templates.
- Attempt to submit an image-header template **without** `app_id` → confirm hard error, no DB row promoted.
- Add `app_id`, re-submit → confirm HEADER component reaches Meta (log the payload), template goes to `PENDING`.
- Send once approved to `+91 99289 10901` and `+91 98876 01200`; confirm image renders and body reads "Hi Yogita," / "Hi there,".

### Files to change

- `supabase/functions/manage-whatsapp-templates/index.ts` — hard-fail on missing handle; add diagnostics; expose `app_id` from credentials.
- `supabase/functions/dispatch-communication/index.ts` — safe name fallback + `name_fallback` metadata.
- `src/components/templates/TemplateWizard.tsx` (or equivalent) — pre-flight check, error banner on diagnostics, keep DRAFT on failure.
- `src/pages/Settings.tsx` → Integrations → WhatsApp form — add `app_id` field.
- New action in `WhatsAppTemplatesList` — "Re-submit with header as v2".

No DB migration required; `integration_settings.credentials` is JSONB and the DB already stores `header_type` semantics via `whatsapp_templates.components`.
