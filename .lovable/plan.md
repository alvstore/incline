## Goal
Make `Lead Notification Rules` visually consistent with `Email Notifications` and `System Alerts` on the Notification Settings page. Right now it uses a different shell (heavy red bell, badge, gradient-feeling sub-sections, full-width red save bar, framed Admin Recipients table, emoji headers, template-link callout) which clashes with the clean two-card grid above it.

## Audit findings (visual diffs)

| Element | Email / System Alerts (target) | Lead Notification Rules (current) |
|---|---|---|
| Card | Plain `Card` with header (icon + title + small description) | Same card, but extra `1 active` badge + long descriptor |
| Sub-headers | None — flat list of toggle rows | Bold sub-headings `Lead Capture Alerts` / `Follow-up Reminders` with icons + helper text |
| Toggle rows | `Label` + muted `p` + `Switch` | Same pattern (already matches) |
| Spacing | `space-y-4` rows inside `CardContent` | `space-y-6` with nested `space-y-4` blocks (denser, inconsistent) |
| Admin Recipients | n/a | Bordered framed list inside same card |
| Save | Single `Save Preferences` button at page bottom (top-right, outline-ish) | Extra full-width red `Save Notification Settings` button under the card |
| Conversion Notifications | n/a | Emoji 🎯 placeholder block |
| Template link | n/a | Boxed callout with external-link icon |

## Plan

### 1. `LeadNotificationSettings.tsx` — restructure into 2 sibling cards that match the upper grid

Replace the single mega-card with **two cards rendered in the same `md:grid-cols-2` grid as Email / System Alerts**, using identical structure:

- **Card A — "Lead Alerts (to Lead)"**
  - Header: `UserCheck` icon + title `Lead Alerts` + description `Notify the lead when they're captured`
  - Rows: `SMS to Lead`, `WhatsApp to Lead`
- **Card B — "Team Alerts"**
  - Header: `Users` icon + title `Team Alerts` + description `Alert your team when new leads arrive`
  - Rows: `SMS to Admins`, `WhatsApp to Admins`, `SMS to Managers`, `WhatsApp to Managers`

Both use the exact same JSX pattern as the Email card: `<Card><CardHeader>… icon + CardTitle + CardDescription …</CardHeader><CardContent className="space-y-4"> … flex justify-between rows … </CardContent></Card>`.

Drop:
- The outer wrapper card with `1 active` badge.
- The full-width red `Save Notification Settings` button (rely on the page-level `Save Preferences` button — extend it to also persist lead rules).
- The 🎯 emoji "Conversion Notifications" placeholder (or keep as a compact muted line at the bottom of Card B without emoji, using `Target` lucide icon).
- The boxed `Settings → Templates` callout (move to a single muted line under Card B, no border, no bg).

### 2. `AdminRecipientsPanel` — make it its own matching card (full width, below the grid)

- Wrap in same `Card` shell with header: `ShieldCheck` icon + `CardTitle="Admin Recipients"` + `CardDescription="Choose which owners/admins receive lead alerts. Master toggles above must also be on."`
- Inside `CardContent`, drop the extra bordered `rounded-xl border divide-y` wrapper — just use `divide-y` rows directly so it visually breathes like the other cards.
- Keep per-user WhatsApp / SMS switches.

### 3. `NotificationSettings.tsx` — layout & save unification

- Render the two new lead cards inside the SAME `<div className="grid gap-6 md:grid-cols-2">` wrapper that holds Email + System Alerts (4 cards, 2x2 grid on md+).
- Render `AdminRecipientsPanel` (now a card) full-width below the grid.
- Wire the existing page-level `Save Preferences` button to also call the lead-rules save mutation in parallel (expose a `useSaveLeadRules()` hook from `LeadNotificationSettings.tsx`, or lift state up). Single save action, single toast.
- Remove the duplicate full-width red save button.

### 4. Styling tokens (match existing cards exactly)
- No custom shadows / rounded overrides — use whatever default `Card` ships with so all 4 cards look identical.
- Icons: `text-primary h-5 w-5` in card header (same as Email/System Alerts).
- Sub-section icons: removed; each card is now single-purpose.

## Files to touch
- `src/components/settings/LeadNotificationSettings.tsx` — split into `LeadAlertsCard`, `TeamAlertsCard`, `AdminRecipientsCard`; export a save hook; remove inline save button + framed wrappers.
- `src/components/settings/NotificationSettings.tsx` — place the 3 new cards in the layout; unify the save action.

## Out of scope
- No backend / schema / RLS changes.
- No copy changes beyond removing emoji and boxed callouts.
- No new toggles — same fields persist to `lead_notification_rules` and `lead_notification_admin_prefs`.
