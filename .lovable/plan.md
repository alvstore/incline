
# Instagram Comment-to-DM Automation — Phase 1 (Audit + Architecture)

## 1. Codebase findings

**Stack** (already standardized — do not change):
- Frontend: React 18 + Vite + TS, Tailwind, shadcn, TanStack Query, React Hook Form + Zod.
- Backend: Supabase (Postgres + RLS + Edge Functions on Deno). Cron via `pg_cron`.
- Comms dispatcher: `dispatch-communication` (canonical), per-channel workers (`send-whatsapp`, `send-message`, `send-sms`, `send-email`).
- AI: Lovable AI Gateway via `_shared/ai-runtime.ts` + `_shared/ai-agent-brain.ts` (`runUnifiedAgent`, multi-platform: whatsapp / instagram / messenger).

**Existing Instagram pipeline (working — must not break):**
- `supabase/functions/meta-webhook/index.ts` is the single IG/FB intake:
  - Verifies `X-Hub-Signature-256` against `integration_settings.app_secret`.
  - Handles `entry.messaging[]` (DMs, story replies, postbacks, referrals) and `entry.changes[]` (comments + mentions).
  - `ingestInstagramComment()` lines 599–659: dedupes by `platform_message_id = comment_id`, inserts into `whatsapp_messages` with `message_type='comment'`, upserts `whatsapp_chat_settings`. Auto-reply only fires if org flag `whatsapp_ai_config.instagram_auto_reply_comments === true`.
  - `triggerAiReply()` lines 841–931: calls `runUnifiedAgent` then posts to `send-message` edge fn for actual delivery.
- `meta-admin/index.ts`: refresh page token, backfill IG profiles, subscribe fields.
- `meta-oauth-callback/index.ts`: stores credentials in `integration_settings`.

**Existing automation primitives:**
- `campaigns` table — broadcast-oriented (channel ∈ whatsapp/email/sms, trigger_type ∈ send_now/scheduled/automated). **Not a good fit** — it's segment broadcasting, not event-triggered per-user.
- `whatsapp_triggers` table — event_name → template_id, fired by other workers. No keyword, no media binding. **Not a good fit.**
- `automation_rules` + `automation-brain` cron worker — time-based, not webhook event-based. **Not a good fit.**
- `leads` table — already used by `runUnifiedAgent` to capture IG leads (sourceMap.instagram = "instagram_ai"). **Reuse as-is.**

**Send path for IG:** `send-message` edge fn already accepts `{platform: 'instagram', recipient_id, content}` and uses page access token from `integration_settings` to POST to Graph API. **Reuse as-is.**

**Conclusion:** existing tables don't model "post-bound keyword → per-commenter DM". Need ONE new domain (campaigns + runs/logs). All other layers (webhook intake, AI brain, send-message, leads, notifications, dispatcher) are reused unchanged.

## 2. Reuse map (zero rewrites)

| Layer | Reuse |
|---|---|
| Webhook intake + signature verify | `meta-webhook/index.ts` (insert one call into `ingestInstagramComment`) |
| Outbound DM delivery | `send-message` edge fn |
| AI reply generation | `runUnifiedAgent` with new `purpose='ig_comment_dm'` injection |
| Lead capture | existing `leads` + `runUnifiedAgent` lead-capture branch |
| Staff notifications | existing `notifications` table |
| Opt-out / DNC | existing `optOutDetector` + `mark_do_not_contact` |
| Identity resolution | existing `resolveInstagramSenderProfile` |
| Audit/error logging | existing `log_error_event` RPC |
| UI shell / drawers / tables | existing `Sheet` drawer pattern, `Campaigns.tsx` style |

## 3. Proposed data model (new — minimal, additive)

```sql
-- A campaign = one media (or "any media") + keyword set + DM template + actions
create table public.ig_comment_campaigns (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id) on delete cascade,
  integration_id uuid references integration_settings(id) on delete set null,
  name text not null,
  ig_media_id text,                       -- null = applies to ALL media on this IG account
  ig_account_id text,                     -- denormalized for fast match
  keywords text[] not null default '{}',  -- normalized lowercase
  match_type text not null default 'contains' check (match_type in ('exact','contains','starts_with')),
  case_sensitive boolean not null default false,
  reply_mode text not null default 'template' check (reply_mode in ('template','ai','hybrid')),
  dm_template text,                       -- supports {{first_name}} {{username}} {{keyword}} {{campaign_name}} {{post_link}}
  ai_instruction text,                    -- system prompt for AI mode
  ai_tone text default 'friendly',
  fallback_message text,
  comment_public_reply text,              -- optional public reply on the comment itself
  delay_seconds int not null default 0,
  allow_repeat boolean not null default false,
  lead_tag text,
  pipeline_stage text,
  notify_staff boolean not null default true,
  human_review boolean not null default false,
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  -- counters (denormalized for dashboard)
  comments_matched int not null default 0,
  dms_sent int not null default 0,
  dms_failed int not null default 0,
  leads_created int not null default 0,
  last_triggered_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on ig_comment_campaigns (branch_id, is_active);
create index on ig_comment_campaigns (ig_account_id, ig_media_id) where is_active;

-- Per-(campaign,user) dedupe + audit
create table public.ig_comment_runs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references ig_comment_campaigns(id) on delete cascade,
  branch_id uuid not null,
  ig_user_id text not null,
  ig_username text,
  ig_media_id text,
  comment_id text not null,
  comment_text text,
  matched_keyword text,
  action text not null,                    -- 'send_dm' | 'public_reply' | 'tag_lead' | 'notify_staff' | 'capture_lead'
  status text not null default 'pending',  -- pending | sent | failed | skipped | scheduled
  skip_reason text,
  scheduled_at timestamptz,
  executed_at timestamptz,
  error_message text,
  lead_id uuid,
  outbound_message_id uuid,                -- whatsapp_messages.id
  raw_payload jsonb,
  created_at timestamptz not null default now()
);
create unique index ig_runs_dedupe on ig_comment_runs (campaign_id, ig_user_id, action)
  where status in ('sent','scheduled','pending');
create index on ig_comment_runs (campaign_id, created_at desc);
create index on ig_comment_runs (comment_id);
```

**RLS:** branch-scoped via existing `get_user_branch()` + `has_capability('manage_automations')`. Member role gets no access.

**No existing tables modified.** `whatsapp_messages` row for the inbound comment continues to be the canonical event store; `ig_comment_runs.comment_id` joins back to it.

## 4. Webhook flow (extension to `meta-webhook`)

```text
IG comment webhook
  → existing ingestInstagramComment() inserts whatsapp_messages row
  → NEW: matchAndRunCampaigns(commentEvent, integration)
        1. SELECT active campaigns WHERE ig_account_id = recipient
              AND (ig_media_id = mediaId OR ig_media_id IS NULL)
              AND (starts_at IS NULL OR now() ≥ starts_at)
              AND (ends_at  IS NULL OR now() ≤ ends_at)
        2. Filter by keyword match (normalize + match_type)
        3. Self-comment guard (skip if comment from own IG account)
        4. DNC + opt-out gate (reuse optOutDetector + mark_do_not_contact)
        5. Dedupe via ig_comment_runs unique index (unless allow_repeat)
        6. Insert run rows (one per action) with status='scheduled' if delay>0 else 'pending'
        7. If delay = 0 → immediately call executeRun() inline (fire-and-forget)
           Else        → cron worker process-ig-comment-runs picks up due rows
```

Fail-open: webhook always returns 200; campaign matching errors logged via `log_error_event` and never block the DM-reply pipeline that already exists.

## 5. Scheduler / executor

New edge fn **`process-ig-comment-runs`** (cron every 1 min):
- `SELECT … WHERE status='scheduled' AND scheduled_at ≤ now() LIMIT 100 FOR UPDATE SKIP LOCKED`.
- For each: build context, call AI brain if `reply_mode != 'template'`, render `{{vars}}`, insert outbound `whatsapp_messages` row, POST `send-message` with `platform=instagram` and `recipient_id=ig_user_id` (uses Instagram Private Replies — within 7-day comment window, `recipient: { comment_id }` is also supported and we'll pass it to widen the window).
- On success: update run status='sent', increment campaign counters atomically via RPC `bump_ig_campaign_counters(campaign_id, kind)`.
- On failure: status='failed', `error_message`, exponential retry (max 3, reuses existing pattern from `process-comm-retry-queue`).
- Optional public comment reply via Graph `POST /{comment-id}/replies` when `comment_public_reply` is set.

## 6. AI brain integration

Reuse `runUnifiedAgent` but with a per-campaign override block prepended to its system prompt:
- `purpose: 'ig_comment_dm'`
- inject `campaign.ai_instruction`, `ai_tone`, allowed/forbidden facts, fallback.
- Reuses lead capture, memory, do-not-ask, runtime rules, identity resolution. No fork of the brain.

## 7. Admin UI (new route `/instagram-automations`)

Follows Vuexy + side-Sheet rules from project memory. New files:

```
src/pages/InstagramAutomations.tsx                ← dashboard + table
src/components/ig-automations/
  IgAutomationsDashboard.tsx                       ← KPI cards
  IgCampaignsTable.tsx                             ← list w/ toggle, actions
  IgCampaignDrawer.tsx                             ← create/edit Sheet (5-step wizard)
    steps/Step1Details.tsx
    steps/Step2Triggers.tsx                        ← keywords + media picker
    steps/Step3Reply.tsx                           ← template/AI/hybrid + AI brain panel
    steps/Step4Actions.tsx                         ← delay, tag, stage, notify, dedupe toggle
    steps/Step5Review.tsx                          ← preview DM with sample vars
  IgRunsLogDrawer.tsx                              ← per-campaign logs
  IgMessagePreview.tsx                             ← live variable interpolation
  IgKeywordChips.tsx
src/services/igAutomationService.ts                ← TanStack hooks
src/types/igAutomations.ts
```

Navigation: add entry under existing **Settings → Communication / Automations** group (next to "WhatsApp Automations"), capability `manage_automations`.

Wizard mirrors existing `CampaignWizard.tsx` structure (Type pre-step → step nav). All forms in right-side `Sheet sm:max-w-xl` per project memory. Toggles use shadcn `Switch`. Status uses colored badges per design system.

Logs page = drawer from table row "View Logs", lists `ig_comment_runs` with status badge, raw payload viewer, retry button (manager+).

## 8. Error handling

- Every webhook-side mismatch logged with `log_error_event('ig_comment_match', fingerprint)`.
- Every executor failure stored on `ig_comment_runs.error_message` + raised via `log_error_event`.
- Retry queue reuses existing pattern (3 attempts, exponential backoff).
- AI failure → fall back to `dm_template` then `fallback_message`.

## 9. Duplicate prevention

- Partial unique index on `ig_comment_runs (campaign_id, ig_user_id, action) WHERE status IN ('sent','scheduled','pending')`.
- `allow_repeat=true` skips this guard.
- `comment_id`-level dedupe already exists on `whatsapp_messages.platform_message_id`.

## 10. Security & validation

- Zod schemas on campaign create/update API; keyword normalization server-side.
- RLS: branch-scoped writes, `has_capability('manage_automations')`.
- IG Private Reply window enforced server-side (≤7 days from comment timestamp).
- Honor DNC + opt-out before any outbound.
- Never expose page access token to client (already enforced in `integration_settings` RLS).
- Self-comment guard (skip when comment author = business IG ID).
- Rate-limit per IG user per campaign per 24h (configurable).

## 11. Rollback plan

- All new objects live in two new tables + one new edge fn + one new cron + new UI route. No alterations to `whatsapp_messages`, `campaigns`, `whatsapp_triggers`, `automation_rules`, `leads`, `integration_settings`, `meta-webhook` send path.
- One-line insertion in `meta-webhook` (`await matchAndRunCampaigns(...)` after `ingestInstagramComment`) wrapped in try/catch — removing it instantly restores prior behavior.
- Disable feature entirely: `UPDATE ig_comment_campaigns SET is_active=false` or unschedule the `process-ig-comment-runs` cron.

## 12. Implementation phases (after this plan approval)

- **Phase 2 — DB:** migration with two tables + RLS + `bump_ig_campaign_counters` RPC.
- **Phase 3 — Webhook hook:** add `matchAndRunCampaigns` to `meta-webhook` (try/catch wrapped, fire-and-forget).
- **Phase 4 — Executor:** new edge fn `process-ig-comment-runs` + pg_cron schedule.
- **Phase 5 — AI brain extension:** add `purpose='ig_comment_dm'` injection path inside `runUnifiedAgent`.
- **Phase 6 — UI:** route + dashboard + wizard + logs drawer.
- **Phase 7 — Analytics:** dashboard KPIs from `ig_comment_runs` aggregates.
- **Phase 8 — Tests:** integration test for keyword match + dedupe; smoke test the IG DM path against existing test integration.
- **Phase 9 — Docs:** `docs/instagram-comment-automation.md` + update `meta-webhook/SUBSCRIPTION_FIELDS.md` (already includes `comments` field — no new subscription needed).

## Open questions before Phase 2

1. **Media picker source** — Pull recent IG media via Graph `/me/media` inside the drawer (preferred), or just let admin paste media ID? I'll default to "fetch list + free-text fallback" unless you say otherwise.
2. **Public comment reply** — Include `comment_public_reply` field now (Graph `POST /{comment-id}/replies`)? Default: yes, optional.
3. **Follow-up sequences** — Treat as a Phase-10 add-on (reuse `automation_rules`) or scope in now? Default: Phase 10.
