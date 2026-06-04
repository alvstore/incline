## Goal
MSG91's RCS opt-in rules (and most carrier/operator policies) require an explicit, auditable user consent statement covering SMS / Email / RCS / WhatsApp **before** sending promotional or notification traffic. Today the project captures leads/registrations with **no consent field at all** (verified: no `consent`, `opt_in`, or `rcs` references anywhere in `src/` or `supabase/`). We will add a checkbox + persistent audit columns, and lay the integration groundwork for the Telinfy/GreenAds RCS API behind the existing universal dispatcher.

## Audit findings

Lead-capture surfaces that currently have **no consent capture**:
1. `src/pages/EmbedLeadForm.tsx` — public embeddable form (`/embed/lead`) → `capture-lead` edge fn
2. `supabase/functions/capture-lead/index.ts` — public REST entry used by website / ad landing pages
3. `src/components/leads/AddLeadDrawer.tsx` — internal staff "Add Lead" drawer
4. `src/pages/PublicRegistration.tsx` — `/register` self-onboarding (verified in memory)
5. `supabase/functions/register-member/index.ts` — backing edge fn
6. `src/components/ui/RegisterModal.tsx` — modal variant

Schema gap: `public.leads` has no consent columns. Same for `members`/`profiles` (consent should travel with the contact, since dispatcher gates outbound by member/lead).

Existing groundwork we'll reuse:
- `dispatchCommunication()` is the single comms funnel (per memory).
- `do_not_contact` flag exists and is already honored by dispatcher → consent withdrawal already works; we only need to add **positive opt-in capture**.
- `integration_settings(provider, integration_type)` pattern already used for WhatsApp/SMS providers → RCS plugs in cleanly.

## Plan

### Epic 1 — Consent schema (1 migration)
Add to `public.leads` and `public.profiles`:
- `comm_consent_granted boolean not null default false`
- `comm_consent_at timestamptz`
- `comm_consent_channels text[] not null default '{}'` (subset of `sms,email,rcs,whatsapp`)
- `comm_consent_source text` (e.g. `embed_form`, `public_register`, `staff_drawer`, `import`)
- `comm_consent_ip inet`, `comm_consent_user_agent text` (audit evidence MSG91/TRAI require)
- `comm_consent_text text` (verbatim copy of the checkbox label at time of consent — required for DLT/operator audits)

Create `public.consent_events` (append-only audit log: subject_type lead/member, subject_id, action grant/revoke, channels[], source, ip, ua, text, actor_id, created_at) + RLS (owner/admin/manager read; insert via RPC).

`record_consent(subject_type, subject_id, channels, source, text, ip, ua)` RPC — fills both the parent row and the audit log atomically. `SECURITY DEFINER`, `search_path=public`.

GRANT + RLS per project standards.

### Epic 2 — UI: add consent checkbox to all 4 lead-creation surfaces
Reusable component `src/components/consent/CommConsentCheckbox.tsx`:
- Single checkbox, label **"I authorise Incline Fitness to send me notifications via SMS, Email, RCS and WhatsApp as per the [Terms of Service](/terms) and [Privacy Policy](/privacy)."**
- Returns `{ granted, channels: ['sms','email','rcs','whatsapp'], text }` — channels stored as array so we can later split into granular toggles without another migration.
- Vuexy style: `rounded-md` checkbox + `text-sm text-slate-600`, links in `text-indigo-600 hover:underline`, focus ring per design system.
- Accessibility: associated `<label htmlFor>`, `aria-describedby` for the policy links, 44px touch target.

Inject into:
- `EmbedLeadForm.tsx` — **required** before submit (disable button until checked, since this is public/promotional traffic).
- `PublicRegistration.tsx` / `RegisterModal.tsx` — required.
- `AddLeadDrawer.tsx` — **optional** + visible default-off (staff is recording on behalf of a walk-in; staff confirms verbal consent). Show small "Walk-in verbal consent confirmed" helper text.

All four send the consent payload (channels, text, source) to their respective backend.

### Epic 3 — Backend wiring
- `capture-lead/index.ts`: accept `consent: { granted, channels, text }`, capture `req.headers` IP + UA, persist on insert, write `consent_events` row.
- `register-member/index.ts`: same.
- Internal `AddLeadDrawer` write path: call new `record_consent` RPC after lead insert (no edge fn needed).
- Update `dispatchCommunication`: add a soft gate — if channel is `rcs` or `sms` and target is a lead/member with `comm_consent_granted=false` AND category is promotional/marketing, return `suppressed: 'no_consent'`. Transactional categories (receipts, OTP) remain exempt, matching existing `force` semantics.

### Epic 4 — RCS provider scaffold (no live sends yet)
Looked up the Postman link target (Telinfy/GreenAds RCS API). Endpoints we'll wire later:
- Auth: bearer / API key in `integration_settings.config`
- Send text: `POST /rcs/send/text`
- Send rich card / carousel: `POST /rcs/send/card`
- DLR webhook ingest

This PR does **only** the scaffolding so no business logic depends on credentials being present:
- Add `'rcs'` to `CommChannel` union in `src/services/preferencesService.ts` + matching `member_communication_preferences.rcs_enabled` column.
- Add an `'rcs'` provider type to `integration_settings` provider catalog (`src/config/providerSchemas.ts`) with empty field defs `{ api_key, sender_id, base_url, webhook_secret }`.
- New edge fn stub `supabase/functions/send-rcs/index.ts` returning `not_configured` until creds are saved — fully isolated, called only by `dispatch-communication` when channel=rcs.
- Settings page entry will be auto-rendered from the provider catalog (existing pattern), so no new settings UI work.

**Not in scope this PR**: actually integrating the Telinfy/GreenAds API calls, template management, DLR webhook receiver. Those land in a follow-up once the API key + sender ID are provisioned (the user will need to add `RCS_TELINFY_API_KEY` via secrets).

### Files (estimated)
- New: 1 migration, `CommConsentCheckbox.tsx`, `supabase/functions/send-rcs/index.ts`
- Edited: 4 lead-form surfaces, `capture-lead`, `register-member`, `dispatch-communication`, `preferencesService.ts`, `providerSchemas.ts`, `types.ts` (auto)

### Acceptance
- All 4 lead forms render the consent checkbox; public forms block submit until checked.
- New leads/members carry `comm_consent_*` columns + an audit row in `consent_events`.
- Dispatcher suppresses promotional RCS/SMS to leads without consent.
- Provider catalog shows an "RCS (Telinfy)" entry ready to receive credentials — no live sends until creds + follow-up PR.
