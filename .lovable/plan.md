
# Reliable Chunked Broadcast Pipeline (reuse `send-broadcast`)

## Problem (recap)

`send-broadcast` runs the entire audience in one edge invocation. Isolates get recycled around ~150 s / CPU-quota, which is why the 337-recipient campaign dispatched ~30 messages, wrote 0 `campaign_recipients`, and looked "sent 0/0". We already batched the flush; now we need to eliminate the "one giant loop" itself so no invocation ever handles more than 20 recipients.

## Goal

- ≤ **20 recipients per invocation** — safe under isolate limits.
- Every dispatched row persisted immediately.
- Campaign auto-resumes until every recipient is processed.
- Pacing between sends to reduce Meta 131049 rejections.
- No new edge function — extend `send-broadcast` with a `mode` switch.

## Architecture

```text
CampaignWizard ──► campaigns row (status=scheduled)
                        │
        cron/5min ──► process-scheduled-campaigns
                        │
                        └─► send-broadcast { mode:'materialize', campaign_id }
                                 │
                                 │  writes N rows → campaign_recipients(status=pending)
                                 │  sets campaigns.status='sending'
                                 │
                                 └─► send-broadcast { mode:'chunk', campaign_id, batch_size:20 }
                                          │
                                          ├─ pulls next 20 pending rows (FOR UPDATE SKIP LOCKED)
                                          ├─ dispatches via dispatch-communication
                                          ├─ updates each row (status/error/pacing_code/…)
                                          ├─ updates campaigns counters
                                          └─ if pending remaining:
                                                fire-and-forget fetch(SELF, mode:'chunk')
                                                (EdgeRuntime.waitUntil, 3 s gap)
                                             else:
                                                status='sent', sent_at=now(), notify
```

Every chunk is a fresh isolate — 337 recipients ≈ 17 chunks, each ~30 s. Nothing ever stalls.

## Changes — all inside `send-broadcast/index.ts`

### 1. Add a `mode` router at the top of the handler

```
mode = body.mode ?? 'auto'
  'materialize' → materialize recipients, then self-invoke mode='chunk', ACK 202
  'chunk'       → process one batch of ≤20, self-invoke again if more pending
  'auto'        → legacy path (ad-hoc/member_ids, ≤ 50) — keep as-is for admin UI
```

If a caller passes `campaign_id` with `mode='auto'` and audience > 50, auto-upgrade to `mode='materialize'` so no future caller can accidentally revive the giant-loop path.

### 2. `mode: 'materialize'`

- Idempotent: skip if `campaign_recipients` already has rows for the campaign.
- Resolve audience once (existing member_ids path OR `recipients[]` array OR `resolve_campaign_audience` RPC for kind='contacts|leads|mixed|segment').
- Bulk INSERT into `campaign_recipients` with `status='pending'`, `attempt=0`, `source_type`, `source_ref_id`, `full_name`, `phone`, `email`.
- UPDATE campaigns: `status='sending'`, `recipients_count = N`, `success_count=0`, `failure_count=0`, `last_progress_at=now()`, `last_run_error=null`.
- Self-invoke `mode='chunk'` via `EdgeRuntime.waitUntil(fetch(SELF_URL, { ..., 'x-system-call': 'broadcast-chunk' }))`.
- Return 202 `{ accepted:true, materialized:N }`.

### 3. `mode: 'chunk'` — the workhorse

Per invocation:
1. `pg_try_advisory_xact_lock(hashtext(campaign_id))` — if not acquired, return `{ skipped:'locked' }` (another chunk is running).
2. Load campaign meta (channel, template_id, branch_id, message, variables, attachment_*, fallback_policy) once.
3. Load DNC digit set once for branch.
4. Pull batch via RPC (see §5) — atomic `SELECT … FOR UPDATE SKIP LOCKED LIMIT 20` returning rows already flipped to `status='dispatching'`. Prevents any duplicate send.
5. For each row (sequential, 1.5 s spacing):
   - Personalize body + `perVars` from `full_name`.
   - Invoke `dispatch-communication` with `dedupe_key = campaign:<id>:<source_type>:<source_ref_id>:attempt<N>`.
   - Existing pacing-fallback logic (131049/130472 → RCS/SMS) preserved.
   - UPDATE the row: `status='sent'|'failed'`, `error`, `pacing_code`, `fallback_used`, `fallback_channel`, `provider_route`, `dispatched_at=now()`, `attempt=attempt+1`.
   - `await sleep(pacing_ms)`.
6. Recompute campaign counters from DB (single `COUNT` grouped by status) and UPDATE `campaigns`.
7. Auto-pause check (terminal Meta codes ≥ 25% of failures) — existing logic, but reading from DB not the in-memory buffer.
8. Remaining pending?
   - Yes → fire-and-forget self-invoke, return `{ processed:B, remaining:R }`.
   - No  → UPDATE `campaigns.status='sent'`, `sent_at=now()`, insert notification, return `{ done:true }`.

### 4. `process-scheduled-campaigns`

Change the invocation body from the current "send-broadcast with full recipients[] array" to:

```
POST /send-broadcast { mode:'materialize', campaign_id: c.id }
```

Drop the audience resolution + payload construction — the materialize path owns it now. Keep the pre-dispatch WhatsApp template gate (APPROVED/PENDING/REJECTED) and the 202-ACK handling from v1.4.0.

### 5. Small SQL migration

- **RPC** `claim_broadcast_batch(p_campaign_id uuid, p_limit int)` — one round-trip pull-and-lock:

```sql
UPDATE campaign_recipients
SET status='dispatching', attempt=attempt+1, last_retried_at=now()
WHERE id IN (
  SELECT id FROM campaign_recipients
  WHERE campaign_id = p_campaign_id AND status='pending'
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT p_limit
)
RETURNING *;
```

- **Partial index** `idx_campaign_recipients_pending ON campaign_recipients(campaign_id) WHERE status='pending'` — keeps chunk pulls O(log N) even on 100k-row tables.
- **Watchdog automation rule** `reap_stalled_campaigns` (every 5 min) — for campaigns in `status='sending'` with `last_progress_at < now() - interval '10 min'` AND remaining pending rows, POST `send-broadcast { mode:'chunk', campaign_id }`. Handles the rare case where a chunk isolate dies mid-flight without self-invoking.
- **Max-attempts guard** inside chunk: rows with `attempt >= 3` and still `dispatching` get flipped to `failed` with `error='max_attempts_exceeded'`.

### 6. UI (tiny)

`src/components/campaigns/CampaignsPanel.tsx` — when `status='sending'`, show `"{success+failure}/{recipients_count} sent"` under the card. `CampaignReportDrawer` needs no changes; it already reads from `campaign_recipients` and now sees live rows.

## Technical Details

**Files to modify (build-mode):**
- `supabase/functions/send-broadcast/index.ts` — add mode router, materialize path, chunk path; keep legacy `auto` for ad-hoc UI (guarded to ≤50)
- `supabase/functions/process-scheduled-campaigns/index.ts` — call materialize instead of building recipients[]
- `src/components/campaigns/CampaignsPanel.tsx` — inline progress line
- 1 SQL migration: `claim_broadcast_batch` RPC + partial index + automation_rules row for watchdog

**Defaults (tunable via campaigns.fallback_policy JSONB):**
- `batch_size = 20`
- `pacing_ms = 1500` (≈ 40 msg/min → ~2000 msg/hour)
- `chunk_gap_ms = 3000` between self-invocations
- `max_attempts = 3`

**Auth (existing v4.2.0 pattern):**
- Self-invoke and cron use `apikey: SERVICE_ROLE_KEY` + `x-system-call: broadcast-chunk`.
- Ad-hoc admin calls still JWT-checked.

**Backwards compatibility:**
- Old callers passing `recipients[]` + `campaign_id` without `mode` → auto-routed through materialize (their array becomes the input to the bulk insert). No client changes required.

## Success criteria

- 500-recipient campaign completes with no single isolate > 30 s wall time.
- `count(campaign_recipients) == recipients_count` for every campaign, always.
- Drawer stats always match Meta's insights within one reconcile cycle.
- Meta 131049 failure rate visibly drops after 1.5 s pacing is live.
- Zero "phantom sent 0/0" cases in the next week's System Health.
