# Incline Member App (Flutter) — README

Native iOS + Android member app for **Incline – Rise.Reflect.Repeat.** It talks to the **same backend** as the web member dashboard (`/member-dashboard`). There is no separate server: every rule (prices, booking windows, dues, gate access, approvals) is enforced by the database and backend functions. The app only displays data and calls approved actions.

> This supersedes the React Native plan in `docs/member-mobile-pathway.md`. Companion guides: `docs/flutter-referrals.md`, `docs/flutter-workout-videos.md`, `docs/browser-notifications.md`. Roadmap: `docs/flutter-member-app-roadmap.md`.

---

## 1. Golden rules (non-negotiable)

1. **Public (anon) key only.** Never ship the service-role key, provider tokens, Razorpay secret, Meta/MIPS credentials, or `x-internal-token`.
2. **Row-level security is the authority.** A member can read only their own rows. Never filter "client-side only" and assume privacy.
3. **Writes go through RPCs / backend functions**, never raw `insert/update/delete` on business tables (payments, memberships, bookings, credits, invoices, lockers, stock).
4. **Members never call staff RPCs** (`purchase_pt_package`, `record_payment`, `create_pos_sale_audited`, `cancel_invoice`, `freeze_membership`, `staff_*`, `wallet_adjust`, …). The server refuses them; the app must not even show those actions.
5. **Honour the RPC payload, not just the transport.** Many RPCs return HTTP 200 with `{ success: false, error: "..." }`. Treat that as a failure and show the message.
6. **No price quoting outside authenticated, member-scoped screens.** No prices on public/onboarding screens or in push text.
7. **Notifications** are created only by the backend (`dispatch-communication`). The app never sends WhatsApp/SMS/email itself. Lock-screen text must contain no personal, financial, or health data.
8. **Gate/hardware is read-only for members.** No door open, no biometric enrolment, no device sync. Biometric photos are staff-verified only.
9. **Dates are IST** (`Asia/Kolkata`). Booking days, "today", PT day, expiry and birthdays are all computed in IST.
10. **Sensitive documents** (ID, medical, agreement PDF) are fetched via short-lived signed URLs (≤ 60 s). Never cache them to public storage or logs.

---

## 2. Stack

| Concern | Choice |
| --- | --- |
| Framework | Flutter (stable), Dart 3, null-safety, `very_good_analysis` lints |
| Backend SDK | `supabase_flutter` (auth, PostgREST, RPC, storage, realtime, functions) |
| State / data | Riverpod 2 (`AsyncNotifier`) — mirrors TanStack Query: cache, invalidate after every mutation |
| Routing | `go_router` with auth + role redirect and deep links |
| Models | `freezed` + `json_serializable`; snake_case JSON ↔ camelCase Dart |
| Secure storage | `flutter_secure_storage` (session), `local_auth` (biometric unlock) |
| Payments | `razorpay_flutter`; order created + verified server-side |
| Video | `video_player` + `chewie`; YouTube/Vimeo via `url_launcher` |
| Push | `firebase_messaging` (Android/iOS) once the native push channel exists (see §8) |
| Charts / gauges | `fl_chart`, custom painters for score dials |
| Analytics | thin wrapper mirroring web `track(event, props)` names |
| Errors | `sentry_flutter` or forward to `log_error_event` RPC (see §9) |

Environment (`--dart-define`): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `APP_ENV`. Nothing else.

---

## 3. Project structure

```text
lib/
  app/            router, theme (tokens mirror web index.css), env
  core/           supabase client, IST date utils, money formatter (INR), error mapper, analytics
  features/
    auth/         login (email or +91 mobile), reset, set-password gate
    home/         membership card, dues, today, quick actions
    attendance/   my visits (consolidated per day)
    classes/      schedule + book/cancel
    recovery/     facility slots + book/cancel, benefit balances
    pt/           PT package, sessions, trainer
    workout/      plan viewer + video player
    diet/         diet plan
    progress/     measurements, photos, scan reports, 3D body
    invoices/     invoices + receipts + PDF
    store/        add-ons / products + Razorpay checkout
    referrals/    share link, history, reward claims
    requests/     freeze/other approval requests, feedback
    notifications/ in-app inbox, announcements, push opt-in
    profile/      profile, display photo, preferences, account deletion
  shared/         widgets (cards, badges, skeletons, empty/error states)
test/             unit (rules), widget, golden; integration_test/ for flows
```

One feature = `data/` (repository calling Supabase), `domain/` (models, pure rules), `presentation/` (screens, providers). Keep widgets < 200 lines.

---

## 4. Auth & session

- Login identifier: email **or** Indian mobile. Normalise phone to `+91XXXXXXXXXX` (strip leading 0), resolve via backend function `resolve-login-identifier`, then `signInWithPassword`.
- Password reset: email link deep-links to `incline://auth/reset` (also allow `https://theincline.in/reset-password` universal link).
- **`must_set_password`** on the profile forces the set-password screen before anything else; clear it only through the same flow the web uses.
- Role gate: after login read `user_roles`. If the user is not a member (staff/trainer/manager/owner), show "Use the staff web app" — this app is member-only.
- Branch: members have one home branch (`get_user_branch`). Do not offer branch switching.
- Biometric unlock only unlocks the locally stored session; it never replaces server auth.

---

## 5. Data access map (member scope)

Read with PostgREST (RLS restricts to self). Use explicit column lists and explicit FK hints — no auto-generated join aliases. 1:N joins come back as arrays.

| Screen | Read | Write (RPC / function only) |
| --- | --- | --- |
| Home | `members`, `memberships` (active/frozen/upcoming), `invoices` dues, `member_debt_locks` RPC | — |
| Attendance | `member_attendance` (group by IST day; raw rows are audit detail) | — (check-in is gate/desk only) |
| Classes | `class_sessions` (+ type, trainer, capacity), own `class_bookings` | `book_class`, `cancel_class_booking` |
| Recovery | `ensure_facility_slots` (read slots), own `benefit_bookings`, benefit balances | `book_facility_slot`, `cancel_facility_slot` |
| Add-on credits | own benefit credits/usage | `purchase_benefit_credits` via checkout |
| PT | own PT packages, sessions log, trainer profile | **Request** only → front-desk task (see §6) |
| Workout | `member_fitness_plans` (type workout) — exercises carry `video_url`, `video_file_path`, `form_tips` | completion state (local + existing logging) |
| Diet | `member_fitness_plans` (type diet) + legacy fallback | — |
| Progress | measurements, progress photos, `howbody_*` scan reports, `howbody_scan_quota` | upload own progress photo |
| Invoices | own `invoices`, `payments` (show **void ≠ refund** labels) | PDF via signed URL |
| Store | sellable products (`is_sellable`) + add-on plans for branch | `create-payment-order` → Razorpay → `verify-payment`; on dismiss `abandon_online_addon_invoice` |
| Membership purchase/renew | member-visible plans | `purchase_member_membership` (member path) |
| Coupons | — | `validate_coupon` (preview), redemption happens server-side in purchase |
| Referrals | own referrals + rewards | `request_referral_reward_claim` (see `flutter-referrals.md`) |
| Requests | own `approval_requests` | create request (freeze etc. → manager approves; app never calls `freeze_membership`) |
| Feedback | own `feedback` | insert own feedback; Google review link only via `request-google-review` flow |
| Notifications | own `notifications`, `announcements` (published) | mark read |

Confirm table/column names against the generated types in `src/integrations/supabase/types.ts` (source of truth) before coding a model.

---

## 6. Business workflows the app must respect

**Membership status.** Active → Expired after `end_date`; 7-day grace before Overdue; frozen pauses countdown. Display wording: "Starts tomorrow" (never "0 days"), "N days left", "Expired on …", "Frozen until …". Status is computed by the server — never recompute and write it.

**Dues & gate.** Only base-membership dues block the gate. PT/store/add-on dues are amber: show a "please clear at desk / pay now" banner, but the member still enters. Never claim the gate is blocked for non-membership dues.

**Classes.** Capacity, duplicates, cutoff and cancellation windows are server-side. After any book/cancel, refetch the session list.

**Recovery facilities.** Slots are generated server-side from opening hours + capacity. Advance-notice rules (e.g. Steam 12 h, Sauna/Ice Bath 24 h) and gender locks are enforced by `book_facility_slot`. Label times with spaced AM/PM ("7:30 PM"); if today only has evening slots, label it "Today (evening only)".

**PT.** Members cannot buy PT directly. "Choose a PT package" creates a high-priority front-desk task (same as web Renewal Concierge); the desk confirms trainer and sends a payment link. PT attendance is auto-marked by the backend from gate scans — the app just displays it.

**Payments.** Flow: server creates order → Razorpay sheet → server verifies signature → UI refetches. Never mark paid on the client. On sheet dismiss/failure call the abandon RPC. Amounts are INR; show GST lines exactly as the invoice returns them (some invoices are non-GST).

**Invoices.** Membership (BOS/INV) and store (POS-) series are separate — don't merge in UI. Internal notes are never shown. Salary-deduction settlements are not "payment received".

**Workout videos.** Play `video_url` inline; else build public URL from bucket `workout-videos` + `video_file_path`; external YouTube/Vimeo opens externally. No autoplay; always show `form_tips` as a text list. Details: `flutter-workout-videos.md`.

**Referrals.** Link `https://theincline.in/register?ref=<MEMBER_CODE>`. Tracking is always on; rewards may be off — hide claim buttons when rewards are disabled. Details: `flutter-referrals.md`.

**Do-not-contact & preferences.** Show and edit communication preferences; respect opt-outs (backend enforces).

**Pricing blackout.** Prices only inside signed-in member screens for that member's branch. Never in onboarding, share text, or push.

---

## 7. Feature flags

Read flags from `settings` (branch row first, then global `branch_id IS NULL`) and `referral_settings`. Fail **safe**: if a flag can't be read, hide the optional feature rather than exposing a half-working one. Examples: `exercise_video_library_enabled`, referral `rewards` enabled, gate tier mode (display only). Cache per session; refetch on resume.

---

## 8. Notifications

- In-app inbox = `notifications` table (+ realtime subscription on own rows).
- Web push already mirrors in-app notifications through an event queue. Native push (FCM/APNs) requires a backend addition: a device-token table + delivery worker behind `dispatch-communication`. Until that ships, the app uses in-app + realtime only. Token registration must be consent-gated and deleted on logout.
- Payload text is generic ("You have a new update from Incline"); details load after unlock.

---

## 9. Errors, loading, accessibility

- Every async screen: skeleton → data | empty state (icon + action) | error state (message + Retry). No blank screens.
- Map errors: network → "You're offline"; RLS/permission → "You don't have access"; RPC `success:false` → server message; unknown → generic + report.
- Report unexpected errors via `log_error_event` RPC (fingerprinted) — never include tokens or PII in payloads.
- Accessibility: 44×44 touch targets, semantic labels on icon buttons, text scaling to 200 % without clipping, contrast ≥ 4.5:1, status never by colour alone (badge + text), respect reduce-motion, captions/cues for videos, screen-reader order tested (TalkBack/VoiceOver).

---

## 10. Theming

Mirror web tokens: light = slate-blue primary + orange accent; dark = orange primary on navy. Define a `ThemeExtension` with semantic names (`card`, `muted`, `primary`, `accent`, `destructive`, `success`, `warning`). No hard-coded colours in widgets. Brand text on legal screens: "The Incline Life by Incline".

---

## 11. Security checklist (per PR)

- [ ] Only anon key; no secrets in repo, logs, or crash reports
- [ ] No direct writes to business tables; RPC `success:false` handled
- [ ] No staff RPCs reachable from UI
- [ ] Signed URLs (≤ 60 s) for private documents
- [ ] Push/lock-screen text contains no personal/financial/health data
- [ ] IST used for all date logic
- [ ] Deep links validated (allowlist routes, no open redirects)
- [ ] Logout clears session, cache, push token

---

## 12. Testing

- Unit tests for pure rules: membership day wording, IST "today", dues amber vs block, GST display, void vs refund label, referral link builder.
- Widget/golden tests for cards in light/dark and 200 % text.
- `integration_test` against a staging member account: login → book class → cancel → book recovery → view invoice PDF → add-on checkout (Razorpay test mode).
- RLS probe test: signed in as member A, querying member B's rows must return empty.

## 13. Release

Android: internal APK → Play internal testing (AAB). iOS: TestFlight → App Store. Store gates: privacy policy, in-app account deletion request, data-safety form, health-data permission text (if HealthKit/Health Connect used).
