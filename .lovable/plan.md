## 1. Retry Queue — Stop / Stop-All controls

**Root cause:** `RetryQueuePanel` has a per-row Cancel button rendered only as an unlabeled `Ban` icon (`size="icon" variant="ghost"`) with no `aria-label` or tooltip, and no bulk "Stop all"/"Retry all" affordance. Users read this as "no stop button." Also, `process-comm-retry-queue` does not treat Meta code **131000** ("Something went wrong") as terminal, so the same row runs the full 1→2→3 retry ladder and each failure fingerprints in error logs → 45 rows for one recipient/template pair.

**Fix (`src/components/communications/RetryQueuePanel.tsx`)**
- Replace icon-only cancel with `Button variant="outline" className="text-destructive"` labeled **"Stop"** with `Ban` icon (matches the Retry button's shape).
- Add a header actions row: **"Retry all"** (bulk `retryNow` over currently loaded rows) and **"Stop all"** (bulk update `status='cancelled'` for the filtered set) with a confirm `AlertDialog`.
- Add a filter chip row: `Pending | Retrying | Failed | Exhausted` (currently exhausted rows are hidden — add so users can also **Restart** an exhausted item by resetting `retry_count=0, status='pending', next_retry_at=now()`).
- Add per-row **"Restart"** shown only when `status='exhausted'`.

**Fix (`supabase/functions/process-comm-retry-queue/index.ts` v2.2.0)**
- Add `131000` to `TERMINAL_META_CODES` **after 1 retry** (not immediately): introduce a `SOFT_TERMINAL_META_CODES` set checked as `retry_count >= 1 && soft.has(code)` → mark exhausted with reason `meta_131000_transient_exhausted`. This kills the 3× loop without losing a genuine 1-retry recovery.

## 2. Two System Health clusters

**Cluster 1 (45×) — `send-whatsapp` Meta 131000 loop for `construction_walkthrough_reel_v1`.**
- Root cause: template send returns Meta's generic 500/131000; `process-comm-retry-queue` retries 3× per queued row, and every failed batch created a fresh queue row for the same recipient (retry-of-retry) because 131000 isn't terminal. Each attempt logs a fingerprinted `error` row.
- Fix: the retry-queue policy change in §1 (cap 131000 at 1 retry). Additionally in `supabase/functions/send-whatsapp/index.ts` downgrade the second-and-later 131000 log for the same `source_log_id` to `severity='warning'` (add `severity: newRetryCount>0 && Number(metaCode)===131000 ? 'warning' : 'error'`) — stops the SystemHealth spam.

**Cluster 2 (1×) — `DialogContent requires a DialogTitle` on `/leads` mobile.**
- Root cause: `src/components/layout/AppSidebar.tsx` renders `<SheetContent>` (mobile nav drawer) without a `SheetTitle`. Radix Dialog underneath fires the a11y warning the first time the sidebar opens on mobile. Route is `/leads` because that's where the user was.
- Fix: add `<SheetHeader><VisuallyHidden><SheetTitle>Navigation</SheetTitle></VisuallyHidden></SheetHeader>` at the top of the SheetContent.

**Shared cause?** No — independent. One fix per cluster.

## 3. RCS Hub — hide/relabel until a provider is enabled

**Current:** Card always renders "RCS Hub — Telinfy" with a "Disabled" badge, regardless of whether Telinfy or Smartping is the enabled provider. Confusing when the enabled row is Smartping (or none).

**Fix (`src/components/settings/rcs/RcsHub.tsx` + `IntegrationSettings.tsx`):**
- Rename hub title to just **"RCS Hub"** with a right-aligned provider chip: `Telinfy` / `Smartping` / `None`. Chip is driven by whichever `integration_settings` row has `is_active=true` (probe already exists in `cfg`).
- When both providers are disabled: collapse the hub to a single "Set up RCS" empty-state card (Overview/Templates/Test/Wallet/Reports/Webhooks tabs hidden). Keep the amber "Credentials saved, but integration is disabled" banner as-is when credentials exist but toggle is off.
- Move the hub card so it renders **inside the enabled provider's Settings → Integrations card** (accordion body below Telinfy/Smartping), not as a standalone global card. When neither is enabled, hub is not rendered at all.
- Webhooks tab: show only the enabled provider's URLs (currently shows both Telinfy + Smartping rows unconditionally).

## 4. Finish Smartping RCS integration + UUPM redesign

**Backend**
- `supabase/functions/rcs-templates-sync/index.ts`: branch on active provider from `integration_settings`; call `adapter.syncTemplates()` (Smartping list endpoint) and upsert into `rcs_templates` with `provider='smartping'` + `external_template_id`. Preserve Telinfy path.
- `supabase/functions/send-rcs/index.ts`: verify adapter passes `customOne=<log_id>` for Smartping so DLR correlation works (already in v0.5.0 per memory — re-test).
- `supabase/functions/rcs-webhook/index.ts`: confirm `/smartping/{delivery,user-action,user-message}` map to `communication_logs.status` transitions (`sent → delivered → read`, `failed`) via `customOne`.
- `supabase/functions/reconcile-rcs-pending/index.ts`: extend to poll Smartping `/rcs/api/report` for pending 24h+ rows.
- New optional edge fn `rcs-wallet` already exists — add a Smartping balance branch (`/rcs/api/wallet` or equivalent from the Postman collection) so the Wallet card shows a real number for the enabled provider.

**UI (redesigned with UUPM aesthetic — kept aligned to Vuexy tokens)**
- Overview tab becomes a data-dense KPI strip: 24h Sent · Delivered · Read · Failed · Wallet, with a Sparkline row below sourced from `communication_logs` grouped 24×1h.
- Templates tab: cards grid (`grid-cols-1 md:grid-cols-2`) with kind chip (Rich/Basic · Standard/Dynamic), provider chip, `Preview`/`Test Send`/`Copy ID` actions. Empty state links to provider docs.
- Test Send tab: single-column form (recipient, template select filtered by active provider, variables inputs auto-generated from template), live status timeline `queued → sent → delivered → read` streaming from `communication_logs` realtime.
- Reports tab: recent 50 sends table with per-row **View Timeline** drawer calling `rcs-record` for Telinfy or Smartping `/rcs/api/report/{id}`.
- Webhooks tab: copy-boxes for **only** the enabled provider + a "Test webhook" button that curls the webhook fn with a synthetic payload.
- Wallet tab: gradient hero card (existing) but adds "Top up" deep-link to provider portal + `last_synced_at` freshness pill.
- Provider Config: add "IP Whitelist required" callout for Smartping with our current Supabase egress info.

**Secrets required (to be added when moving to live testing):** `SMARTPING_RCS_USER_ID`, `SMARTPING_RCS_API_KEY` — will request via `add_secret` in the build step.

### Files touched
- `src/components/communications/RetryQueuePanel.tsx`
- `supabase/functions/process-comm-retry-queue/index.ts`
- `supabase/functions/send-whatsapp/index.ts`
- `src/components/layout/AppSidebar.tsx`
- `src/components/settings/rcs/RcsHub.tsx`
- `src/components/settings/IntegrationSettings.tsx`
- `supabase/functions/rcs-templates-sync/index.ts`
- `supabase/functions/rcs-webhook/index.ts` (verify)
- `supabase/functions/reconcile-rcs-pending/index.ts`
- `supabase/functions/rcs-wallet/index.ts`
