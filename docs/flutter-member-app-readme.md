# Incline Member App (Flutter) — Complete Implementation Guide

Native iOS + Android member app for **Incline – Rise.Reflect.Repeat.** It talks to the **same backend** as the web member dashboard (`/member-dashboard`). There is no separate server: every rule (prices, booking windows, dues, gate access, approvals) is enforced by the database and backend functions. The app only displays data and calls approved actions.

> Single canonical Flutter guide: member policies, roadmap, general/PT training, diet/workout, PDF downloads, exercise videos, HOWBODY and referrals. Updated 29 October 2026 (IST). This replaces the separate Flutter guides and obsolete React Native pathway.
> **Status:** this repository implements the web app and shared backend, not a shipped Flutter app. Roadmap checkboxes describe work for the Flutter team; backend blockers are explicitly marked.

## Contents

- [1–13. Foundations, policies and member workflows](#1-golden-rules-non-negotiable)
- [14. General/PT training, daily plans, validity and PDFs](#14-general-programs-personal-training-workout-and-diet-plans)
- [15. Exercise videos](#15-exercise-video-integration)
- [16. HOWBODY scanner integration](#16-howbody-scanner-integration)
- [17. Referral tracking and rewards](#17-referral-tracking-and-rewards)
- [18. Implementation roadmap](#18-implementation-roadmap)
- [19. Manual progress updates and private photos](#19-manual-progress-updates-and-private-photos)

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
9. **Dates are IST** (`Asia/Kolkata`). Booking days, "today", PT day, expiry and birthdays are must use IST calendar dates; existing plan-viewer UTC/device-local discrepancies are noted in §14.3.
10. **Sensitive documents** (ID, medical, agreement PDF) are fetched via short-lived signed URLs (≤ 60 s). Never cache them to public storage or logs.

---

## 2. Stack

| Concern | Choice |
| --- | --- |
| Framework | Flutter (stable), Dart 3, null-safety, `very_good_analysis` lints |
| Backend SDK | `supabase_flutter` (auth, PostgREST, RPC, storage, realtime, functions) |
| State / data | Riverpod (compatible stable release) (`AsyncNotifier`) — mirrors TanStack Query: cache, invalidate after every mutation |
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
| Recovery | `ensure_facility_slots` (read slots), own `benefit_bookings`, benefit balances | `book_facility_slot` with `p_source` `app_android`/`app_ios`, `cancel_facility_slot` |
| Add-on credits | own benefit credits/usage | `purchase_benefit_credits` via checkout |
| PT | own PT packages, sessions log, trainer profile | **Request** only → front-desk task (see §6) |
| Workout | `member_fitness_plans` (type workout) — exercises carry `video_url`, `video_file_path`, `form_tips` | local tick-offs; optional progress service is separate (§14.7) |
| Diet | `member_fitness_plans` (type diet) + legacy fallback | — |
| Progress | own `member_measurements` (includes photo references), `howbody_*` reports/quota/sessions | `record_member_measurement`; private own-photo uploads (§19); scanner link via `howbody-bind-user` (§16) |
| Invoices | own `invoices`, `payments` (show **void ≠ refund** labels) | stored PDF via signed URL; generated PDFs need shared-service parity (§14.8) |
| Store | sellable products (`is_sellable`) + add-on plans for branch | `create-payment-order` → Razorpay → `verify-payment`; on dismiss `abandon_online_addon_invoice` |
| Membership purchase/renew | member-visible plans | `purchase_member_membership` (member path) |
| Coupons | — | `validate_coupon` (preview), redemption happens server-side in purchase |
| Referrals | own referrals + rewards | `request_referral_reward_claim` (see §17) |
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

**Booking source (Steam / Sauna / Ice Bath).** Every facility booking records where it came from, and staff see it as a badge on All Bookings and the slot drawer ("Android app", "iPhone app", "Web portal", "WhatsApp", "Front desk", "Concierge", "System"). The app must pass its platform:

```dart
await supabase.rpc('book_facility_slot', params: {
  'p_slot_id': slotId,
  'p_member_id': myMemberId,
  'p_membership_id': activeMembershipId,
  'p_source': Platform.isIOS ? 'app_ios' : 'app_android',
});
```

For a signed-in member the server accepts only `app_android` or `app_ios`; any other value (or none) is stored as `member_portal`. Members cannot send `admin`, `concierge`, `whatsapp_ai` or `system`, nor `p_staff_id` / `p_force`. Class bookings do not take a source yet.

**HOWBODY scanner link.** Scanning the scanner's QR (in-app or via App/Universal Link for `/scan-login`) opens a link sheet with scan type and a required height in **cm or ft/in** — always sent to `howbody-bind-user` as centimetres (100–250). Poll the session (no Realtime) until `completed`. Full contract: §16.

**Who is online / Android vs iOS.** The web joins the Realtime presence channel `presence:app` and pings `touch_presence()` every 60 s. The app must do the same while in the foreground and add `platform` (`android` | `ios`) and `app_version` to its presence payload. `touch_presence()` takes no arguments today, so the platform lives only in the live presence payload; storing it server-side (for history on Audit Logs) is a pending backend addition — see roadmap Phase 7.

**PT.** Members cannot buy PT directly. "Choose a PT package" creates a high-priority front-desk task (same as web Renewal Concierge); the desk confirms trainer and sends a payment link. PT attendance is auto-marked by the backend from gate scans — the app just displays it.

**Payments.** Flow: server creates order → Razorpay sheet → server verifies signature → UI refetches. Never mark paid on the client. On sheet dismiss/failure call the abandon RPC. Amounts are INR; show GST lines exactly as the invoice returns them (some invoices are non-GST).

**Invoices.** Membership (BOS/INV) and store (POS-) series are separate — don't merge in UI. Internal notes are never shown. Salary-deduction settlements are not "payment received".

**Workout videos.** Play `video_url` inline; else build public URL from bucket `workout-videos` + `video_file_path`; external YouTube/Vimeo opens externally. No autoplay; always show `form_tips` as a text list. Details: §15.

**Referrals.** Link `https://theincline.in/register?ref=<MEMBER_CODE>`. Tracking defaults on but has a separate branch toggle; rewards may be off — hide claim buttons when rewards are disabled. Do not promise retroactive rewards for joins while payouts were paused. Details: §17.

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


---

## 14. General programs, personal training, workout and diet plans

### 14.1 Scope and member experience

Both general-program members and members who opted for personal training use **the same** `member_fitness_plans` assignment table and the same Workout/Diet viewers. PT is an additional coaching/package/session workflow, not a different plan database. A paid PT package does not itself prove a plan has been assigned. Do not hide an assigned workout or diet solely because the member has no PT package.

| Member context | Plans | Extra screens/actions | Do not infer |
| --- | --- | --- | --- |
| General program (no PT) | Assigned general/common or individual workout and diet | Today / Day view / Full week, validity, demo videos, Download, request a new plan | No automatic assignment or PT entitlement merely from membership |
| Personal training | Assigned individual or common workout and diet, same row contract | Own PT package, assigned trainer, remaining sessions, expiry, session history and approved booking flow | No plan creation, package sale, commission data or manual PT attendance |
| No plan assigned | Honest empty state and request-plan action | Show existing trainer only if available | Never fabricate a routine or copy another member's plan |

`is_common` marks a common assignment; it is **not** a member role or proof of whether they bought PT. `created_by` identifies the assigning profile, not necessarily the member's current PT trainer. Resolve trainer/package information through the existing member/PT queries; show separate attribution where needed. Trainer transfers must not rewrite old assignment attribution.

### 14.2 How staff push a plan to a member

```text
Staff/trainer creates a structured template or uploads a PDF
    → Assign Plan drawer selects member(s), type, dates, common/custom,
      optional workout offsets/rotation and communication channels
    → member_fitness_plans stores a member-specific assignment snapshot
    → backend dispatcher delivers selected in-app / WhatsApp / email notices
    → Flutter refetches own assignments on screen open, resume or refresh
    → member reads daily content or opens/downloads the stored PDF
```

Source: `src/components/fitness/AssignPlanDrawer.tsx`, `src/services/fitnessService.ts`. The existing staff service inserts assignment rows under staff authorization. This is **not a member API**; Flutter members never copy that insert or call supersede/assign operations. Assignment succeeds independently of best-effort PDF delivery; a failed WhatsApp/email must not make the saved plan disappear. Native push is still a roadmap item, not required for a plan to become readable.

General templates are audience-targeted through guarded RPC `match_common_plans(p_member_id, p_type)`. Its ranked results are suggestions (`template_id`, name, goal, difficulty, duration, targeting, `match_score`), not assignments. Do not auto-assign or fetch all templates in Flutter. Staff choose and assign. PT trainers create plans for authorized assigned clients; members only view/request.

### 14.3 Assignment model and read query

Read `member_fitness_plans` with the signed-in session, own `member_id`, and home `branch_id`. Separate requests/providers for `plan_type = workout` and `diet`. Explicit selected fields:

```text
id, member_id, branch_id, plan_type, plan_name, description, plan_data,
valid_from, valid_until, created_at, created_by, template_id,
is_common, is_custom, source_kind, pdf_url, pdf_filename, pdf_size_bytes,
schedule_offset_days, rotation_interval_days, rotation_seed
```

Check generated types and current grants before implementing; some newer fields may be typed locally in web services. `plan_data` is JSON, not a JSON string to double-encode. `source_kind` is `structured` or `pdf`. Optional fields must default safely without dropping content/media.

Web parity query (documented behavior, not a new endpoint):

```dart
final assignments = await supabase
    .from('member_fitness_plans')
    .select('id,member_id,branch_id,plan_type,plan_name,description,plan_data,'
        'valid_from,valid_until,created_at,created_by,template_id,is_common,'
        'is_custom,source_kind,pdf_url,pdf_filename,pdf_size_bytes,'
        'schedule_offset_days,rotation_interval_days,rotation_seed')
    .eq('member_id', myMemberId)
    .eq('branch_id', homeBranchId)
    .eq('plan_type', planType)
    .or('valid_until.is.null,valid_until.gte.$todayDateOnly')
    .order('created_at', ascending: false)
    .limit(1);
```

`todayDateOnly` should be a date-only IST value in the Flutter date utility. **Existing discrepancy:** web pages currently derive the query date using UTC `toISOString()` while day highlighting uses device-local weekday. Near midnight this can disagree with IST. This documentation change does not fix the web implementation; add web/Flutter parity tests before release.

Web currently selects **one latest unexpired row per type**; it does not filter `valid_from`, and the staff drawer can keep multiple assignments. Consequently a future row can be returned before its start, and “keep both” does not mean current member pages list both. Flutter should label a returned future row “Starts …”, not “Active today”. A multiple-plan/history design or prioritizing current over upcoming requires a coordinated contract change; do not silently introduce a different selection algorithm.

Diet fallback: when no unified row exists, web reads newest `diet_plans` with `member_id`, `is_active=true`, mapping `name → plan_name`, `start_date → valid_from`, `end_date → valid_until`, `plan_data`, `calories_target`, and trainer profile. This is legacy read-only support; do not write new diet assignments there. Never treat a permission/network error as “no plan” or activate fallback merely to conceal a failure.

### 14.4 Day-wise workout parsing and schedule

Supported JSON shapes:

```json
{
  "weeks": [{
    "week": 1,
    "days": [{
      "day": "Monday", "focus": "Upper body",
      "warmup": "Trainer-authored warmup", "cooldown": "Trainer-authored cooldown",
      "exercises": [{"name": "Bench Press", "sets": 3, "reps": "8-10", "rest": "60s", "notes": "Controlled tempo"}]
    }]
  }]
}
```

Alternatively `{ "days": [ ... ] }`. These are illustrative payloads, not prescribed routines. Preserve authored exercise order, name, sets (number/string), reps, rest/rest_seconds, equipment, notes, weight, warmup/cooldown and optional media. Missing values show “—”, not invented exercise prescriptions.

Port `src/components/member/workout/planNormalize.ts` and `src/lib/fitness/planRotation.ts`:

1. Resolve `rotation.variants[]` first, if present. Valid variants have non-empty `days`.
2. Normalize offset `((trunc(value) % 7) + 7) % 7`.
3. Rotation variant = `(floor(max(0, elapsedDays)/interval) + seed) modulo variantCount` for interval > 0; otherwise seed modulo count. Anchor elapsed whole calendar days at `valid_from`; missing start gives elapsed 0.
4. Shift **complete day blocks**. Explicit Sunday plans rotate across all 7 days. Plans without authored Sunday rotate Monday–Saturday modulo 6; never shift Monday content into Sunday.
5. Normalize week rows or flat day rows. Label fallback: `day`, then `name`, then `title`, then `Session`. Match weekday names/abbreviations; nonweekday “Day 1” is not necessarily Monday.
6. Sort by weekday only when every day in the group maps to one. Week groups remain in authored order. A rest day has no exercises or rest/off wording.
7. Web Today chooses the first matching weekday across normalized rows, not an automatically calculated training week. If none matches, it previews the first/selected session with a notice. Do not claim a generic day label or later week is today's prescribed workout.

UI: plan name + attribution + validity + Download; Today / Day view / Full week; day/week labels; rest state; exercise rows; optional Watch demo. Estimated duration is an estimate, not measured attendance. Ticking an exercise is **not** a gate visit or PT session and must never decrement package sessions.

### 14.5 Day-wise diet parsing

Port `normalizeDietPlan` in `src/lib/planNormalizer.ts`, not the workout parser. Support:

- `days[].slots[]`: each day has meal slots, items and totals.
- Top-level `slots[]`: a single **Daily template**, reused for viewing rather than invented seven different diets.
- Legacy/AI `meals[]`: day rows with named meal keys (breakfast/lunch/dinner, pre/post-workout and custom keys). Preserve custom meals, not just a fixed breakfast/lunch/dinner list.

Preferred structured example:

```json
{
  "dailyCalories": 2000,
  "days": [{
    "day": "Monday",
    "slots": [{
      "name": "Breakfast", "time": "08:00",
      "items": [{"food": "Trainer-selected food", "quantity": "Saved portion", "calories": 300, "protein": 15, "carbs": 40, "fats": 9}],
      "recipe_link": null, "prep_video_url": null
    }]
  }],
  "notes": "Member-facing nutrition guidance"
}
```

Example values are not a member prescription. Normalize food/name aliases, quantity/serving, calories, protein, carbs, fats/fat, fiber, and string food items. Use provided slot totals where available, otherwise sum saved item numbers; day totals sum slots. Missing nutrient data is not nutritional advice. Preserve optional recipe/prep fields. Show Today / Day view / Full week with meals, quantities, time, macros and member-facing trainer notes. Match weekdays; if no mapped day, say that you are showing the first day/template. Do not generate new meals or change assigned plan JSON on the client.

### 14.6 Validity, replacement and offline behavior

| Saved dates | Display / handling |
| --- | --- |
| Future `valid_from` | Upcoming / Starts tomorrow or Starts on [date]; preview explicitly labelled |
| Start reached and end not passed | Assigned/current within its date window |
| Null `valid_until` | Ongoing; do not invent expiry |
| End earlier than today | Excluded by current web active-query convention |
| No dates | Date not specified; do not borrow membership/package dates |

Plan validity is independent from membership and PT-package expiry. Never infer plan expiry from remaining PT sessions or extend validity client-side. Superseded/revoked plans use a past `valid_until` convention; there is no separate status filter in the member pages. Recheck on resume and date rollover; clear per-member cached plans on logout. An offline cached plan is marked “Last synced …”; it is not proof of current entitlement. Downloaded PDFs remain static snapshots and are not retroactively changed by new assignments.

### 14.7 Completion: implemented versus optional

The current `/my-workout` viewer keeps daily tick-offs locally in browser storage keyed by plan and date. It does **not** call the completion service. Current diet day viewer does not wire a server meal-tick action. Flutter parity can use member/plan/date-scoped local state and must not advertise cross-device sync.

Separate service `src/services/memberPlanProgressService.ts` supports RLS-protected member progress tables, if a future app feature is enabled and tested:

| Table | Scope / uniqueness | Meaning |
| --- | --- | --- |
| `member_workout_completions` | member_id, plan_source, plan_id, week_number, day_label, exercise_index | Exercise progress; **no date key**, so not a fresh daily attendance ledger |
| `member_meal_completions` | member_id, plan_source, plan_id, meal_date, meal_index | Dated meal progress |
| `member_meal_swaps` | member_id, plan_source, plan_id, meal_index plus saved swap payload | Separate member swap record, not modification of assigned plan |

`plan_source` is `member_fitness_plans` for workouts; diets may also be `diet_plans` for legacy rows. Member-only progress upserts/deletes are an explicitly verified RLS exception to the business-write prohibition, not permission to alter assignments/packages. Validate own rows and denial for another member before enabling. Missing tables/read failures must not become fake success. Workout completions lacking a date cannot support per-day syncing without a reviewed backend change. Keep swap/logging features out of initial parity unless specifically approved.

### 14.8 Download: the same PDF on web and Flutter

**Existing stored PDF path (ready contract):** if `pdf_url` exists, web `PlanDownloadButton` retrieves that attachment, re-signs it and downloads the existing bytes using `pdf_filename`. Flutter must download **that same object**, never reconstruct a PDF from its pages. `source_kind=pdf` is a PDF-only plan; show viewer + download, not fabricated day-wise content.

Private fitness PDFs are in `attachments`. Derive the path as in `src/lib/documents/signAttachment.ts`: raw path (strip optional `attachments/` prefix) or extract path after `/attachments/` from stored object/signed URLs and decode it. Use the member session and `storage.from('attachments').createSignedUrl(path, 600)` on tap. The current web plan TTL is 10 minutes; ID/medical/agreement files retain their separate ≤60-second policy. Never use `getPublicUrl` for private plan PDFs or persist expired signed query strings.

Download handling: HTTPS only, validate expected host/object, check successful response and PDF content, save to private app cache, and offer system Save/Share via a user action. Show progress, cancellation, completion and Retry; sanitize the filename. Do not log links, contents or member identifiers. Re-sign once if expired; never blindly loop. Storage authorization failures are real errors, not justification to use an old public-style URL.

**Structured-plan path (current limitation):** without `pdf_url`, web generates on demand via `downloadPlanPdf` / `buildPlanPdf` in `src/utils/pdfBlob.ts`. These are browser TypeScript functions, **not** deployed HTTP/RPC endpoints. Staff sharing generates/uploads its own PDF via `src/utils/sendPlanToMember.ts`; that upload is not automatically persisted back onto the member assignment. Therefore there is no existing universal “get the same structured-plan PDF” API, and the app cannot fetch a local browser blob URL.

**Required follow-up for identical files:** build a member-authorized canonical plan-PDF endpoint/worker in the web project, store one private member-scoped assignment/version artifact, and have both web and Flutter download it. Generate using saved member metadata, assignment dates, branch, schedule offset and rotation snapshot; persist durable object path/reference rather than a temporary signed URL. Make generation idempotent per assignment/input hash, audit generation, and invalidate when assignment content changes. Do not use shared template URLs for personalized files or invent an endpoint name now. Verify the generated day schedule matches the viewer; current member download call does not pass all offset/rotation settings.

Until this follow-up exists: stored PDFs download identically; structured plans remain readable in Flutter but identical native PDF downloading is blocked. A temporary authenticated web download screen can provide the web-rendered output but is not a native/shared-artifact implementation. A Dart PDF renderer would be a separate document, not guaranteed identical; do not silently substitute it.

### 14.9 Training acceptance tests and source map

- General member with no PT: assigned workout and diet readable, day navigation correct, stored PDF downloadable; no PT package assumed.
- PT member: same viewer, own trainer/package/history read correctly; workout tick does not mark PT attendance or change sessions.
- No assignment: empty/request state. Future assignment: Upcoming, not Active. End-date boundary at IST midnight; null dates; superseded rows; newest vs multiple rows.
- Flat/weekly workout, unmapped labels, Sunday rest preservation, offsets, seed/rotation, optional/missing videos and malformed JSON.
- Diet daily template, normalized days, legacy meals with custom keys, totals, no invented macros.
- PDF-only plan, fresh signing of expired URL, denied other-member file, offline/retry; checksum equality for stored PDF on web and app.
- Before shared-PDF release: identical checksum and content on web/Flutter, correct member/branch/dates/shift, no cross-member or stale-version cache leak.

Sources: `src/pages/MyWorkout.tsx`, `src/pages/MyDiet.tsx`, `src/components/fitness/AssignPlanDrawer.tsx`, `src/services/fitnessService.ts`, `src/types/fitnessPlan.ts`, `src/components/member/workout/WorkoutPlanViewer.tsx`, `src/components/member/workout/planNormalize.ts`, `src/lib/fitness/planRotation.ts`, `src/components/member/diet/DietPlanViewer.tsx`, `src/lib/planNormalizer.ts`, `src/services/memberPlanProgressService.ts`, `src/components/fitness/PlanDownloadButton.tsx`, `src/lib/documents/signAttachment.ts`, `src/utils/pdfBlob.ts`, `src/utils/sendPlanToMember.ts`.


---

## 15. Exercise video integration

How the Flutter member app should read and play exercise demo videos, matching
the web dashboard pattern exactly.

### 15.1. Data contract

Workout plans live in `member_fitness_plans.plan_data` (JSONB). Each exercise
inside `plan_data.weeks[].days[].exercises[]` (or flat `plan_data.days[].exercises[]`)
may carry these optional fields — all existing plans without them stay valid:

```json
{
  "name": "Barbell Bench Press",
  "sets": 4,
  "reps": "8-10",
  "rest": "60s",
  "equipment": "Barbell",
  "form_tips": ["Retract shoulder blades", "Feet flat on the floor"],
  "video_url": "https://…/bench-press.mp4",
  "video_file_path": "exercises/bench-press-1719.mp4"
}
```

| Field | Type | Meaning |
|---|---|---|
| `video_url` | string? | Directly playable URL (https .mp4/.webm, YouTube, Vimeo). **Play this.** |
| `video_file_path` | string? | Path inside the public `workout-videos` storage bucket. Fallback when `video_url` is absent: resolve via `Supabase.instance.client.storage.from('workout-videos').getPublicUrl(path)`. |
| `form_tips` | string[] or string | Form cues shown under the player as the text alternative. |
| `poster_url` | string? | Small WebP preview (≈5–10 KB). Show it instantly in the list; only download the MP4 when the member taps play. |
| `equipment` | string? | Incline machine name (e.g. `SUPER LAT PULLDOWN CIRCULAR`). Display verbatim — never rename. |
| `video_source` / `video_ref` | string? | `library` + library slug when the backend auto-attached the media. Informational only. |
| `video_auto` | `"off"`? | Trainer removed the video on purpose; the backend will not auto-attach one again. |

Rule: **if `video_url == null && video_file_path == null`, render no video UI** —
never show an empty player.

**Auto-attach:** when a workout template or member plan is saved, a backend
trigger matches each exercise *name* against the exercise library and fills
`video_url` + `poster_url` if they are empty. Machine names, sets, reps and any
trainer-chosen video are never touched. Flutter needs no extra API call — read
the plan as usual. Recommended player: `cached_network_image` for `poster_url`,
`video_player` (muted, looping, `playsInline`) for `video_url` on tap.

### 15.2. Dart model

```dart
class ExerciseEntry {
  final String name;
  final int sets;
  final String reps;
  final String? videoUrl;
  final String? videoFilePath;
  final List<String> formTips;

  ExerciseEntry.fromJson(Map<String, dynamic> j)
      : name = j['name'] ?? 'Exercise',
        sets = (j['sets'] is num) ? (j['sets'] as num).toInt() : 0,
        reps = '${j['reps'] ?? ''}',
        videoUrl = j['video_url'] as String?,
        videoFilePath = j['video_file_path'] as String?,
        formTips = j['form_tips'] is List
            ? (j['form_tips'] as List).map((e) => '$e').toList()
            : (j['form_tips'] is String && (j['form_tips'] as String).isNotEmpty)
                ? [j['form_tips'] as String]
                : const [];

  String? resolvePlayableUrl() {
    if (videoUrl != null && videoUrl!.isNotEmpty) return videoUrl;
    if (videoFilePath != null && videoFilePath!.isNotEmpty) {
      return Supabase.instance.client.storage
          .from('workout-videos')
          .getPublicUrl(videoFilePath!);
    }
    return null;
  }
}
```

### 15.3. Playback (video_player / chewie)

- Package: `video_player` (+ `chewie` for controls). Direct media URLs may be MP4/WebM over HTTPS; validate platform codec support. Provider page URLs need the external-link flow below.
- Initialise lazily: create the `VideoPlayerController.networkUrl(Uri.parse(url))`
  only when the member taps **Watch demo**, dispose on sheet close. Never
  auto-play, never preload all videos of a day (data usage).
- YouTube/Vimeo URLs: open in an in-app webview or external browser instead of
  the native player.
- Show `formTips` as a bulleted list under the player — it is the accessible
  text alternative and works offline.

```dart
Future<void> _openDemo(ExerciseEntry ex) async {
  final url = ex.resolvePlayableUrl();
  if (url == null) return;
  final controller = VideoPlayerController.networkUrl(Uri.parse(url));
  await controller.initialize();
  // present in a modal bottom sheet; dispose in onClose
}
```

### 15.4. UX parity with the web dashboard

- Exercise row shows a small **Watch demo** chip (play icon) only when a video exists.
- Tapping opens a bottom sheet: 16:9 player on top, exercise name, muscle/equipment
  caption, form cues below.
- Respect reduced-motion / data-saver: no autoplay, no looping GIF-style previews.
- Cache nothing sensitive — these are public training videos; HTTP caching headers
  from the CDN are enough.

### 15.5. Trainer-side attaching (web only, for reference)

Trainers attach videos in the web workout builder via three sources:
**Library** (curated `exercise_video_library` table, searched through the
`exercise-videos` edge function), **URL**, or **Upload** (to the `workout-videos`
bucket). Flutter only consumes the resulting `plan_data` JSON — no extra API.


---

## 16. HOWBODY scanner integration

How the member app links a member to a HOWBODY body-composition or posture scanner, matching the web page at `https://theincline.in/scan-login`.

### 16.1. What the scanner QR contains

The scanner screen shows a QR that opens:

```text
https://theincline.in/scan-login?equipmentNo=<DEVICE_NO>&scanId=<SCAN_ID>&kind=body|posture
```

`kind` may also arrive as `scanType`. Missing/unknown → `body`. Older devices may use the path `/howbody-login` — treat it the same.

### 16.2. Flow

```text
Scanner QR ──► in-app scanner (mobile_scanner) or OS camera via App/Universal Link
          ──► parse equipmentNo, scanId, kind
          ──► "Link to scanner" sheet: device name, scan type toggle, height (cm ⇄ ft/in)
          ──► POST howbody-bind-user
          ──► "Step on the scanner" state, poll session until completed
          ──► open the new report in Progress → Scan Reports
```

### 16.3. Deep links

- Android App Links + iOS Universal Links for host `theincline.in`, exact paths `/scan-login` and `/howbody-login`; allow the query parameters but reject unrelated routes.
- If the app is not installed, the OS opens the web page — which already works. No fallback code needed.
- If the member is signed out, keep the parsed params, sign in, then resume the sheet.

### 16.4. Parsing

```dart
ScanLink? parseScanLink(String raw) {
  final uri = Uri.tryParse(raw);
  if (uri == null || uri.scheme != 'https' || uri.userInfo.isNotEmpty ||
      uri.host.replaceFirst('www.', '') != 'theincline.in') return null;
  if (!const ['/scan-login', '/howbody-login'].contains(uri.path)) return null;
  final equipmentNo = uri.queryParameters['equipmentNo']?.trim() ?? '';
  final scanId = uri.queryParameters['scanId']?.trim() ?? '';
  if (equipmentNo.isEmpty || scanId.isEmpty) return null; // ask to re-scan
  final k = (uri.queryParameters['kind'] ?? uri.queryParameters['scanType'] ?? '').toLowerCase();
  return ScanLink(equipmentNo, scanId, k == 'posture' ? 'posture' : 'body');
}
```

Reject any other host — never call the backend for a QR from another domain.

### 16.5. Device name

Show the friendly device name from the device inventory (same lookup the web uses, `howbody_devices` by `equipment_no`); fall back to the raw `equipmentNo`.

### 16.6. Height (required)

The scanner cannot calculate BMI or body fat without height.

- Prefill from the member's latest `member_measurements.height_cm` (newest `recorded_at`, non-null). Show "Taken from the last record — correct it if it has changed."
- Unit toggle **cm | ft / in**. Remember the member's choice locally.
- Conversion (same as web `src/lib/scans/height.ts`):
  - `cm = round((feet × 12 + inches) × 2.54, 1 decimal)` — 5 ft 9 in → 175.3 cm
  - `totalInches = round(cm / 2.54)`, `feet = totalInches ~/ 12`, `inches = totalInches % 12` — 168 cm → 5 ft 6 in
- Show the other unit as a live hint ("≈ 5 ft 6 in" / "≈ 175.3 cm").
- Valid range **100–250 cm** (≈ 3 ft 3 in – 8 ft 2 in). Feet 3–8, inches 0–11.
- **Always send centimetres** (`heightCm`, number). Never send feet/inches.

### 16.7. Bind call

```dart
final res = await supabase.functions.invoke('howbody-bind-user', body: {
  'equipmentNo': link.equipmentNo,
  'scanId': link.scanId,
  'memberId': myMemberId,      // server checks it belongs to the signed-in user
  'kind': selectedKind,        // 'body' | 'posture'
  'heightCm': heightCm,        // 100.0–250.0
});
final data = res.data as Map<String, dynamic>?;
if (data?['ok'] != true) showError(data?['error'] ?? 'Could not link to the scanner.');
```

Server rules (do not duplicate on the client, just show the message verbatim):
- Scanner must be authorised (`howbody_device_authorized`), member must be active.
- Scan entitlement is checked per kind (`howbody_scan_quota`) — body credits never pay for posture and vice versa. The error says which credit is missing.
- A scan already bound to someone else is refused.

### 16.8. Waiting for the result

`howbody_scan_sessions` is **not** on Realtime. Poll instead:

```dart
// every 5 s, stop after 10 min or when the screen closes
final row = await supabase
  .from('howbody_scan_sessions')
  .select('status, completed_at, kind')
  .eq('scan_id', link.scanId)
  .eq('member_id', myMemberId)
  .maybeSingle();
if (row?['status'] == 'completed') openLatestReport(kind: row!['kind']);
```

Statuses: `pending` → `bound` → `completed`. Members can read only their own session (RLS). The member also gets the normal "scan report ready" notification, so the inbox is a second path.

Reports: body → `howbody_body_reports`, posture → `howbody_posture_reports`, newest for this member.

### 16.9. UX & accessibility

- Camera permission: explain why before asking; if denied, offer "Open settings" or suggest scanning with the phone's own camera (the App/Universal Link opens the app).
- Torch toggle, 44×44 targets, haptic tick on successful parse.
- Unit toggle is a radio group with labels "Centimetres" / "Feet and inches"; inputs labelled "Height in centimetres", "Feet", "Inches".
- Never show prices or credit costs on this screen.

### 16.10. Feature flag

There is no server flag for this yet. Ship the in-app scanner button behind a client remote-config switch (default **on**). Turning it off only hides the button — deep links still fall back to the working web page. If a server flag is needed later, add it to `settings` in the web project first and read it the standard way (README §7).

### 16.11. Tests

- Parser: valid URL, `scanType` alias, `/howbody-login`, foreign host rejected, missing scanId rejected.
- Height: 5'9" → 175.3, 168 → 5'6", 182.6 → 6'0", 99.9/250.1 invalid.
- Bind: error message shown verbatim; height always sent in cm.

**Correlation and rollout safeguards:** also scope to the scanner/equipment where supported; do not open an unrelated newest report when a historical scan completes. Match report/session identifiers supported by current schema, or present a report list for selection. Stop polling on close/background, timeout or terminal errors; resume safely. App/Universal Links still require Android assetlinks and iOS association files/entitlements — they are not deployed by this documentation. Remote-config scanner switch is proposed, not an existing server flag.


---

## 17. Referral tracking and rewards

Tracking defaults on per branch (`referral_settings.tracking_enabled`, default true), separately from rewards. Respect `get_referral_enabled`; do not override an explicit tracking-off setting.
Reward payouts are a separate switch (`referral_settings.is_active`). The app must never
create rewards or wallet credit itself — the server does it.

### 17.1. Member's share link (Refer & Earn screen)
- Code = the member's `member_code` (e.g. `INC-26-0015`).
- Link = `https://theincline.in/register?ref=<url-encoded code>`.
- Buttons: Copy link, Share (WhatsApp intent with message + link). 44px targets, labelled.

### 17.2. Deep link into sign-up
- Register `theincline.in/register` as an App Link / Universal Link.
- Read `ref` from the URI, uppercase + trim, max 32 chars, keep in memory for the sign-up flow.

### 17.3. Sign-up screen referral field
1. Call RPC `get_referral_enabled(p_branch_id)` → boolean. Hide the field when false.
2. Optional "Referral code" field, prefilled from the link, with a **Validate** button.
3. On Validate call RPC `validate_referral_code(p_code, p_branch_id, p_phone, p_email)`.
   Response: `{ valid: true, referrer_display: "Mohit G." }` or `{ valid: false, reason: "invalid" | "rate_limited" | "disabled" }`.
4. Show result as icon + text (not colour only) and announce it (Semantics liveRegion).
5. Sign-up must never be blocked by a bad/empty code. Existing registration OTP, on-site eligibility and consent requirements still apply; a referral link is not permission to bypass them.

### 17.4. Final registration
Send `referral_code` in the body of the existing `register-member` function call. The server
re-checks the code (never trust the client result), sets `members.referred_by`, and creates one
`referrals` row (`lifecycle_status = 'joined'`).

### 17.5. Rewards (member side)
- List: `referrals` where `referrer_member_id = me`; `referral_rewards` where `member_id = me`.
- Call RPC `get_referral_rewards_enabled(p_branch_id)`. When false, show "Rewards paused" and hide Claim.
- Claim → RPC `request_referral_reward_claim(p_reward_id)`. It only creates a manager approval;
  wallet credit appears after approval. Show "Awaiting approval" when `claim_status = 'pending_approval'`.

### Don'ts
- No direct inserts into `referrals`, `referral_rewards`, or wallet tables.
- No reward amounts calculated in the app.


---

## 18. Implementation roadmap

Use the preceding contracts in this guide. Each phase ends with a demo on real Android + iOS devices against staging and must pass the README §11 security checklist.

### Phase 0 — Foundations (week 1)
- [ ] Repo, flavours (dev/staging/prod), `--dart-define` env, CI (analyze, test, build)
- [ ] Supabase client, Riverpod, go_router, theme tokens (light/dark), IST + INR utils
- [ ] Shared widgets: card, status badge, skeleton, empty, error, 44px buttons
- [ ] Error mapper (`success:false`, RLS, offline) + `log_error_event` reporter
- [ ] Analytics wrapper using web event names
- **Exit:** blank app signs in to staging, theme switches, CI green

### Phase 1 — Auth & Home (weeks 2–3)
- [ ] Login by email or +91 mobile (`resolve-login-identifier`), reset deep link, `must_set_password` gate
- [ ] Member-only role gate, biometric unlock, logout clears everything
- [ ] Home: membership card (correct day wording), dues banner (block vs amber), today's classes/bookings
- [ ] Attendance history consolidated per IST day
- **Exit:** RLS probe test passes; wording unit tests pass

### Phase 2 — Bookings (weeks 4–5)
- [ ] Classes: schedule, `book_class`, `cancel_class_booking`, live capacity
- [ ] Recovery: `ensure_facility_slots`, `book_facility_slot`, `cancel_facility_slot`, benefit balances, evening-only/AM-PM labels
- [ ] Recovery bookings pass `p_source: app_android | app_ios` (backend ready; staff see "Android app" / "iPhone app" badges)
- [ ] Server rule messages surfaced verbatim (advance notice, gender lock, limits)
- **Exit:** integration test book → cancel for both

### Phase 3 — Training (weeks 6–7)
- [ ] Workout plan viewer with video player + form tips (§15)
- [ ] General/common and PT member plans share the assignment contract (§14); no PT requirement for viewing assigned plans
- [ ] Diet plan viewer with Today / Day / Full week, daily-template fallback, saved macros and validity
- [ ] Workout schedule offsets, Sunday handling and rotation parity; future/expired/no-plan states
- [ ] Stored plan-PDF download using fresh private signing; byte-equality check against web
- [ ] Backend prerequisite for structured plans: canonical authorized PDF artifact/service shared by web and Flutter (§14.8); not built yet
- [ ] Web/Flutter plan date boundaries and multi-week/assignment selection agreement before release
- [ ] PT: package, sessions, trainer; "Request PT" creates front-desk task
- [ ] Progress: manual measurements through `record_member_measurement`, private photo upload/signing, read-back and ownership tests (§19); scan reports with score dials and scan quota
- [ ] HOWBODY QR link: in-app scanner + App/Universal Links for `/scan-login`, link sheet with cm ⇄ ft/in height (sent as cm), `howbody-bind-user`, poll session → open report (§16)
- **Exit:** video plays inline/external; PT request appears on desk task list; a real scan links from the app and its report opens

### Phase 4 — Money (weeks 8–9)
- [ ] Invoices + receipts list, void/refund labels; verify document-download contract (not every generated web PDF has a saved URL)
- [ ] Store / add-ons: `create-payment-order` → Razorpay → `verify-payment`; abandon on dismiss
- [ ] Membership renew/purchase via `purchase_member_membership`; coupon preview via `validate_coupon`
- **Exit:** Razorpay test-mode purchase updates invoice + credits after server verification only

### Phase 5 — Engagement (weeks 10–11)
- [ ] Referrals: share link, history, reward claim (hidden when rewards off) (§17)
- [ ] Requests (freeze etc. → approval), feedback
- [ ] Notifications inbox + realtime, announcements with attachments
- [ ] Profile, display photo, communication preferences, account deletion request
- **Exit:** feature flags fail safe; approval request visible to manager on web

### Phase 6 — Native push (needs backend work, week 12)
- [ ] Backend: device-token table (RLS self), consent, delivery worker behind `dispatch-communication`
- [ ] App: FCM/APNs registration after opt-in, token removal on logout, generic payload text
- **Blocker:** backend change must be built in the web project first

### Phase 7 — Hardening & release (weeks 13–14)
- [ ] Presence: join `presence:app` with `platform` + `app_version`, ping `touch_presence()` every 60 s in foreground
- [ ] Backend (web project, before launch): store last platform/app version server-side and show an Android / iPhone / Web chip on Audit Logs and the online pill
- [ ] Accessibility pass (TalkBack/VoiceOver, 200 % text, contrast, reduce-motion)
- [ ] Performance: cold start < 2.5 s, list virtualisation, image caching
- [ ] Security review against README §11; dependency audit
- [ ] Store assets, privacy policy, data-safety form; Play internal → production, TestFlight → App Store

### Out of scope for members
Staff POS, PT selling, payment recording, freezes by direct RPC, gate/door control, biometric enrolment, payroll, any price display on public screens.

### Known backend/deployment dependencies

- Native FCM/APNs delivery and device-token lifecycle are not implemented.
- Durable Android/iOS/app-version presence and Audit Logs chips need server-side storage/UI.
- Identical PDFs for structured plans require shared artifact generation; stored PDFs already have a download contract.
- App/Universal Link association files and approved auth redirects must be configured/tested.
- Exercise catalog is currently cues-only unless staff attach actual videos; ExerciseDB integration needs licensing/API credentials.

These are release gates, not completed functionality. Verify hosted auth/redirect settings, current RPC signatures, RLS and actual member flows in staging before enabling each action. Documentation consolidation changes no live data, permissions, billing or notifications.

---

## 19. Manual progress updates and private photos

### 19.1 Member workflow and boundaries

Both general-program and PT members can **record a new measurement snapshot** for themselves, with optional progress photos. No PT purchase is required. Web parity: Progress → Measurements → Record measurements, with height prefilled from the latest record and an explicit action copying earlier numbers into **blank** fields only. Clearly identify copied values before saving; never silently invent measurements.

Flutter should use a labelled scrollable sheet, numeric fields with units, optional photo picker, Cancel and Save. A new row is created on Save; there is no member-facing edit-existing or delete-history workflow to copy. Do not implement direct inserts/updates/deletes on `member_measurements` or call staff actions. Recording progress never marks attendance, decrements PT sessions or changes HOWBODY reports, gate photos or plan validity.

### 19.2 Read model

Photo paths live **on `member_measurements`**, not in a separate progress-photo table. Read under the member session, filter to own member UUID, order by `recorded_at` descending, and paginate history. This table has no `branch_id` field; do not add a nonexistent branch filter. Own-member authorization enforces scope.

```dart
final rows = await supabase.from('member_measurements')
    .select('id,member_id,recorded_at,recorded_by,weight_kg,height_cm,'
        'body_fat_percentage,waist_cm,chest_cm,hips_cm,notes,photos,'
        'front_progress_photo_path,side_progress_photo_path')
    .eq('member_id', myMemberId)
    .order('recorded_at', ascending: false)
    .range(0, 19);
```

Select additional measurement columns when presenting full detail. Server-stamped metadata: `id`, `member_id`, `recorded_by`, `created_at`, `updated_at`. Web manual entry omits `recorded_at`, so the RPC defaults it to server save time. The SQL also accepts an optional timestamp in `p_payload.recorded_at`, but no historical-date control is exposed by the current member drawer; leave it out for initial Flutter parity. Optional numbers remain null, not zero. BMI is a display calculation `weight_kg / (height_cm / 100)^2` only when both valid values exist; never fabricate body-fat or posture scores from it.

### 19.3 Field contract and validation

Numeric payloads are JSON numbers or null, never unit strings. UI uses 0.1 increments; server validates and rounds to two decimals. Port `src/lib/measurements/measurementValidation.ts` and check generated types/current server definitions before release:

| Field(s) | Unit | Inclusive range |
| --- | --- | --- |
| `weight_kg` | kg | 25–350 |
| `height_cm` | cm | 100–250 |
| `body_fat_percentage` | % | 2–70 |
| `shoulder_cm` | cm | 25–90 |
| `chest_cm` | cm | 40–220 |
| `abdomen_cm`, `waist_cm` | cm | 35–220 |
| `hips_cm` | cm | 45–240 |
| `neck_cm` | cm | 20–60 |
| `torso_length_cm` | cm | 30–90 |
| `biceps_left_cm`, `biceps_right_cm` | cm | 12–80 |
| `forearm_left_cm`, `forearm_right_cm` | cm | 12–55 |
| `wrist_left_cm`, `wrist_right_cm` | cm | 8–30 |
| `thighs_left_cm`, `thighs_right_cm` | cm | 20–120 |
| `calves_cm` | cm | 18–70 |
| `ankle_left_cm`, `ankle_right_cm` | cm | 10–40 |
| `inseam_cm` | cm | 40–130 |

Other optional fields: `gender_presentation` (`male`, `female`, `other`, or null), `posture_type`, `body_shape_profile`, `notes`, `photos` (array of owned object-path strings), `front_progress_photo_path`, `side_progress_photo_path`. Do not relabel self-entered posture text as a clinical/scanner assessment. Trim blank text to null, reject invalid/non-finite numbers, and require at least one numeric measurement or photo; notes alone are insufficient. Height may offer cm/ft-in using §16 conversion, but always save cm. Unit selection is local preference, not a database column.

### 19.4 Save RPC and confirmation

```dart
// Values below are illustrative, not a real member update.
final savedId = await supabase.rpc('record_member_measurement', params: {
  'p_member_id': myMemberId,
  'p_payload': {
    'weight_kg': 67.7,
    'height_cm': 168.0,
    'body_fat_percentage': null,
    'notes': null,
    'photos': uploadedPaths, // private member-photos object paths, not URLs
  },
});
// Re-read own history and confirm the returned row before showing saved state.
```

The function validates caller access through `can_write_member_measurements` and returns the new row's **UUID**, not `{success:true}`. A member may target only the member record linked to their authenticated user; never trust a UUID merely because it came from a screen. Broader staff/trainer permissions do not grant a member app those capabilities. Transport/database errors are failures. On success invalidate history, latest summary, photo gallery and height-prefill caches, then re-read the saved row by returned UUID and own member ID.

Disable Save while uploading/saving. This RPC creates a row per call and has no documented client idempotency key: do not automatically retry an ambiguous timeout. Preserve the draft, refresh history to reconcile, and ask before another submission if the outcome remains unknown. Offline drafts must be explicitly unsaved, protected per account and cleared on logout; do not silently replay health-data writes.

### 19.5 Private photo lifecycle

1. Ask for camera/gallery permission only on member action. Accept supported image content (web uses image MIME types) and reject files above **10 MB** before upload; server bucket limits also apply. Preserve an accessible non-camera measurement path.
2. Authenticated upload to private bucket **`member-photos`**, `upsert:false`, path `{myMemberId}/drafts/{sessionUUID}/{timestamp}-{uuid}.{ext}`. Use a unique generated name, not a member name or user-controlled path. Never upload into another member's prefix or biometric bucket.
3. Save successful object paths in RPC `photos`. Do not save signed/public URLs, local device paths or temporary preview URLs. Never assume the RPC verifies object existence: confirm upload succeeded first.
4. On explicit Cancel/remove, delete only this unsaved draft's objects. After confirmed Save, keep referenced objects — even though their path contains `drafts`. Closing after Save must not clean them up.
5. On RPC failure keep the draft for correction or explicit cancellation. On an unknown outcome reconcile before deleting uploads; otherwise a successful row could reference deleted files. Cleanup is best-effort, not an atomic upload+RPC transaction; abandoned objects after a crash remain a known limitation, not permission for broad bucket deletion.
6. Display/download with the member session using `storage.from('member-photos').createSignedUrl(path, 60)`, matching `src/lib/measurements/photoSigning.ts`. Refresh expired links on demand, never `getPublicUrl`. Health photos and signed links stay out of logs, analytics, public caches and notification payloads. Clear private photo cache on logout.

Storage authorization and row authorization are separate checks. The database validates member-prefixed paths, and current storage policies enforce authorized access. Before rollout, verify the hosted bucket remains private and that member A cannot read/upload/sign/delete member B's object. Historical public-bucket migrations are not the current intended contract.

### 19.6 Manual versus scanner data

HOWBODY webhook triggers can insert measurement snapshots alongside the separate full scan reports (§16). Manual Save adds another snapshot; it does **not** overwrite the scanner report or merge it with past rows. History is chronological by `recorded_at`.

Do not assume the newest snapshot contains every measurement; null means not recorded. Keep latest-snapshot date and full scan-report date distinct. If retrieving last non-null values across history for hints, preserve each value's date and do not present a synthesized row as one new scan. Avoid duplicate summary/measurement cards; summary first, then Measurements / Photos / 3D Body / Scan Reports tabs.

Do not manufacture a scanner/manual source flag: verify current schema and trigger attribution before adding badges. `recorded_by` alone is not a reliable scanner origin label. No measurement PDF endpoint is established here; existing scanner PDFs and plan PDF contracts are separate. This guide adds documentation, not a native implementation, new API or live member update.

### 19.7 Flutter acceptance tests and source map

- General and PT member: save one valid snapshot via RPC, read returned row through own history, refreshed summary/height hint; no plan/package/gate changes.
- Blank/notes-only draft refused; exact min/max accepted and out-of-range/non-finite rejected; kg/cm/% and ft-in conversion preserved; server errors shown.
- Another member UUID/path is refused; no other-member rows/photos visible or signable.
- Photo-only snapshot, oversize rejection, denied permissions, upload failure, Save failure, Cancel cleanup; confirmed saved files survive sheet close.
- Double-tap blocked; ambiguous timeout reconciled without duplicate write; offline/retry state is honest.
- Manual row alongside scanner row, partial/null snapshots and date labels; no fabricated scores or duplicate sections.
- Signed photo expiry/refetch, logout cache clearing, screen-reader field labels and 200% text scaling.

Sources: `src/pages/MyProgress.tsx`, `src/components/members/RecordMeasurementDrawer.tsx`, `src/components/members/MeasurementProgressView.tsx`, `src/lib/measurements/measurementValidation.ts`, `src/lib/measurements/photoSigning.ts`, `src/lib/measurements/types.ts`; server measurement/access functions and private-bucket policies in `supabase/migrations/20260422103636_e7056631-82f5-4d11-8694-f812f61451b9.sql`, with later hardening under `drizzle/`. Source audit verified the web contract; authenticated native save/read-back and hosted storage probes remain release tests for the Flutter team.
