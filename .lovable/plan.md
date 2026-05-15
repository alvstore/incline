
# Robust Campaign Manager v2

Goal: turn Marketing & Campaigns into a single reliable surface for promotions, events, announcements and lead re-engagement across **members, leads, lost leads and all contacts** — with **honest Meta-template gating** so cold-audience broadcasts never silently bounce.

---

## 1. The Meta gating problem (root cause + fix)

WhatsApp Cloud API rules:
- Inside a 24h customer service window (member messaged us in last 24h) → **freeform allowed**
- Outside the window (leads, lost leads, dormant members, scheduled blasts) → **only APPROVED Meta templates** are delivered. Anything else returns error 131047/131026 → counts as "failed" in our logs.

Today the wizard lets users send freeform text to any audience, which is why broadcasts to leads/cold members bounce.

### Fix — three coordinated changes

**A. Audience classification at resolve time** (`resolveAudienceMemberIds` + a new `classifyAudienceWindow` helper):
- Tag each resolved recipient with `in_24h_window: boolean` (computed from `whatsapp_messages.last_inbound_at` for that phone in last 24h).
- Return aggregate counts: `{ total, in_window, cold }`.

**B. Wizard "Send Path" auto-decides and enforces:**
- If `cold > 0` AND channel = whatsapp → **approved Meta template is REQUIRED** (toggle becomes mandatory, not optional). Block "Send now" / "Schedule" until template selected.
- If `cold === 0` → freeform allowed (current behavior).
- Show a clear banner on the Message step:

  ```text
  ⚠ 412 of 530 recipients are outside the 24h window.
     WhatsApp will reject freeform messages to them.
     → Pick an APPROVED template, or narrow audience to "Active members in last 24h".
  ```

**C. Dispatcher already supports `template_id` end-to-end** (verified: `send-broadcast` v3.1.0 → `dispatch-communication` v1.11.0 → `send-whatsapp`). No edge changes needed for the happy path. We will add **per-recipient routing**: if a recipient is in-window, send freeform body; if cold, send the chosen template. This avoids forcing the in-window members through a stiff template.

---

## 2. Audience expansion — members, leads, lost leads, all contacts

Today `AudienceBuilder` supports: members (by status), segments, mixed. Expand to a unified contact model:

New `audience_kind` values added to `resolve_campaign_audience` RPC:
- `members` (existing — filter by status, plan, branch, last_visit)
- `leads` — from `leads` table, filter by stage (new/contacted/qualified/trial)
- `lost_leads` — leads with stage = lost OR no activity > 60d
- `contacts` — union of members + leads + walk-ins from `contacts` view
- `segment` (existing saved segment)
- `mixed` (existing — pick any combination)
- `csv_import` (NEW — paste/upload phone+name list, one-shot)

Each recipient row carries: `id, name, phone, email, source: 'member'|'lead'|'lost_lead'|'contact'|'csv', in_24h_window`.

The Audience step shows a **breakdown chip row**:
`Members 312 · Leads 154 · Lost 64 · Custom 0 · In-window 118 · Cold 412`

---

## 3. Campaign types — drive sane defaults

The wizard already has 4 types. Make them actually change behavior:

| Type | Default audience | Default channel | Forces template? |
|---|---|---|---|
| Promotion | members(active) + leads(qualified) | whatsapp + email | Yes if cold |
| Event | members(active) + segment | whatsapp | Yes if cold; auto-include RSVP CTA + ICS link |
| Announcement | members(all active) | whatsapp + in-app | No (mostly in-window) |
| Lead Re-engagement | lost_leads + leads(no activity 30d) | whatsapp | **Always yes** (cold by definition) |

---

## 4. UI/UX overhaul

Wizard becomes a 5-step rail with a persistent right-side **Live Preview panel** (audience size, sample 5 recipients, channel preview bubble):

```text
┌─ Type ─┬─ Audience ─┬─ Message ─┬─ Schedule ─┬─ Review ─┐
│        │            │           │            │          │
│ Pick   │ Filters +  │ Template  │ Send now / │ Final    │
│ purpose│ live count │ or AI     │ schedule / │ confirm  │
│        │ + window   │ draft +   │ recurring  │ + cost   │
│        │ breakdown  │ preview   │            │ estimate │
└────────┴────────────┴───────────┴────────────┴──────────┘
                                                  │
                                          ┌───────┴────────┐
                                          │ Live Preview   │
                                          │ • 530 reach    │
                                          │ • 118 in-win   │
                                          │ • 412 cold ⚠   │
                                          │ • template ✓   │
                                          │ • cost ~₹62    │
                                          └────────────────┘
```

Specific UI additions:
- **CampaignsPanel header**: filter bar (status: all/draft/scheduled/sending/sent/failed) + search by name + sort (recent/best-performing).
- **Card stats**: add a 4th stat "Read" (from `whatsapp_messages.status='read'` aggregation) and a small sparkline of delivered-vs-failed.
- **Card actions** (already added: edit/delete/duplicate/cancel) — add **"View report"** that opens an analytics drawer with per-recipient delivery status, error reasons grouped (e.g., "412 failed: outside 24h window — needs template"), CSV export.
- **Empty state** gets two CTAs: "New campaign" + "Browse template gallery".
- **Recurring campaigns** get a calendar preview ("Next 4 sends: Mon 18 May, Mon 25 May…").

---

## 5. Meta template lifecycle visibility

`MetaTemplatesPanel` (Settings → Communication Templates → Meta Approved):
- Auto-poll Meta status every 30s for any template in `PENDING` (calls existing `manage-whatsapp-templates` `action: 'get_status'`).
- Status badges: PENDING (amber pulse) · APPROVED (emerald) · REJECTED (red, with reason expander).
- "Submit similar" button on rejected templates → opens AI drawer pre-filled with original body for revision.
- Banner in CampaignWizard Message step linking to the template panel: "Need a new template? It typically takes 1–24h for Meta approval."

---

## 6. Failure transparency

Today a campaign just shows aggregate `success/failure`. Add:
- `campaign_recipients.error_code` + `error_reason` columns (migration).
- `dispatch-communication` already returns Meta error codes — pipe them into the recipient row.
- Report drawer groups failures by reason so the user understands "412 failed because no approved template was used", not a mystery.

---

## 7. Files affected

**Database (1 migration)**
- `campaign_recipients`: add `error_code text`, `error_reason text`, `in_window boolean`, `source text`, `read_at timestamptz`.
- Update `resolve_campaign_audience` RPC to support `leads`, `lost_leads`, `contacts`, `csv_import` and return window classification.

**Frontend**
- `src/services/campaignService.ts` — extend `AudienceFilter`, add `classifyAudienceWindow`, return breakdown counts, surface error reasons in report query.
- `src/components/campaigns/AudienceBuilder.tsx` — new audience kinds, breakdown chips, in-window chip.
- `src/components/campaigns/CampaignWizard.tsx` — 5-step rail, Live Preview panel, template enforcement banner, type-driven defaults, recurring calendar preview.
- `src/components/campaigns/CampaignsPanel.tsx` — filter+search bar, "Read" stat, View Report action.
- `src/components/campaigns/CampaignReportDrawer.tsx` — **NEW** analytics drawer with grouped failure reasons + CSV export.
- `src/components/settings/MetaTemplatesPanel.tsx` — 30s auto-poll, "Submit similar" action.

**Edge functions**
- `dispatch-communication` — per-recipient routing (template if cold, freeform if in-window); write `error_code`/`error_reason` to `campaign_recipients`.
- `send-broadcast` — accept the new audience kinds (pass through, RPC does the work).

No breaking API changes. All new columns nullable, all new audience kinds additive.

---

## 8. Out of scope (this plan)

- A/B testing templates (could be v3).
- WhatsApp marketing template categories beyond UTILITY/MARKETING toggle.
- Cross-channel orchestration (email + SMS + WhatsApp same campaign as one entity) — currently 1 campaign = 1 channel, will stay so.

---

**One question before I build:** for the **CSV import audience** — do you want it as a manual paste (phone,name per line) inside the wizard, or a full file upload with column mapping? Manual paste is ~1h work; file upload with mapping is ~3h. I'll default to manual paste unless you say otherwise.
