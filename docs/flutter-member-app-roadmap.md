# Incline Member App (Flutter) — Roadmap

Read `docs/flutter-member-app-readme.md` first. Each phase ends with a demo on real Android + iOS devices against staging and must pass the README §11 security checklist.

## Phase 0 — Foundations (week 1)
- [ ] Repo, flavours (dev/staging/prod), `--dart-define` env, CI (analyze, test, build)
- [ ] Supabase client, Riverpod, go_router, theme tokens (light/dark), IST + INR utils
- [ ] Shared widgets: card, status badge, skeleton, empty, error, 44px buttons
- [ ] Error mapper (`success:false`, RLS, offline) + `log_error_event` reporter
- [ ] Analytics wrapper using web event names
- **Exit:** blank app signs in to staging, theme switches, CI green

## Phase 1 — Auth & Home (weeks 2–3)
- [ ] Login by email or +91 mobile (`resolve-login-identifier`), reset deep link, `must_set_password` gate
- [ ] Member-only role gate, biometric unlock, logout clears everything
- [ ] Home: membership card (correct day wording), dues banner (block vs amber), today's classes/bookings
- [ ] Attendance history consolidated per IST day
- **Exit:** RLS probe test passes; wording unit tests pass

## Phase 2 — Bookings (weeks 4–5)
- [ ] Classes: schedule, `book_class`, `cancel_class_booking`, live capacity
- [ ] Recovery: `ensure_facility_slots`, `book_facility_slot`, `cancel_facility_slot`, benefit balances, evening-only/AM-PM labels
- [ ] Server rule messages surfaced verbatim (advance notice, gender lock, limits)
- **Exit:** integration test book → cancel for both

## Phase 3 — Training (weeks 6–7)
- [ ] Workout plan viewer with video player + form tips (`flutter-workout-videos.md`)
- [ ] Diet plan viewer
- [ ] PT: package, sessions, trainer; "Request PT" creates front-desk task
- [ ] Progress: measurements, photos upload, scan reports with score dials, scan quota
- **Exit:** video plays inline/external; PT request appears on desk task list

## Phase 4 — Money (weeks 8–9)
- [ ] Invoices + receipts list, void/refund labels, PDF via signed URL
- [ ] Store / add-ons: `create-payment-order` → Razorpay → `verify-payment`; abandon on dismiss
- [ ] Membership renew/purchase via `purchase_member_membership`; coupon preview via `validate_coupon`
- **Exit:** Razorpay test-mode purchase updates invoice + credits after server verification only

## Phase 5 — Engagement (weeks 10–11)
- [ ] Referrals: share link, history, reward claim (hidden when rewards off) (`flutter-referrals.md`)
- [ ] Requests (freeze etc. → approval), feedback
- [ ] Notifications inbox + realtime, announcements with attachments
- [ ] Profile, display photo, communication preferences, account deletion request
- **Exit:** feature flags fail safe; approval request visible to manager on web

## Phase 6 — Native push (needs backend work, week 12)
- [ ] Backend: device-token table (RLS self), consent, delivery worker behind `dispatch-communication`
- [ ] App: FCM/APNs registration after opt-in, token removal on logout, generic payload text
- **Blocker:** backend change must be built in the web project first

## Phase 7 — Hardening & release (weeks 13–14)
- [ ] Accessibility pass (TalkBack/VoiceOver, 200 % text, contrast, reduce-motion)
- [ ] Performance: cold start < 2.5 s, list virtualisation, image caching
- [ ] Security review against README §11; dependency audit
- [ ] Store assets, privacy policy, data-safety form; Play internal → production, TestFlight → App Store

## Out of scope for members
Staff POS, PT selling, payment recording, freezes by direct RPC, gate/door control, biometric enrolment, payroll, any price display on public screens.
