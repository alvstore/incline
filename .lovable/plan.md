## Telinfy RCS — Aligned with official Postman collection

### What changed vs. previous plan
Now grounded in the actual `hub.telinfy.com - APIs & Webhook` collection. Base URL, auth header, and endpoints are confirmed (no more guesses).

### Confirmed contract (from Postman)
- **Base URL:** `https://hub.telinfy.com/unified/developer/api/v1`
- **Auth:** `x-api-key: <API_KEY>` header (NOT Bearer)
- **Endpoints (RCS only):**
  - `GET /rcs/templates` — list approved templates
  - `POST /rcs/messages/:contactID?messageId=<custom>` — send (body = `{ templateName, lcustomParam }`)
  - `GET /rcs/wallet` — balance
  - `GET /rcs/record/:recordID` — single delivery record
- **Webhooks (Telinfy → us):**
  - `POST /webhook/delivery` — DLR; `eventDLR` ∈ `MESSAGE_READ | MESSAGE_DELIVERED | MESSAGE_UNDELIVERED`; identifier = `recordID`
  - `POST /webhook/user-action` — button click; `user_action_clicked`
  - `POST /webhook/user-message` — inbound MO (e.g. "STOP"); `user_Messaged`

### Current code mismatches (must fix)
1. `send-rcs/index.ts` uses `Authorization: Bearer` → must use `x-api-key`.
2. Endpoints `/rcs/send/text` and `/rcs/send/card` don't exist → real endpoint is `POST /rcs/messages/{contactID}` and is **template-driven** (`templateName` + variables). There is no freeform text send via this API.
3. `rcs-webhook/index.ts` keys on `message_id` → real payload uses `recordID` + `eventDLR`. Status mapping must read `eventDLR`.
4. `providerSchemas.ts` field labelled "Bearer Token" → relabel "API Key (x-api-key)".
5. No handler for `/webhook/user-action` or `/webhook/user-message`.

### Build plan

**A. Secrets (request once user confirms)**
- `TELINFY_API_KEY`, `TELINFY_BASE_URL` (default `https://hub.telinfy.com/unified/developer/api/v1`). `TELINFY_SENDER_ID` is implicit per account — drop from required.

**B. Migration — `rcs_templates` + `rcs_wallet_snapshots`**
- `rcs_templates(id, branch_id, template_name UNIQUE per branch, body_preview, variables jsonb, status, last_synced_at)` — mirror of Telinfy `GET /rcs/templates`.
- `rcs_wallet_snapshots(id, branch_id, balance numeric, currency, fetched_at)`.
- GRANTs + RLS branch-scoped + service_role full.
- Add `communication_logs.provider_record_id text` index (RCS keys on `recordID`, distinct from `provider_message_id`).

**C. Edge functions**
- `send-rcs` → **v0.3.0**
  - Switch to `x-api-key`.
  - Single endpoint `POST {base}/rcs/messages/{contactID}?messageId={log_id}`.
  - Body: `{ templateName, lcustomParam }`. Caller must pass `template_name` + `variables`. If only freeform `message` is provided, return `status:'unsupported', reason:'rcs_requires_template'` and let dispatcher fall back to SMS.
  - Store returned `recordID` into `communication_logs.provider_record_id`.
- `rcs-templates-sync` (new) → calls `GET /rcs/templates`, upserts `rcs_templates`.
- `rcs-wallet` (new) → `GET /rcs/wallet`, writes snapshot; returns balance.
- `rcs-webhook` → **v0.3.0**, refactor:
  - Routes by URL path suffix: `/delivery`, `/user-action`, `/user-message`.
  - `/delivery`: map `eventDLR` → `delivered | read | failed`, lookup `communication_logs` by `provider_record_id`, call `record_delivery_event`.
  - `/user-action`: insert into a new `rcs_inbound_events` table + emit lead-activity.
  - `/user-message`: detect opt-out via existing `_shared/optOutDetector.ts` → `mark_do_not_contact`; otherwise hand to `ai-agent-brain` with `channel='rcs'`.
- `dispatch-communication` → add RCS branch: if `channel='rcs'` and a `template_key` exists, resolve template_name; otherwise skip RCS and fall through to SMS fallback.

**D. UI — Settings → Integrations → RCS Hub** (`src/components/settings/rcs/`)
Vuexy: rounded-2xl, soft shadow, Sheet drawers for create/edit. Tabs:
1. **Overview** — connection status, wallet balance hero card (gradient), today's sent/delivered/read/undelivered counters (from `communication_logs` where `provider='telinfy_rcs'`).
2. **Templates** — list with status badges, "Sync from Telinfy" button → `rcs-templates-sync`. Read-only for now (creation happens in Telinfy hub).
3. **Direct Send (Test Console)** — Sheet: PhoneInput (+91), Template select (from `rcs_templates`), dynamic variable fields, Send. Polls `communication_logs` for the new log id to show timeline (sent → delivered → read).
4. **Wallet & Reports** — balance card + 30-day delivery breakdown bar chart.
5. **Webhooks** — three URLs with copy buttons:
   - DLR: `{SUPABASE_FN_BASE}/rcs-webhook/delivery`
   - User Action: `{SUPABASE_FN_BASE}/rcs-webhook/user-action`
   - User Message: `{SUPABASE_FN_BASE}/rcs-webhook/user-message`

**E. RBAC**
- View hub: owner/admin/manager.
- Send test + sync templates: owner/admin (`rcs_admin` capability).
- Wallet view: owner/admin (financial).

**F. Live test (+91 98876 01200)**
1. After secrets in + templates synced, open Test Console.
2. Pick template (e.g. `welcome`), fill `NAME=Audit Test`, send.
3. Verify in `communication_logs`: status flow `queued → sent → delivered → read`, `provider_record_id` populated.
4. Verify `rcs-webhook/delivery` row in `webhook_ingress_log`.

### Files to create / edit
- create: `supabase/functions/rcs-templates-sync/index.ts`, `supabase/functions/rcs-wallet/index.ts`
- create: `supabase/migrations/<ts>_rcs_telinfy_v2.sql` (templates, wallet snapshots, `provider_record_id`, `rcs_inbound_events`)
- edit: `supabase/functions/send-rcs/index.ts` (x-api-key, template-only, recordID)
- edit: `supabase/functions/rcs-webhook/index.ts` (3 path routes, eventDLR mapping, opt-out, MO → brain)
- edit: `supabase/functions/dispatch-communication/index.ts` (RCS template branch + SMS fallback)
- edit: `src/config/providerSchemas.ts` (x-api-key label, base_url default)
- create: `src/components/settings/rcs/RcsHub.tsx`, `OverviewTab.tsx`, `TemplatesTab.tsx`, `TestConsoleSheet.tsx`, `WalletReportsTab.tsx`, `WebhooksTab.tsx`
- edit: `src/components/settings/IntegrationSettings.tsx` (link "Open RCS Hub")
- edit: `src/lib/auth/permissions.ts` (`rcs_admin`, `rcs_wallet_view`)
- migration: `role_capabilities` rows for new caps

### Out of scope (this round)
- MSG91 RCS dispatcher.
- Inbound RCS thread UI in unified conversation hub (insert + AI reply now; UI listing later).
- Template creation/submission (Telinfy hub still required for approvals).

### Confirm before build
1. **Add `TELINFY_API_KEY` + `TELINFY_BASE_URL` via secrets prompt now?** (recommended yes)
2. **Live send to +91 98876 01200** during this build — OK to consume one wallet credit?
3. Confirm dispatcher behavior when no RCS template exists: **fall back to SMS** (recommended) vs. fail loudly?
