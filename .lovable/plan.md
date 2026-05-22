# Lead Alert Hardening — Audit & Plan

## Root cause of the failure log
`supabase/functions/notify-lead-created/index.ts` (current v2.0.0) advertises in its
header comment that team WhatsApp alerts route through `dispatch-communication`
using the approved `lead_alert` template. **The implementation does not match the
comment.** It still calls a local `sendWhatsApp()` that posts a freeform
`type: "text"` message directly to Meta:

```ts
const r = await sendWhatsApp(whatsappIntegration, profile.phone, msg);
```

For any owner/admin/manager who has never replied to the business number in the
last 24h (the realistic case), Meta accepts the POST (HTTP 200, wamid issued)
but silently drops it — exactly the failure pattern in your screenshot.

There is already an **approved** Meta template that matches this use case:

| name | status | body |
|---|---|---|
| `internal_new_lead_alert` | APPROVED | `New Lead Alert:\nName: {{1}}\nPhone: {{2}}\nEmail: {{3}}\nSource: {{4}}\nPlease follow up at the earliest.` |

A matching row exists in `templates` (id `59e80c78-…`) with variables
`[lead_name, lead_phone, lead_email, source]`. `dispatch-communication` already
knows how to render approved templates when given a `template_id`.

## Fix — Epic 1: Route team WhatsApp through approved template
Rewrite `notify-lead-created` (v3.0.0) so **every** outbound message
(lead-facing + team-facing, all channels) goes through
`dispatch-communication`. Team WhatsApp passes
`template_id = <internal_new_lead_alert>` so Meta delivers it outside the 24h
window. Lead's own welcome WhatsApp stays freeform (lead IS in-window when they
submit the form). Removes ~200 lines of duplicate SMS/WA provider code.

## Fix — Epic 2: Add Email channel to Team Alerts
1. **Schema migration** on `lead_notification_rules`:
   - `email_to_lead boolean default false`
   - `email_to_admins boolean default false`
   - `email_to_managers boolean default false`
   - `lead_welcome_email_subject text`, `lead_welcome_email_body text`
   - `team_alert_email_subject text`, `team_alert_email_body text`
   (sensible defaults so existing rows stay valid)
2. **Schema migration** on `lead_notification_admin_prefs`:
   - `email_enabled boolean default true` (per-admin opt-out, mirrors
     `whatsapp_enabled` / `sms_enabled`)
3. **Edge function** sends an extra dispatch call per recipient when the email
   toggle is on and the recipient profile has an `email`.

## Fix — Epic 3: UI toggles in Team Alerts / Lead Alerts cards
`src/components/settings/LeadNotificationSettings.tsx`:
- Add an **Email to Lead** row in the Lead Alerts card.
- Add **Email to Admins** and **Email to Managers** rows in the Team Alerts card.
- Extend `LeadRulesForm` + `DEFAULTS` with the new booleans + email templates.
- Add an **Email** switch next to WhatsApp / SMS in `AdminRecipientsCard` for
  per-admin opt-out, wired to the new `email_enabled` column.
- Soften the existing amber "24h window" warning since the team WA path no
  longer depends on the 24h window (kept short note for legacy ops only).

## Verification
- After deploy, trigger a test lead capture → confirm Live Feed shows three
  rows (`whatsapp` + `email` + `sms`) for each enabled admin, with
  `template_name = internal_new_lead_alert` on the WhatsApp row and an actual
  Meta `delivered` webhook arriving (not just `sent`).
- Toggle each switch off → confirm no extra dispatch for that channel.

## Files touched (build-mode actions)
- `supabase/migrations/<new>.sql` — columns above
- `supabase/functions/notify-lead-created/index.ts` — full rewrite to v3.0.0
- `src/components/settings/LeadNotificationSettings.tsx` — UI rows + state
