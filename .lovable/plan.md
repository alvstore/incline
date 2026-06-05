
## Audit findings

Current state of the RCS integration:

| Layer | Status |
|---|---|
| `send-rcs` edge fn (Telinfy POST) | ✅ Live (v0.2.0) |
| `rcs-webhook` (DLR receiver) | ✅ Live |
| `providerSchemas.ts` → `rcs_telinfy` / `rcs_msg91` | ✅ Schema defined |
| `CommChannel` type includes `'rcs'` | ✅ |
| **`dispatch-communication` routing** | ❌ `validChannels` excludes `rcs` → every dispatch returns `invalid_channel` |
| **Settings → Integrations UI tab for RCS** | ❌ Missing — no way to enter API key, sender ID, base URL, toggle on/off |
| **Channel kill-switch (`channel_active_for_branch`) for RCS** | ❌ Not wired |
| Stats card on Integrations overview | ❌ No RCS counter |

Net effect: RCS is fully built on the backend but unreachable — admins cannot configure it and the dispatcher refuses the channel.

## Plan

### 1. New "RCS" tab in `IntegrationSettings.tsx`
Mirrors the SMS tab pattern (same `openConfig` / `ProviderConfigDrawer` flow):
- Add `'rcs'` to `IntegrationType` union
- New tab trigger (`<MessageSquare>` icon, label "RCS") between SMS and WhatsApp
- Provider grid with two cards: **Telinfy / GreenAds** (primary) and **MSG91 RCS** (optional, schema already exists)
- Each card shows: status badge (Active/Inactive), Configure button, Enable/Disable switch (same `is_active` toggle used by SMS/WhatsApp)
- Top of tab: info panel with the DLR webhook URL `${SUPABASE_FUNCTION_BASE}/rcs-webhook` + copy button + one-line "Paste this in Telinfy → Delivery Receipt Webhook"
- Overview stats row: add "RCS Providers" tile showing active count
- "Opt-in compliance" callout (per MSG91 RCS rules already saved in prior work): reminder that lead form must collect explicit consent before RCS sends — link to `/leads/new`

The drawer (`ProviderConfigDrawer`) already renders fields from `providerSchemas.ts` so no new form code needed; it'll show Sender ID, Base URL, API Key automatically from the existing `rcs_telinfy` schema.

### 2. Dispatcher routing (`supabase/functions/dispatch-communication/index.ts`)
- Extend `Channel` type and `validChannels` to include `'rcs'`
- Add `case 'rcs':` in the channel-routing switch that invokes `send-rcs` with `{ branch_id, recipient, message: payload.body, log_id, kind: payload.variables?.rcs_kind ?? 'text' }`
- Pre-route check: skip phone normalisation block already gated to `whatsapp|sms` (RCS uses same E.164, but reuse the same digit normaliser without rejecting)
- Honor channel kill-switch: `channel_active_for_branch` RPC currently only knows whatsapp/sms/email — extend it (migration) to treat `'rcs'` the same way (look up `integration_settings` row where `integration_type='rcs' AND is_active`)

### 3. `channel_active_for_branch` migration
Single SQL migration that updates the function body so passing `p_channel='rcs'` resolves to `EXISTS (SELECT 1 FROM integration_settings WHERE integration_type='rcs' AND is_active AND (branch_id = p_branch_id OR branch_id IS NULL))`.

### 4. Minor UI polish (Vuexy)
- Card uses `rounded-2xl shadow-lg shadow-slate-200/50`
- Status badge: emerald when active, slate when inactive
- "Beta" pill on RCS tab (channel still rolling out across Indian carriers)

## Files

**Edit**
- `src/components/settings/IntegrationSettings.tsx` — add tab, stats, providers list
- `supabase/functions/dispatch-communication/index.ts` — channel routing + validChannels

**Create**
- `supabase/migrations/<ts>_channel_active_for_branch_rcs.sql` — extend RPC

## Out of scope
- RCS template management UI (rich cards, suggested replies) — schema-only for now; `kind:'card'` already supported by `send-rcs` and reachable via `payload.variables.rcs_kind='card'` from campaigns
- MSG91 RCS dispatcher (only Telinfy is wired in `send-rcs`); MSG91 card will save creds but show "Dispatcher pending" until added
