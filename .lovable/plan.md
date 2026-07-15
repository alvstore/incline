## Corrected Audit — I was wrong earlier

You were right. There ARE two distinct WhatsApp send APIs from Meta, and we're only using one:

| | **Cloud API** (what we use) | **MM API for WhatsApp** (what we're missing) |
|---|---|---|
| Endpoint | `POST /{PHONE_ID}/messages` | `POST /{PHONE_ID}/marketing_messages` |
| Purpose | All message types (utility, auth, service, marketing) | **Marketing templates only** |
| Delivery optimization | Standard Meta pacing → high 131049 rate on promo blasts | ML-based per-recipient delivery optimization → materially lower 131049 |
| Insights | Basic DLR | Adds performance benchmarks, cost/delivery, ad-account linked measurement |
| Runs on same WABA phone | — | Yes, in parallel with Cloud API |
| Auth | Same permanent token (`whatsapp_business_messaging` scope) | Same token — no new secret |
| Onboarding | Already done | Accept ToS in App Dashboard → WhatsApp → Quickstart → "Improve ROI with marketing messages" |
| Availability | Global | Geo-gated; **India is currently eligible** (GA'd 2025, formerly "MM Lite") |
| Meta Pixel/CAPI | Optional | Required for conversion measurement (optional for basic send) |

Source: developers.facebook.com/docs/whatsapp/marketing-messages-lite-api/ (fetched today).

**My earlier claim that "no separate marketing API exists" was incorrect.** MM API won't eliminate 131049 entirely (Meta still gates over-messaged recipients), but Meta's own testing shows meaningfully higher reads/clicks vs sending the same marketing template via Cloud API.

---

## The 3 Epics — Plan

### Epic 1 — Backend: Dual-endpoint dispatcher (MM API + Cloud API)

**1.1 Schema (`integration_settings.config` for WhatsApp, per-branch + global):**
- `mm_api_enabled: boolean` (default false — flip on after ToS accepted)
- `mm_api_tos_accepted_at: timestamptz` (set from UI when admin confirms)
- No new secret; reuses existing `access_token` + `phone_number_id`.

**1.2 New edge fn `send-whatsapp-marketing`** (thin, mirrors `send-whatsapp`):
- `POST {META_API_BASE}/{phone_number_id}/marketing_messages` with the exact same `{ messaging_product, to, type:'template', template:{...} }` body.
- Handles same DLR/webhook events (MM API reuses the existing messages webhook — no new subscription needed).
- Terminal-error handling identical to `send-whatsapp` (131049/131047/132001/etc).
- Records `provider_route: 'mm_api' | 'cloud_api'` on `communication_logs`.

**1.3 Router in `send-broadcast/index.ts`:**
- For every campaign recipient where `template.category = 'MARKETING'`:
  - If branch WA config `mm_api_enabled = true` → call `send-whatsapp-marketing`.
  - Else fall back to existing `send-whatsapp` (Cloud API) — no behavior change.
- Non-marketing templates (utility/auth/service) → always Cloud API. MM API rejects them.
- Existing `fallback_policy` (RCS/SMS on 131049) still fires on pacing errors from either route.

**1.4 `dispatch-communication` (unchanged) — one-to-one transactional traffic keeps using Cloud API.** MM API is broadcast-only by design.

### Epic 2 — Frontend: Marketing route toggle + campaign transparency

**2.1 Settings → Integrations → WhatsApp card:**
- Add "Marketing Messages API" section with:
  - Status pill (Not enrolled / Enrolled)
  - "Accept ToS in Meta" deep link → App Dashboard Quickstart
  - "I've accepted — enable MM API for marketing sends" toggle (writes `mm_api_enabled` + timestamp)
  - Advisory: "Marketing templates will route through MM API for higher delivery. Utility/auth/service messages continue via Cloud API."

**2.2 `CampaignWizard` → Type step:**
- When user selects **Promotion**, show a green info chip: *"Will send via WhatsApp Marketing Messages API (higher delivery)"* — or amber warning if MM API not enabled, with 1-click link to Settings.

**2.3 `CampaignDetailDrawer`:**
- New column/badge on the recipients list: `via MM API` or `via Cloud API`.
- KPI strip shows a "Route" breakdown when a campaign mixes routes (e.g., MM API enabled mid-campaign, or fallback fired).
- Failure tooltip already shows pacing/error reason from prior work — extend to note whether it came from MM or Cloud path.

### Epic 3 — Observability & migration

**3.1 Migration:**
- Backfill `communication_logs.provider_route = 'cloud_api'` for existing rows.
- New DB view `v_campaign_route_stats` (campaign_id, route, sent, delivered, read, failed) powering the drawer's Route breakdown.

**3.2 Docs / runbook update** (`docs/communication-dispatcher.md`):
- Add "Marketing vs Cloud API routing" section with the decision table.
- Note MM API prerequisites (ToS + at least one approved marketing template + messages webhook subscribed — already done).

**3.3 No mock traffic, no dev-mode shortcut.** MM API onboarding must be done for real in Meta; the toggle is gated behind the timestamp.

---

## Out of scope for this change
- Meta Pixel / Conversions API wiring for conversion measurement (Epic 3.b — separate ticket).
- Rewriting the wizard's audience engine.
- Any change to the Live Feed / dedupe / 24h-window logic.

## Rollout
1. Ship code with `mm_api_enabled = false` everywhere → zero behavioral change.
2. Admin accepts Meta ToS, flips the toggle in Settings for the branch's WA config.
3. Next promotional campaign automatically routes through `marketing_messages`. Monitor via drawer's Route KPI vs the Cloud-API baseline for 2–3 sends before enabling globally.

Approve and I'll implement Epics 1–3 in one pass (roughly: 1 migration, 1 new edge fn, edits to `send-broadcast`, `CampaignWizard`, `CampaignDetailDrawer`, WhatsApp integration settings UI, dispatcher docs).