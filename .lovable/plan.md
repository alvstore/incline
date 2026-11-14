# App Usage Insights: who uses the app, on which phone

## Goal
See which members, trainers and staff use the Incline app, whether on iPhone, Android or web, and how many are active. Show a small phone icon next to each person in Members (and staff/trainer lists).

## What exists today
- Push sign-ups are already stored per device (`web_push_subscriptions`, with a `kind` of web or fcm), but there's no reliable platform, app version or "last opened" time.
- Facility bookings already record `app_android` / `app_ios` as the source. That covers bookings only, not app usage.
- Nothing tells us who opened the app today.

## What we'll build

### 1. One device record per person per phone (backend)
New table `app_devices`, one row per user + install:
- user_id, branch_id, person type (member / trainer / staff / manager / admin)
- platform: ios | android | web_pwa | web_browser
- app: member_app | team_app | web
- app_version, os_version, device model (only the general model, e.g. "iPhone 15"; no device identifiers)
- first_seen_at, last_seen_at, push_enabled
- Unique on (user_id, install_id). Indexes on (branch_id, last_seen_at) and (user_id).
- RLS: people see only their own rows; managers see their branches (`managed_branch_ids()` inside `(SELECT …)`); owner/admin see all. Writes go only through an RPC.

### 2. Heartbeat RPC `register_app_device`
- Called on app open/resume by the web app, the Flutter member app and the Flutter team app (Flutter docs updated with the exact call).
- Throttled: updates last_seen at most every 2 minutes, and only while the app is on screen, so no write storms.
- Role and branch come from the server, never from the phone.

### 3. Summary RPC `app_usage_summary(branch, period)`
Branch-guarded and aggregated on the server (same pattern as referral analytics):
- Installed users by platform and by person type
- Daily / weekly / monthly active (DAU/WAU/MAU)
- Members with no app yet (adoption %)
- Daily active trend for the last 30 days

### 4. Screens
- **Members list:** small icon beside the name (Apple / Android / globe, greyed if inactive for 30+ days, none if never used). Tooltip: "Android · v1.4.2 · last opened 2h ago". New filter chip: App: iOS / Android / Web / Not installed.
- **Member profile drawer:** "App & devices" row listing each device, last opened and push status.
- **Staff & trainer lists:** same icon.
- **New "App Usage" card on the Analytics page:** count-up totals, platform split, 30-day active trend and an adoption bar. Uses the same motion as Approvals/Tasks (title rise, card stagger, count-up, reduced-motion safe), theme tokens only, and loading/empty/Retry states.
- **Action:** "Nudge non-app members" opens the existing CampaignWizard with that audience already selected (no new composer).

### 5. Feature flag
Per-branch setting `app_usage_insights` (off by default). The heartbeat records data even when the flag is off, so history builds up. The flag only controls whether the icons and the card are shown.

### 6. Privacy
No location, IP, IMEI or advertising IDs. Device rows are removed when a person is offboarded. The data shows only to roles with `can.viewAnalytics`.

## Technical details
- Migration: table, RLS, grants, two RPCs with `rpc_guard_applies()` and branch checks, plus a cleanup job for rows inactive for over a year (cron gated on pending work).
- Client: `src/lib/appUsage/platform.ts` (detects iOS/Android/PWA/browser; tested), `useAppHeartbeat` mounted once in the app shell, `useAppUsageSummary`, `AppPlatformIcon` component.
- Backfill: seed rows from existing `web_push_subscriptions` (fcm = phone app, platform unknown until the first heartbeat).
- Tests: platform detection, the 2-minute throttle, the 5-minute online window, and the activity window (an icon greys out after 30 days).
- Out of scope: per-screen analytics and app store download counts (those come from App Store Connect and Play Console).

## Decisions
- Access: managers see their own branches; owner/admin see all branches.
- "Active" covers both the phone app and the web version, with three levels that update on their own:
  - **Online now:** green dot, the app was used in the last 5 minutes (heartbeat every 2 minutes while the app is open and on screen).
  - **Active:** used in the last 30 days.
  - **Inactive:** greyed out after 30 days.
- Auto-refresh: the Members icons and the App Usage card update live without a page reload (a live update with a 60-second refresh as backup), and they pause while the browser tab is hidden.
