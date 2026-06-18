
## Context — what already exists

After auditing the codebase, **most of what you asked for is already built**:

| Capability | Where | Status |
|---|---|---|
| Manage templates | `Settings → RCS Hub → Templates` (mirrors Telinfy via `rcs-templates-sync`) | ✅ |
| Direct send (test) | `RCS Hub → Test Send` drawer → `dispatch-communication` → `send-rcs` | ✅ |
| Wallet | `RCS Hub → Wallet` + `rcs-wallet` edge fn (`GET /rcs/wallet`) | ✅ |
| Webhooks | `rcs-webhook` edge fn handles `/delivery`, `/user-action`, `/user-message`; URLs shown in Webhooks tab | ✅ |
| Single dispatcher | `dispatch-communication` v1.17.0 routes `channel:'rcs'` → `send-rcs`, applies kill-switch (`channel_active_for_branch`), preferences, dedupe, quiet hours, logs to `communication_logs` | ✅ |
| On/off toggle respected | `integration_settings.is_active=false` → `send-rcs` short-circuits with `status:'disabled'`; dispatcher kill-switch also blocks | ✅ |

So the answer to questions 1–4 is largely **"already done"** — see "Answers" section at the bottom of this plan.

## What's actually missing — this plan covers it

### 1. Reports endpoint (`GET /rcs/record/:recordID`)
Postman collection exposes per-record drill-down (read/delivered/undelivered timeline) but we don't surface it.

- New edge fn **`rcs-record`** (mirrors `rcs-wallet` shape): accepts `{ branch_id, record_id }`, resolves Telinfy creds from `integration_settings`, calls `GET {base}/rcs/record/:recordID` with `x-api-key`, returns `{ ok, data }`.
- In `RcsHub → Test Send` results card, when `provider_record_id` is present add a **"Fetch detail"** button that invokes `rcs-record` and renders the raw event timeline (status / eventDLR list) in a collapsible block.
- New **Reports tab** in `RcsHub` (between Wallet and Webhooks): last 50 `communication_logs` rows where `channel='rcs'`, columns: time · recipient · template · status (badge) · recordID (click → fetch detail).

### 2. Rich-media template visibility (question 5)
Telinfy's REST RCS is **template-driven only** — `GET /rcs/templates` returns `{ richStandard, basicStandard, richDynamic, basicDynamic }`. Rich media (image cards, suggested replies, carousels) lives **inside the approved template on Telinfy's side**; the API does not accept freeform media payloads. We honor that today by returning `status:'unsupported'` when no `template_name` is supplied (dispatcher then falls back to SMS).

What we'll add:
- Extend `rcs_templates` with `kind text` (`rich_standard | basic_standard | rich_dynamic | basic_dynamic`) and `media_url text` (preview image, when Telinfy returns one). Migration + GRANTs.
- Update `rcs-templates-sync` to populate both fields from the grouped response.
- In `TemplatesPanel`, group cards into **"Rich" / "Basic"** sections, show a small media thumbnail when `media_url` is set, and add a **"Rich"** badge.
- In `Test Send` template picker, prefix rich templates with a 🎴 icon (lucide `Image`) so admins know which sends will render as a rich card.
- Add a one-line helper above the picker: *"Rich-media RCS messages are pre-approved on the Telinfy dashboard. To add a new card/carousel, create it in Telinfy → Templates, then click Sync."*

### 3. Documentation & curl panel in Webhooks tab
Add a second card under the existing webhook URL list with copy-able curl snippets pulled straight from the Postman collection:
- Get templates · Send message · Wallet · Record-by-ID
Each uses the **app's stored Telinfy key** label (`x-api-key: <stored>`), never prints the actual key.

### 4. Lock-in: dispatcher single source of truth
- Add a CI rule line to the existing comms guard so any new direct `supabase.functions.invoke('send-rcs', …)` (outside `dispatch-communication`) fails the build, matching the existing rule for `send-whatsapp` / `send-sms` / `send-email`.
- Update `mem://index.md` Core line for comms to explicitly call out `rcs` alongside Email/SMS/WhatsApp/in-app.

## Files touched

- `supabase/functions/rcs-record/index.ts` (new)
- `supabase/functions/rcs-templates-sync/index.ts` (kind + media_url)
- `supabase/migrations/<ts>_rcs_template_kind.sql` (new — ALTER + GRANT no-op since table exists)
- `src/components/settings/rcs/RcsHub.tsx` (Reports tab, rich/basic grouping, fetch-detail button, curl snippets)
- `.github/workflows/ci.yml` (extend direct-write guard with `send-rcs`)
- `mem://index.md` (Core line update)

## Out of scope
- Building our own RCS template designer (Telinfy is SSOT for template approval).
- Sending freeform RCS text — not supported by Telinfy REST.
- Inbound AI replies on RCS — already wired via `rcs-webhook/user-message` → `ai-agent-brain`; no change needed.

## Answers to your numbered questions

1. **Manage templates** → `Settings → RCS Hub → Templates` (Sync button mirrors Telinfy's `GET /rcs/templates`). New rich/basic grouping after this plan.
2. **Send direct message** → `RCS Hub → Test Send` drawer (always goes through `dispatch-communication`); same path is used programmatically: `dispatchCommunication({ channel:'rcs', recipient, template_key, payload:{ variables } })`.
3. **All RCS endpoints** → templates ✅, messages ✅, wallet ✅, webhooks ✅, **reports record-by-ID added by this plan**.
4. **Single source of truth + on/off** → already enforced by `dispatch-communication` v1.17.0 + `send-rcs` is_active check; this plan adds the CI guard to prevent regressions.
5. **Rich media** → rich messages = pre-approved rich templates on Telinfy; UI will now badge them and show preview thumbnails. Anything not in an approved rich template falls back to SMS via dispatcher.
