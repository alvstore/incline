# Browser notifications

Members opt in from Home or Profile → Communication Preferences. On iPhone/iPad, first add the website to Home Screen and open that icon; iOS/iPadOS 16.4+ is required. Android and desktop require a supported browser and notification permission.

No per-message Web Push provider charge applies; normal Cloud database, execution and network usage still applies. Delivery is best-effort and depends on browser/OS settings. Existing WhatsApp, SMS, RCS and email settings are unchanged; push does not replace those channels automatically.

## Coverage

New rows in the existing notification inbox are mirrored to opted-in devices. Existing notification generators and canonical `dispatchCommunication` create those rows. Workflows that currently send only WhatsApp/SMS/email need an explicit in-app notification before they can also produce browser push. Historical notifications are not backfilled.

The service worker is push-only and does not cache pages, personal data, medical documents or payment information. Lock-screen content is generic; full detail remains behind sign-in. Topic preferences, quiet hours (suppressed rather than delayed), Do-Not-Contact and subscription branch are checked at delivery. Signing keys and the queue are server-only. Subscriptions are removed on explicit sign-out or expired provider responses.

The worker claims bounded batches of 30 with concurrency 5, immediate bounded retries and event-driven follow-up batches. There is no recurring polling job. Failed delivery remains recorded in `web_push_deliveries`; provider acceptance is not proof the OS displayed an alert.

## Team WhatsApp Inbox

Existing workspace: **Chats** (`/whatsapp-chat`). Select a specific branch before sending. It supports WhatsApp, Instagram and Messenger, All/Mine/Unread/Human filters, assignments, internal notes and human/AI handoff. Staff need their existing role and branch access. No WhatsApp number or coexistence settings were changed in this rollout. WhatsApp template/provider fees still apply independently of browser push.

## Verification

- Live member page and blocked-permission state rendered without build errors.
- Authenticated public-key configuration succeeded; non-service delivery requests were rejected.
- Team Inbox opened with live conversations under owner access; member access redirected away.
- Real device opt-in and OS notification display are not yet verified: sandbox Chromium reports notification permission denied. Use Enable notifications → Send test on a supported phone to complete delivery verification.
- Database migration introduced no remaining linter findings; 323 unrelated pre-existing database findings remain outside this rollout.