
## Goal

1. **Live Feed** in Communication Hub must show only *transactional / 1-to-1* messages. All campaign / broadcast traffic disappears from it.
2. **Campaign Detail drawer** becomes the single source of truth for that campaign: real KPIs, per-recipient status with error reason, and buttons to **Retry failed** and **Re-trigger campaign**.

Root cause of the empty drawer (screenshot 1): the drawer currently reads `campaign_runs`, but `send-broadcast` writes to `campaign_recipients` + `communication_logs` (dedupe_key `campaign:<id>:<source>:<ref>`). That table is empty ⇒ everything shows 0.

---

## Changes

### 1. Filter campaigns out of Live Feed
`src/components/communications/LiveFeed.tsx`
- Both queries (`page1` and `loadOlder`) add `.not('dedupe_key','ilike','campaign:%').not('dedupe_key','ilike','broadcast:%')`.
- Realtime subscription: on INSERT, skip rows whose `dedupe_key` starts with `campaign:` / `broadcast:` before invalidating (avoids noisy refetches).
- KpiStrip counts recompute from the filtered result — no code change needed since they derive from `logs`.
- Add a subtle helper line under the "Live Feed" title: *"Campaign sends are tracked in Campaigns → View details."*

### 2. Rebuild Campaign Detail drawer as SSOT
`src/components/campaigns/CampaignDetailDrawer.tsx` — full rewrite of the data layer:

- **Data source switch**: read `campaign_recipients` (source_type, source_ref_id, recipient_phone/email, status, error, created_at) instead of `campaign_runs`.
- **DLR join**: fetch `communication_logs` where `dedupe_key like 'campaign:<id>:%'`, index by dedupe_key, merge into each recipient row to get true `delivery_status` (sent/delivered/read/failed), provider `error_code`/`error_message`, `delivered_at`, `read_at`.
- **Header KPI strip (5 tiles)**: Total · Sent · Delivered · Read · Failed. Numbers come from the merged view, not the stale `campaigns.*_count` columns; also show a small "auto-reconciles every 2 min" tag linking to the existing `reconcile-campaign-stats` fn.
- **Progress bar** while `campaign.status === 'sending'` (same math as the card).
- **Recipient table** (virtualised list, filterable):
  - Filter chips: All / Delivered / Failed / Pending.
  - Search by name/phone/email.
  - Row shows: name (via existing resolver pattern), channel icon, recipient, status pill, timestamp, and — when failed — a human-friendly reason via `parseCommError()` (same helper Live Feed uses) with the raw provider code in a tooltip.
- **Actions panel** (top-right of drawer):
  - **Retry failed** — visible when `failed > 0`. Calls a new edge fn `retry-campaign-failed` (see §3). Confirms count first.
  - **Re-trigger campaign** — re-sends to *all* original recipients. Confirmation dialog with total. Calls `sendCampaignNow(campaign.id, { mode: 'all' })`.
  - **Reconcile now** — invokes `reconcile-campaign-stats` for this campaign_id so the user isn't waiting on cron.
  - Buttons disabled while `status='sending'`.

### 3. New edge function `retry-campaign-failed`
`supabase/functions/retry-campaign-failed/index.ts`
- Input: `{ campaign_id }`.
- Loads `campaign_recipients` where merged status is `failed` (recipient row `status='failed'` OR joined log `delivery_status in ('failed','bounced')`).
- Builds a fresh audience array (same `source_type`/`source_ref_id` shape send-broadcast expects) and invokes `send-broadcast` with `{ campaign_id, audience, retry: true }`.
- Returns `202 { accepted, retrying }`.
- `send-broadcast` gets a small tweak: when `retry === true`, use a distinct dedupe_key suffix `:retry:<attempt>` so DLRs from the retry don't collide with the original log rows, and increment an `attempt` counter on `campaign_recipients` (new column, see §4).

### 4. Migration
`supabase/migrations/<ts>_campaign_recipient_retry.sql`
- `ALTER TABLE public.campaign_recipients ADD COLUMN IF NOT EXISTS attempt smallint NOT NULL DEFAULT 1, ADD COLUMN IF NOT EXISTS last_error text, ADD COLUMN IF NOT EXISTS last_retried_at timestamptz;`
- Index: `CREATE INDEX IF NOT EXISTS campaign_recipients_campaign_status_idx ON public.campaign_recipients (campaign_id, status);`
- Index on `communication_logs (dedupe_key text_pattern_ops)` if missing, to keep the `LIKE 'campaign:<id>:%'` join fast.
- Grants unchanged (table already has them).

### 5. Service layer
`src/services/campaignService.ts`
- Add `retryFailedRecipients(campaignId): Promise<{ accepted: number }>` — invokes `retry-campaign-failed`.
- Add `reconcileCampaignStats(campaignId)` — invokes `reconcile-campaign-stats`.
- Existing `sendCampaignNow` unchanged.

### 6. Panel touch-ups
`src/components/campaigns/CampaignsPanel.tsx`
- No behaviour change; card already links to the drawer. Just make the "SENDING" spinner honour the same disabled-actions rule (Retry / Re-trigger hidden while status is `sending`).

---

## Technical notes

- **Why keep `campaign_runs`?** Not deleted — legacy rows might still exist; the drawer just stops reading it. A follow-up cleanup migration can drop it later once verified empty in prod.
- **Dedupe key contract** stays `campaign:<campaign_id>:<source_type>:<source_ref_id>[:retry:<n>]` so `reconcile-campaign-stats` continues to work; that fn's `LIKE 'campaign:<id>:%'` already covers retries.
- **RLS / Grants**: `campaign_recipients` and `communication_logs` already have authenticated SELECT for branch members via existing policies — no policy changes.
- **CI comms guard**: `retry-campaign-failed` only invokes `send-broadcast` (not `send-*` directly) so the guard stays green.
- **No changes to `dispatch-communication`, `send-rcs`, `reconcile-rcs-pending`, or Telinfy handling.

---

## Files touched

- edit  `src/components/communications/LiveFeed.tsx`
- rewrite  `src/components/campaigns/CampaignDetailDrawer.tsx`
- edit  `src/components/campaigns/CampaignsPanel.tsx` (tiny)
- edit  `src/services/campaignService.ts`
- edit  `supabase/functions/send-broadcast/index.ts` (retry suffix + attempt bump)
- new   `supabase/functions/retry-campaign-failed/index.ts`
- new   `supabase/migrations/<ts>_campaign_recipient_retry.sql`

## Out of scope

- Redesigning the Campaigns card grid
- Changing scheduled-campaign cron
- Deleting the legacy `campaign_runs` table (separate cleanup PR)
