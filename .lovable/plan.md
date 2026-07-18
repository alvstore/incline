
# Add Smartping RCS — unified `send-rcs` (no per-provider edge fns)

Keep a **single** `send-rcs` edge function that internally routes to Telinfy or Smartping based on `integration_settings.provider`. Same for templates sync, DLR webhook, and record lookup. No new per-provider functions — just internal adapters inside one file each.

## What I need from you first

1. **Credentials** — I'll open a secure form for:
   - `SMARTPING_RCS_USER_ID`
   - `SMARTPING_RCS_API_KEY`
2. **IP whitelisting** on Smartping's firewall for Supabase Edge egress (raise ticket with them). Sends will 401 until this is done — surfaced in UI.
3. **Bot / Agent ID** provisioned for Incline.
4. **Webhook URL** to register in Smartping panel (given after deploy): `.../functions/v1/rcs-webhook/smartping/delivery` (and `/user-action`, `/user-message`).

## Unified edge functions (edit, don't create)

1. **`supabase/functions/_shared/rcsProviders.ts`** (new, shared adapter module only — not an edge fn)
   - `resolveRcsProvider(supabase, branch_id)` → `{provider, base_url, credentials, is_active}` from `integration_settings` (prefers `is_active=true`; if multiple, prefers `is_default`).
   - `telinfyAdapter` — current Telinfy calls (send / templates / record / DLR mapping).
   - `smartpingAdapter` — token cache (`settings` key `smartping_rcs_token`, 23h TTL, auto-refresh on 401), send builders for `standard | richCard | carouselCard` on `/rcs/api/message/send`, template fetch, DLR event mapping. Correlates via `customOne = log_id`.
   - One typed contract: `send(payload) → {status, provider_message_id, provider_record_id, raw}`, `syncTemplates()`, `mapDlr(event)`.

2. **`send-rcs/index.ts`** (edit, v0.5) — no logic change to callers. Resolve provider → call adapter → write to `communication_logs`. Freeform still falls back with `status:'unsupported'` when the resolved provider requires a template.

3. **`rcs-templates-sync/index.ts`** (edit, v1.3) — call `adapter.syncTemplates()`. Add columns to `rcs_templates`: `provider text default 'telinfy'`, `external_template_id text`, unique `(branch_id, provider, template_name)`.

4. **`rcs-webhook/index.ts`** (edit, v0.4) — path suffix already routes `/delivery|/user-action|/user-message`. Add one more suffix segment for provider: `/rcs-webhook/telinfy/...` and `/rcs-webhook/smartping/...`. Adapter's `mapDlr()` decides status. Correlation:
   - Telinfy → `communication_logs.provider_record_id`
   - Smartping → `communication_logs.id` via `customOne` (or `provider_message_id`)

5. **`rcs-record/index.ts`** (edit) — dispatch to `adapter.fetchRecord(recordId)`.

## Database (one migration)
```
ALTER TABLE rcs_templates
  ADD COLUMN provider text NOT NULL DEFAULT 'telinfy',
  ADD COLUMN external_template_id text;
ALTER TABLE rcs_templates DROP CONSTRAINT rcs_templates_branch_id_template_name_key;
ALTER TABLE rcs_templates ADD CONSTRAINT rcs_templates_branch_provider_name_key
  UNIQUE (branch_id, provider, template_name);
```
No new tables, no RLS/GRANT changes.

## Frontend (Vuexy Sheets, no dialogs)
- **`Settings → RCS Hub → Providers` tab** (new component `RcsProvidersTab.tsx`) — lists Telinfy + Smartping cards, each opens a right-side Sheet (`RcsProviderSheet.tsx` reused for both) with fields driven by provider schema. "Set as default sender" radio (writes `integration_settings.is_default`).
- **Templates tab** — add Provider column + filter; "Sync templates" reads active provider(s).
- **CampaignWizard RCS step** — show provider chip on each template card. No flow changes.

## Live test to +91 98876 01200
After secrets + whitelist:
1. `curl` `send-rcs` with `provider=smartping` templateId.
2. Check `communication_logs` → sent + `provider_message_id`.
3. Wait for Smartping DLR → confirm status flips via `rcs-webhook/smartping/delivery`.
4. Paste function logs + drawer screenshot.

## Memory (after apply)
- `mem://integrations/rcs-multi-provider` — unified `send-rcs` with adapter pattern; provider resolution via `integration_settings`; webhook path `/rcs-webhook/{provider}/{event}`; Smartping token TTL 24h; correlation via `customOne`.
- Core index update: RCS is multi-provider via one edge fn.

## Skills applied
`senior-architect` (adapter pattern inside single edge fn), `senior-backend` (token cache, webhook routing), `ui-ux-pro-max` (Vuexy providers tab / sheet), `code-reviewer` (input validation on public webhook, no secret leaks), `supabase-postgres-best-practices` (schema change with unique constraint, no policy impact).

## Explicitly not doing
- No new `send-rcs-smartping`, `rcs-smartping-webhook`, or `rcs-smartping-templates-sync` edge fns.
- No dispatcher (`dispatch-communication`) changes — it still just invokes `send-rcs`.
- No campaign chunker changes.

Approve and I'll (1) request the two secrets, (2) ship the shared adapter + 4 edited edge fns + 1 migration + UI, (3) run the live test and paste DLR evidence.
