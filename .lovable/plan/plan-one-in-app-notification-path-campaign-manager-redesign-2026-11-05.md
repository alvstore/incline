# Plan: One "In-App" notification path + Campaign Manager redesign

## Part 1 — "In-App" means everywhere

Today "In-App" only writes the bell notification; browser pop-ups ride a separate queue and the Flutter app gets nothing on its home screen. After this change, choosing **In-App** delivers one message to:

- the bell list (web + Flutter, live via realtime),
- browser pop-ups (existing subscriptions),
- Flutter / Android home-screen pop-ups (new).

### How (single path, no new parallel files)
- Rename the existing browser-push pipeline into one **device push** pipeline: one device table holding both browser subscriptions and Flutter phone tokens (`kind = web | fcm`), one delivery queue, one worker. The current `web-push` function becomes the single sender and simply branches on device kind.
- Every bell notification (already created via `dispatchCommunication`) automatically queues delivery to all of that person's devices — browser and phone alike. No caller changes.
- Flutter registers its token through the same register/unregister action the browser uses (consent-gated, removed on logout). Lock-screen text stays generic (no personal, money or health details).
- Update the Flutter guide section 8 with the exact register call and payload, replacing the "not available yet" note.
- Announcements created from the composer also create bell notifications for their audience, so one "In-App" send = announcement board + bell + pop-ups.

### Needs from you
- Phone pop-ups require a **Firebase project service account** (from the Firebase console of the Flutter app). I will ask for it as a secret; until provided, phone tokens are stored and browser/bell keep working.

## Part 2 — Campaign Manager redesign

Current problem: two composers (Broadcast drawer + 2,200-line Campaign Wizard), duplicated audience pickers, unclear send/schedule state, approval-blocked WhatsApp silently waiting.

### New single drawer — "New message" (right-side Sheet, sm:max-w-xl)
```text
1 Audience   -> preset chips (All active members, Members+staff, Expiring, Leads, Custom segment) + live count
2 Channels   -> In-App (bell+browser+app), WhatsApp, SMS, Email — each shows readiness
                (template approved? DLT ready? email domain ok?) before you continue
3 Message    -> one body, per-channel preview tabs, template picker for WhatsApp/SMS,
                attachment, "Draft with AI"
4 Send       -> Send now / Schedule, final summary: recipients per channel, blocked
                channels with the reason, then one confirm button
```
- Campaign list page rebuilt as a bento grid: status cards (Draft, Scheduled, Waiting approval, Sending, Sent, Failed), table with clear status badges, row opens the detail drawer with live delivery progress (realtime, no polling) and failure breakdown.
- "Waiting for Meta approval" shown as its own state with a Send button that unlocks when approved.
- Broadcast drawer and Campaign Wizard merge into this one drawer; event/RSVP and promotion types become optional toggles in step 3, not a pre-step.
- Full loading, empty, error states; keyboard and 44px targets; tokens only.

### Verification
- Unit tests for audience counts per channel, channel readiness rules and the "In-App fans out to all devices" rule.
- Playwright (owner session, mocked sends): create campaign end-to-end, schedule, approval-blocked state, detail drawer progress; screenshots at 1440/768/375 and a design-critic pass.
- No real sends during testing.

## Technical details
- Migration: generalise `web_push_subscriptions` -> add `kind`, `fcm_token`; deliveries table unchanged in shape; trigger on `notifications` insert already enqueues — extend to all device kinds. Service-role-only grants kept.
- `web-push` v2: FCM HTTP v1 sender (OAuth from service-account secret `FCM_SERVICE_ACCOUNT_JSON`), invalid-token cleanup, same allowlist rules extended for FCM.
- Frontend: new `src/components/campaigns/MessageComposerSheet.tsx` with step subcomponents; `CampaignWizard.tsx` and `BroadcastDrawer.tsx` removed after callers switch; `CampaignsPanel.tsx` rebuilt; realtime subscription on `campaign_recipients` filtered by campaign id with cleanup.
- Existing scheduling (`createCampaign`, send-broadcast, approval-blocked rules) reused unchanged.
