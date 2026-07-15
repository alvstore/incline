## Root causes

**1. Stats show 0 (SENT 0 / DELIVERED 0 / FAILED 0)**
The card in the screenshot reads `campaigns.recipients_count / success_count / failure_count`. Those fields are only written at the very END of `send-broadcast` (after the whole audience finishes). While the campaign is `sending` — or if the client aborted the invoke before completion — the counters stay at `0`. There is also no reconciliation of `delivered/read` back into the summary counters; the second screenshot (Telinfy panel: 78 delivered / 10 read / 19 sent-pending / 217 failed) shows the truth, but our card cannot match it because we only track the point-of-send success (`sent`), never DLR outcomes.

**2. Campaign send spins forever instead of saving + running in background**
`sendCampaignNow` in `campaignService.ts` does `supabase.functions.invoke('send-broadcast', …)` and `await`s the full response. `send-broadcast` loops the audience *synchronously* calling `dispatch-communication` per recipient (~200–800 ms each). For 324 contacts that is 60–300 s — well past Vite HMR proxy timeouts and past Supabase edge invoke client timeouts — so the browser button spins, the wizard never closes, and the row is left at `status='sending'` with `0/0/0`. Classic edge-function timeout / long-request anti-pattern.

**3. Card shows "SENDING" long after Telinfy has already returned results**
Same cause as #2 plus the missing reconciliation from #1. When `send-broadcast` eventually finishes it writes final counters, but if the client already navigated away, or if the invoke was killed, we never flip status off `sending`, and we never fold in the Telinfy DLR breakdown.

---

## Fix plan

### A. Background-execute campaign sends (kill the spinner)

`supabase/functions/send-broadcast/index.ts`
- Add early acknowledgement: as soon as the request is authenticated and validated, mark `campaigns` row `status='sending'`, `recipients_count=<audience length>`, `success_count=0`, `failure_count=0`, `last_run_error=null`, and return `202 { accepted: true, campaign_id, total }` immediately.
- Move the entire dispatch loop into a `runInBackground()` async fn wrapped with `EdgeRuntime.waitUntil(runInBackground())` so Deno keeps the isolate alive past the response.
- Inside the background loop, after every recipient, `UPDATE campaigns SET success_count=…, failure_count=…` (throttled: every N recipients or every ~2s) so the UI can watch progress live.
- On completion, set final status (`sent` / `failed` / `paused`) exactly as today. On uncaught exception, set `status='failed'` + `last_run_error`.

`src/services/campaignService.ts` — `sendCampaignNow`
- Do not `await` a synchronous result payload. Invoke `send-broadcast`, expect `202 accepted`, and return immediately with `{ accepted: true, total }`.

`src/components/campaigns/CampaignWizard.tsx`
- On Send Now: fire `sendCampaignNow`, toast `"Campaign queued — <n> recipients. We'll keep sending in the background."`, `invalidateQueries(['campaigns', branchId])`, close the wizard. Do NOT block on `result.sent/failed`.
- Remove the "Campaign failed / delivered X" toasts that assumed a synchronous result.

`src/components/campaigns/CampaignsPanel.tsx`
- Add a `useQuery` `refetchInterval: campaign.status === 'sending' ? 3000 : false` so cards live-update the `SENT / DELIVERED / FAILED` numbers as the background job progresses (same pattern already used in `CampaignReportDrawer.tsx`).
- Show a small progress bar `success_count + failure_count / recipients_count` on cards in `sending` state.

### B. Reconcile true delivery back into the card (fix 0/0/0)

Two levels of stats need to exist:
- **Send-time** (`campaigns.success_count` = accepted by provider, `failure_count` = rejected at send).
- **Delivery-time** (delivered / read / undelivered from provider DLRs, already living in `communication_logs.delivery_status` and `campaign_recipients.status`).

New edge function `supabase/functions/reconcile-campaign-stats/index.ts`
- Input: `{ campaign_id }` OR none → picks all campaigns updated in last 24h whose `status IN ('sending','sent')`.
- Aggregates `campaign_recipients` joined with `communication_logs` (via `provider_message_id` / `dedupe_key`) to compute `delivered / read / failed_after_send`.
- Writes new columns on `campaigns`: `delivered_count`, `read_count` (migration adds them, default 0).
- Flips `status`: still `sending` if any queued/pending, else `sent` (or `partial` when `failed_count > 0`).

Migration `supabase/migrations/<ts>_campaign_delivery_stats.sql`
- `ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS delivered_count int NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS read_count int NOT NULL DEFAULT 0;`
- Grants preserved (no new table).
- Cron: `select cron.schedule('reconcile-campaign-stats-every-2min', '*/2 * * * *', $$ select net.http_post(...reconcile-campaign-stats...) $$)`.

`CampaignsPanel.tsx` card
- Replace the three-column strip with four: `SENT` (`success_count`), `DELIVERED` (`delivered_count`), `READ` (`read_count`), `FAILED` (`failure_count`). Matches the Telinfy panel layout in the second screenshot.

### C. Guard against half-finished sends

`send-broadcast` background wrapper
- On isolate abort (`try/finally`), if we exit with unwritten counters, write `status='failed'`, `last_run_error='background_aborted'` — no more permanently-`sending` rows.

One-time backfill run (in the reconcile fn's first pass): any `campaigns.status='sending'` older than 30 min with `recipients_count=0` → set `status='failed', last_run_error='stuck_sending_backfill'` so the currently-stuck card in the screenshot clears.

---

## Files touched

- edit `supabase/functions/send-broadcast/index.ts` — 202 + `EdgeRuntime.waitUntil` + progress writes
- edit `src/services/campaignService.ts` — `sendCampaignNow` returns immediately
- edit `src/components/campaigns/CampaignWizard.tsx` — queued toast, no await on counts
- edit `src/components/campaigns/CampaignsPanel.tsx` — polling, progress bar, 4-stat strip
- new `supabase/functions/reconcile-campaign-stats/index.ts`
- new `supabase/migrations/<ts>_campaign_delivery_stats.sql` — 2 new columns + cron

## Out of scope (already handled elsewhere, will not re-touch)

- `reconcile-rcs-pending` already flips individual RCS logs to delivered/read/failed and fires SMS fallback — the new reconcile fn only *reads* those outcomes into the campaign summary.
- Telinfy per-handset undeliverable (Error 404 on iPhones) is a carrier issue documented in prior turns; nothing new here.
