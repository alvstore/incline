
# IG Comment-to-DM Automation — Deep Audit & Phase 2 Plan

## ✅ What is already shipped

**Backend**
- Tables `ig_comment_campaigns`, `ig_comment_runs` with proper dedupe (`ig_runs_dedupe` partial unique on `campaign_id+ig_user_id+action` while status ∈ pending/scheduled/sent) and a due-row index.
- RPCs `bump_ig_campaign_counters`, `retry_ig_comment_run`.
- `_shared/ig-comment-automation.ts` — keyword matcher (exact/contains/starts_with), template renderer, `matchAndQueueCampaigns` queueing with DNC + opt-out gates.
- `meta-webhook` calls `matchAndQueueCampaigns` **after** the existing DM dedup + comment insert + auto-reply paths — fail-open, never blocks IG DM flow ✅.
- `process-ig-comment-runs` cron executor — Private Replies via `recipient.comment_id` (7-day window) with fallback to `recipient.id`, retry w/ exponential backoff, public comment reply path, AI mode via `runUnifiedAgent`, mirrors outbound into `whatsapp_messages` so the unified inbox shows it.

**Frontend**
- `/instagram-automations` page (KPIs + 14-day Recharts trend + table).
- `IgCampaignDrawer` (multi-step wizard, IG account/post pickers, Test panel).
- `IgRunsLogDrawer` with Retry → `retry_ig_comment_run` RPC.
- Sidebar entry under Operations & Comm.

**Existing IG DM functionality is intact** — comment automation lives in a try/catch after DM ingestion; no shared mutation.

---

## 🔴 Gaps & Risks Found

| # | Area | Issue | Severity |
|---|---|---|---|
| 1 | **Lead creation** | `lead_tag`, `pipeline_stage`, `leads_created` exist in DB and in the UI but the executor **never creates a lead, tags it, or increments `leads_created`**. Promise without delivery. | HIGH |
| 2 | **DNC lookup** | Queries `whatsapp_chat_settings(branch_id, phone_number=ig_user_id)` without filtering `platform='instagram'`. Risk of collision with WhatsApp numbers and missed IG-specific opt-outs. | HIGH |
| 3 | **Self-comment guard** | Compares `ig_user_id === ig_account_id`; these are different namespaces (IGSID vs Business IG ID). Guard never triggers. Should skip when commenter equals the page's own IG user (`from.id`-style match) or when `from.id` is the configured business account. | MED |
| 4 | **`allow_repeat` ignored** | Schema + UI expose it; matcher relies only on the partial unique index. Toggling it does nothing. Need a real cooldown / `allow_repeat=true` path that bypasses dedupe. | HIGH |
| 5 | **Delete confirmation** | Uses native `confirm()` — violates project "AlertDialog only" rule. | LOW |
| 6 | **`outbound_message_id` UPDATE** | When inbox insert fails, code runs `.eq("id", "")`. Harmless but unsafe; should branch. | LOW |
| 7 | **AI brain contamination** | `runUnifiedAgent` is called with `messageType: "comment"` reusing the DM conversation memory; can pollute the user's chat thread context. Needs an ephemeral/no-persist mode. | MED |
| 8 | **Public-reply counter** | `bump_ig_campaign_counters` only tracks DMs; public replies are invisible in stats. | LOW |
| 9 | **Trend chart label** | Counts every run row as "matched", including skipped/duplicates — overstates the funnel. Should count distinct matches and exclude skipped. | LOW |
| 10 | **Rate limiting** | A viral post can flood Meta Graph (per-account 200 calls/hr). No per-account/min queue throttle. | MED |
| 11 | **Notification spam** | Notifies up to 50 users globally per DM; ignores branch scope and dedupe — should route via the existing notification engine + role filter. | MED |
| 12 | **Page-token fallback** | `loadIntegration` accepts only `instagram` / `instagram_login` provider rows. FB Page–connected IG accounts (where token lives under `meta` / `facebook_page`) won't resolve. | MED |
| 13 | **`verify_jwt` for cron exec** | `process-ig-comment-runs` should be invokable by cron only; today any anon caller can trigger a tick. Add `verify_jwt=true` + service-role header from cron, or in-code shared secret. | MED |
| 14 | **Test panel preview** | For AI mode the preview is `null`; user sees blank. Should return a short dry-run completion (clearly marked "preview"). | LOW |
| 15 | **No webhook re-entry test fixture** | No Deno tests for `matchKeyword`, dedupe insert, or DNC gating. | MED |
| 16 | **`media_id` mismatch** | Campaign stores Graph `media.id` but `post_link` template renders `instagram.com/p/{media_id}` which is the shortcode URL, not the numeric ID — link is broken. Use `media.permalink` (resolve once on campaign save). | MED |
| 17 | **Storm safety** | No "max DMs per hour per campaign" cap — required by Meta policy and brand safety. | MED |
| 18 | **Audit trail** | `ig_comment_runs` doesn't FK to created lead, so the Logs drawer can't link to the lead created. (Once #1 lands.) | LOW |

---

## 🛠 Phase 2 — Implementation Plan

### 1. Lead creation pipeline (fixes #1, #18)
- New helper in `_shared/ig-comment-automation.ts`: `ensureLeadFromIgComment({ branch_id, ig_user_id, ig_username, campaign })`.
  - Find-or-create a row in `leads` keyed on `(branch_id, source='instagram', external_id=ig_user_id)`.
  - Set `full_name`, `source_detail = 'ig_comment:'+campaign.name`, and append `campaign.lead_tag` to `tags[]`.
  - If `campaign.pipeline_stage` set → set/upgrade `pipeline_stage` only when current stage is "new" (don't downgrade).
  - Bump `leads_created` via `bump_ig_campaign_counters(p_leads_created:=1)` (extend RPC param).
- Executor calls it **after** successful DM send (success-only attribution).
- Store `lead_id` on `ig_comment_runs`; Logs drawer renders a link.

### 2. DNC + identity correctness (#2, #3)
- DNC query becomes `.eq('phone_number', ig_user_id).eq('platform','instagram')`.
- Self-comment guard: compare against the integration's stored `instagram_business_id` and `page_id`, not `igAccountId` blindly.

### 3. `allow_repeat` honored (#4)
- When `allow_repeat=false` (default): keep current dedupe.
- When `allow_repeat=true`: insert with a synthetic per-comment `dedupe_key = comment_id` so the partial unique still prevents duplicate processing of the **same comment**, but new comments from the same user create new runs.
- Add optional `cooldown_hours` column (default 0); enforce in matcher by checking last `sent` run.

### 4. Storm & rate safety (#10, #17)
- Add `daily_cap` (int) and `per_user_cooldown_minutes` (int) on `ig_comment_campaigns`.
- Executor reads counters for the rolling window; if cap hit → mark run `skipped/cap_reached`, surfaced in logs.
- Per-account Graph throttle: in cron tick, group `due[]` by `ig_account_id` and respect a soft cap (e.g. 60/min) by deferring excess to next tick.

### 5. AI brain isolation (#7)
- Add an optional `ephemeral: true` flag to `runUnifiedAgent` that disables thread-memory write-back; pass it from comment-automation calls.
- Or: synthesize a one-shot prompt locally (no `runUnifiedAgent`) using Lovable AI Gateway `google/gemini-2.5-flash`; cheaper and side-effect-free.

### 6. Integration & token resolution (#12, #13)
- Extend `loadIntegration` to also pick `meta`/`facebook_page` rows whose credentials carry `instagram_business_account_id == campaign.ig_account_id`.
- Set `verify_jwt = true` for `process-ig-comment-runs` in `supabase/config.toml`; cron job already passes service-role header.

### 7. UX polish (#5, #8, #9, #14, #16)
- Replace `confirm()` with `AlertDialog` for delete.
- Extend RPC `bump_ig_campaign_counters` with `p_public_replies` and surface it as a 6th KPI.
- Trend chart: split "matched" (distinct `comment_id`) from "queued"; exclude `skipped`.
- Test panel: for AI mode, call the same one-shot AI helper to produce a preview string.
- On campaign save (UpsertIgCampaign), resolve `ig_media_id` → `permalink` via `meta-admin` and store it in a new column `ig_media_permalink`; template renderer uses that for `{{post_link}}`.

### 8. Notification correctness (#11)
- Route via existing notification engine helper, scope to `branch_id`, dedupe per `(campaign_id, ig_user_id)`, deliver to `owner`/`manager` only.

### 9. Tests (#15)
- `supabase/functions/_shared/ig-comment-automation.test.ts` covering: matcher truth-table, render escaping, DNC gating, dedupe insert behavior.
- One integration-style test for `process-ig-comment-runs` with mocked Graph fetch.

### 10. Migration summary
```text
ALTER TABLE ig_comment_campaigns
  ADD COLUMN daily_cap                int     NOT NULL DEFAULT 0,
  ADD COLUMN per_user_cooldown_minutes int    NOT NULL DEFAULT 0,
  ADD COLUMN ig_media_permalink       text;

ALTER TABLE ig_comment_runs
  ADD COLUMN dedupe_key text;

CREATE OR REPLACE FUNCTION bump_ig_campaign_counters(
  p_campaign_id uuid,
  p_comments_matched int DEFAULT 0,
  p_dms_sent         int DEFAULT 0,
  p_dms_failed       int DEFAULT 0,
  p_leads_created    int DEFAULT 0,
  p_public_replies   int DEFAULT 0
) ...
```

---

## Order of execution (suggested)

1. **Migrations** (cols + RPC signature) + DB-side guardrails.
2. **Executor fixes**: lead pipeline, DNC, self-guard, AI isolation, rate throttle, token resolution.
3. **UI**: AlertDialog, lead link in logs, KPI for public replies, trend split, AI preview.
4. **Tests** for matcher + executor.
5. **Verify**: deploy `process-ig-comment-runs` + `meta-webhook` + `meta-admin`; run a synthetic comment through `test_ig_comment_match` and validate end-to-end.

No changes are needed in DM ingestion, `findIntegrationByPageId`, or `triggerAiReply` — IG DM functionality stays untouched.
