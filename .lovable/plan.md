## Root cause of "CHOOSE_WHAT_DESERVES" not triggering

Audit trail:
- Cron rule `process_scheduled_campaigns` fires every minute and is healthy (last_status=success).
- It picks the due campaign, locks it to `sending`, resolves audience, then POSTs to `send-broadcast` with `Authorization: Bearer <SERVICE_ROLE_KEY>`.
- `send-broadcast` v4.1.0 authenticates via `authClient.auth.getClaims(token)` — a **user JWT check**. A service-role key is not a user JWT, so `getClaims` fails and the function returns **HTTP 401 `Unauthorized`**.
- `process-scheduled-campaigns` writes that string to `campaigns.last_run_error = "Unauthorized"` and flips status to `failed`. Zero recipients ever resolved because the audience branch (`audience_kind='contacts'`) also runs, but the send never happens.
- On the UI: Edit is disabled for `status='failed'`, so the user can't recover the campaign — only Duplicate works, and the duplicate would fail again for the same reason.

Same class of bug already fixed in `mips-access` and `automation-brain` (system-call gate). `send-broadcast` was missed.

---

## Fix plan

### 1. `supabase/functions/send-broadcast/index.ts` — accept system calls
Add a system-call gate BEFORE `getClaims`:
- If `Authorization: Bearer <SERVICE_ROLE_KEY>` OR (`apikey === SERVICE_ROLE_KEY` and `x-system-call` present) → treat as system, skip user-role check, skip `getClaims`.
- Otherwise keep the existing user JWT + `user_roles ∈ (owner,admin,manager,staff)` gate.
- Bump header to `// v4.2.0 — system-call gate for scheduled campaigns / automation-brain`.

### 2. `supabase/functions/process-scheduled-campaigns/index.ts` — send system-call headers
Post to send-broadcast with both:
```
apikey: <SERVICE_ROLE_KEY>
x-system-call: scheduled-campaigns
Authorization: Bearer <SERVICE_ROLE_KEY>
```
(defense in depth — either gate satisfies the new fn).

### 3. Unstick the current failed campaign
One-time UPDATE via migration or admin action:
```sql
update campaigns
set status='scheduled',
    scheduled_at = now() + interval '2 minutes',
    last_run_error = null
where id='264bd41f-4d46-4bfc-af98-36fc926bfd1f';
```
Next cron tick will pick it up cleanly.

### 4. `CampaignsPanel.tsx` — recover from failed
- Allow **Edit** when `status in ('draft','scheduled','pending_template_approval','failed')` — editing a failed campaign resets it to `draft` in the wizard save path.
- Add a first-class **"Retry"** dropdown item for `status='failed'` that resets to `scheduled` with `scheduled_at = now()+1min` and clears `last_run_error` (single RPC or update).
- Show `last_run_error` inline on the failed card (currently hidden).

---

## Marketing & Campaigns — full UI/UX redesign (2026, /skill:ui-ux-pro-max)

Applies UUPM design-system output to the Vuexy token set (indigo/violet, Inter, rounded-2xl, soft slate shadows). Scope: `src/components/campaigns/*` + the Campaigns tab inside `/announcements`.

### New layout
```
┌─ Header ─────────────────────────────────────────────────────────┐
│  Marketing & Campaigns          [+ New campaign]  [+ Announce]  │
│  Segmented / recurring sends with attachments · WA · SMS · Email│
└─────────────────────────────────────────────────────────────────┘
┌─ KPI Row (5 gradient/soft cards) ───────────────────────────────┐
│ Sent 30d │ Delivery% │ Read% │ Failure% │ Meta pacing hits 7d   │
└─────────────────────────────────────────────────────────────────┘
┌─ Filters strip ─────────────────────────────────────────────────┐
│ [All] [Draft] [Scheduled] [Sending] [Sent] [Failed]  [Channel▾]│
│ [Date range]  🔍 search                                         │
└─────────────────────────────────────────────────────────────────┘
┌─ Campaign cards (rounded-2xl, shadow-lg) ───────────────────────┐
│  Name · channel chip · status badge · schedule chip · … menu    │
│  Preview snippet (2 lines)                                       │
│  Mini funnel bar: Total → Delivered → Read → Failed             │
│  Failure reason banner (if failed, red-50 pill w/ code + hint)  │
│  Footer: recipients, created_by avatar, "View report"           │
└─────────────────────────────────────────────────────────────────┘
```

### CampaignReportDrawer (redesign)
Right-side Sheet, `sm:max-w-2xl`, three vertical sections:

1. **Header** — name, channel, status, template name, created info, primary actions `Reconcile now`, `Retry failed (n)`, `Re-trigger to all`.
2. **Funnel strip** — 5 gradient stat cards (Total / Sent / Delivered / Read / Failed) with 24h delta arrows.
3. **Delivery timeline** — sparkline of send/delivered/read/failed per 5-min bucket (pulled from `campaign_recipients.updated_at` — already stored).
4. **Failure breakdown card** — grouped by `meta_code / reason` with human labels from `src/lib/comms/metaErrorLabels.ts`:
   - `131049 — Meta pacing (recipient engagement)` · count + "Fall back to SMS" button
   - `132000 — Template variable mismatch` · count + "Fix template" link
   - `pacing_cooldown_24h — dispatcher suppressed` · count
   - `template_stale_in_meta` · count + "Resync template" button
   - Free-text errors bucketed into "Other".
5. **Recipients table** — sticky-header, filter chips `All / Delivered / Failed / Pending`, columns: Name · Phone · Status badge · Reason (truncated + tooltip) · Sent at · Action (Retry). Row hover, virtualized if >100 rows.

### Editing / Retry
- Wizard opens for `draft | scheduled | failed`. Editing a `failed` campaign resets to `draft` (saved via wizard's existing patch).
- New dropdown items in card menu: **Retry now**, **Fall back to SMS/RCS**, **Reschedule…**.

### CampaignWizard polish
- Replace channel chip row with segmented Vuexy chips (violet-600 active).
- Step 3 (Creative) drops file preview cards with size + kind pill.
- Recipient step: audience count updates live via `resolve_campaign_audience` preview RPC; show top 5 sample recipient names.
- Review step: green-emerald "Ready to send" summary card, or amber "Template pending Meta approval — will queue" banner.

### Empty / loading / error states
- Empty: centered SVG (existing lucide `MessageSquare`), "Launch your first campaign" CTA.
- Loading: 3 skeleton cards matching new card height.
- Error: red-50 banner with `Retry` (calls `queryClient.invalidateQueries`).

### Accessibility
- Every icon-only action has `aria-label`.
- Status badges use text + color (never color alone).
- All cards are keyboard-focusable, focus ring `focus:ring-2 focus:ring-indigo-500`.

---

## Files changed

Backend
- `supabase/functions/send-broadcast/index.ts` — v4.2.0 system-call gate
- `supabase/functions/process-scheduled-campaigns/index.ts` — send `apikey`+`x-system-call`
- One-time SQL to reset stuck campaign

Frontend
- `src/components/campaigns/CampaignsPanel.tsx` — allow edit/retry on failed, inline error, redesigned card, KPI row, filter strip
- `src/components/campaigns/CampaignReportDrawer.tsx` — funnel, failure breakdown, timeline, recipient table
- `src/components/campaigns/CampaignWizard.tsx` — reset failed→draft on save, wizard polish
- `src/lib/comms/metaErrorLabels.ts` — extend map with product-facing hints (fall-back suggestions)

---

## Verification

1. Reset the stuck campaign via the SQL above; watch cron tick — expect `status='sent'` within 1 min.
2. Curl `send-broadcast` with `Authorization: Bearer <SERVICE_KEY>` → 200 (was 401).
3. Curl same fn with a normal user JWT → still 200; with anon → 401.
4. UI check: failed card now shows "Unauthorized" reason, Edit + Retry are enabled.
5. Redesigned report drawer renders funnel + failure breakdown for a real campaign with mixed failures.
