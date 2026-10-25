# Invoice PDF privacy and addresses (25 Oct 2026)
- [ ] Remove internal notes from customer PDFs, restore existing invoice terms, include saved customer/branch addresses, and test actual downloads without changing transactions.

# PT partial-payment closeout (25 Oct 2026)
- [x] Build guarded, branch-controlled closeout preserving cash receipts, GST rules and existing payroll; record waived dues and externally confirmed commission separately.
- [x] Closed all three approved BOS PT invoices through the owner screen; retained ₹35,000 cash and recorded ₹17,500 externally shared commission, waived ₹98,500. Verified receipts, zero balances, cancelled packages, actor/time audit, concurrent idempotency, anonymous denial and cancellation protection. Sixteen regression tests pass; build OK; invoice PDF downloaded.

# Selected System Health errors (25 Oct 2026)
- [x] Gate startup already recovered (live imports/attendance successful); retained valid SDK CORS. Fixed canonical Meta refusal logging, detailed failed-message reasons and duplicate frontend logging; weak-password feedback stays out of error monitoring. Ten regression tests pass; build OK.
- [x] PT transfer uses latest final-session boundary, prevents invalid submission and fails closed on loading errors. Authenticated owner check: Simpy's earliest date 24 Oct, 1 Oct blocked, 25 Oct allowed; no transfer saved.
- [x] Automation response deadline raised to 90s with body coverage; aborts remain unknown with no immediate retry. Nurture starts at most five AI candidates and no new work after 60s; contact/cadence safeguards unchanged.
- [ ] Confirm the next scheduled runs after this change finish for nurture/retention/upgrade/reminders; blocked on their scheduled execution. No live outreach test or historical error deletion performed.

# Store invoice identity and sharing (24 Oct 2026)
- [x] Corrected staff buyer identity and payroll-settlement labels on invoice list and sharing; authenticated owner check verified Gyaneshwar's existing invoice, saved phone/email and enabled WhatsApp action. Nine tests pass. No message sent or recovery records changed.

# Audit Insights (22 Oct 2026)
- [x] Audited current error groups; repaired registration's unauthorized self-enrollment attempt and false success, stopped expected Instagram SLA warning noise, closed historical repaired questionnaire/sidebar and expected auth validation entries. Cleared resolved error logs through the owner's screen; transaction audit history preserved.
- [x] Added per-group Resolve, Clear resolved confirmation, open/history/activity filters, error fallbacks, corrected occurrence totals/date window and trend rendering. Signed-in owner verification: no failed requests or console errors, no open actionable errors; two noise-classification tests pass.
- [ ] Verify the next scheduled nurture run completes: deployed indexed due-candidate selection and stopped immediate duplicate dispatch on ambiguous response timeout; old timeout telemetry deliberately remains. Requires next scheduled worker outcome, not a live outreach test.

# External standby 1:1 copy (22 Oct 2026)
- [x] Standby file storage rejected every upload (storage service v1.74 vs newer storage tables); restored its expected index, upload/replace/download/delete verified.
- [x] Pause all standby scheduled jobs (they ran attendance/membership jobs on the copy) and mirror live jobs as paused definitions (18 paused, 16 live jobs mirrored paused).
- [x] Resumable copy engine: structure, sign-in users, all rows (chunk fingerprints, deletes included), counters, buckets + files (large files resumable).
- [x] Nightly 02:30 IST copy, wakes instantly when queued, chains itself while working, hourly watchdog restarts a stalled run; Copy now / Check match on the owner card with live progress.
- [x] Three full copies + independent parity check: structure/FK/index/trigger/policy/realtime fingerprints identical; 262 tables matched at copy time (incl. sign-in users); later diffs only rows changed after the copy; large files byte-identical (MD5); owner/non-owner access verified.
- [x] Repeat copies only re-send changed chunks (3rd full copy: under 2 minutes); copy's own progress log excluded from mirroring.
- [ ] Owner action: raise the standby storage upload size limit (3 files of 72–193 MB refused with 413); the next copy adds them automatically.
- [ ] Owner action: standby database connection has no encryption (TLS) — enable on the standby server; upgrade standby storage service to v1.80.2+ then drop the compat index.
- [ ] Definer-guard CI check flags older migrations 0078/0081/0087 and 0096 generate_invoice_number_for; audit repair's new service-only candidate helper passes. Applied migration history left unchanged; review remaining guard metadata/permissions separately.

# Mohit account cleanup (22 Oct 2026)
- [x] Removed three cancelled invoices, three assigned diet/workout plans and four old requests; verified only INV-INC-26-0039 remains with both completed payments (₹20,000 total), account retained and cleanup archived in audit history.

# Auth & registration (21 Oct 2026)
- [x] Animated Rise/Reflect/Repeat card stack on sign-in.
- [x] Registration only inside the club (200 m of Sector 14) or for signed-in desk staff; elsewhere shows "please visit the club".

# Gate dispatch repair (21 Oct 2026)
- [x] Removed the historical-delivery veto on changed photos/access, preserved targeted dispatch throttles, deployed v3.8.0; six policy tests pass.
- [x] Re-sent Sweety Arora to both gates at 12:26 IST; new issue records 12865/12866 both report authorisation and photo success. Overall pushStatus remains 1 (pushing), so final completion is not confirmed.
- [ ] Confirm physical recognition and final delivery; blocked on Sweety's next gate scan/device completion acknowledgement, not another speculative push.

# Store, stock & POS (20 Oct 2026)
- [x] Restore stock deduction on every POS/member-store sale (lost in an earlier checkout rewrite); return stock when a sale's invoice is cancelled. Verified in a rolled-back live test: 10→7, over-sell and unsellable items refused, cancel restores.
- [x] Stock adjustment drawer (add / remove / set exact count, reason, batch) with full stock history; past batch receipts backfilled into history.
- [x] Activation: standard Incline photo option, price-above-₹0 rule, clear POS on/off switch; margin shows — at ₹0; row actions always visible; delete asks first.
- [x] Owner browser check: products, stock, ready-to-sell, history, POS load without errors; a stock count saved successfully. A real paid sale through the screen was not rung up (would create a real invoice).
- [ ] Stock counts on the shelf were never reduced by the 2 earlier POS sales (7 Oct); staff should do one physical count with Set count.

# Current requests (19 Oct 2026)
- [ ] Repair expired video attachments in saved WhatsApp messages.
- [ ] Connect Google Search Console fresh in the new workspace; previous workspace connections do not apply.

# Sign-in redesign (19 Oct 2026)
- [x] Replace animated login artwork with reference-inspired folder; isolate inputs, remove obsolete files/imports. Browser checks passed for fill/focus, validation, password visibility, folder selection/Escape, reset link, four widths and dark/reduced motion; no runtime errors. Native macOS Chrome autofill dropout needs confirmation on the affected device.

# Annual upgrade Analytics (15 Oct 2026)
- [ ] Missing recent live records (18 Oct): owner Members page and direct live reads agree on 214 members; no member/auth registration today; Shrishti INC-26-0200 still has only her original monthly membership and ₹5,000 paid invoice. Published app, preview and tools use the same live backend; Cloud is healthy and attendance is still arriving. BLOCKED: no evidence of today's registration/upgrade in current records or available request logs; requires Lovable support to investigate lifecycle/restore history and the member's registration confirmation before any recovery or financial re-entry. No restoration or replacement transactions performed.
- [x] Member photos (10/10 loaded), highlighted current plans and elapsed drawer timelines verified in both themes, phone layout, pagination and Escape/focus return; 27 tests pass.
- [x] Live Meta checks: both annual templates APPROVED/MARKETING, rejection NONE; two message failures are 131049 pacing, explained in drawer. No template resubmission or automatic resend; expiry safeguards preserved.
- [x] Compact upgrade card beside membership charts; three-member preview, independent paginated side panel and focus return verified with real branch data at four widths in both themes; 24 upgrade tests pass.
- [x] Move annual upgrades from Dashboard to Analytics with paginated IST deadline timelines and verified message states.
- [x] Harden Day 7/12 catch-up, expiry and outcome tracking; preserve dispatcher preferences and payment flow.
- [x] Run business tests, authenticated Analytics checks and four-width design critique.
- [ ] Promotional email blocked: requires a dedicated external marketing service; never use app-email infrastructure.

# Voice automation repair & workspace (9 Oct 2026)
- [x] Enforce shared 3-call / 2-follow-up limits and seven-day spacing at atomic reservation; decline/relocation outcomes stop calls, including historical cases. Bind renewal case before provider dial; retain automation pause switches.
- [x] Verify Kiran is blocked without dialing: guarded live policy returns outreach_relocated with no next attempt; 11 policy/status tests pass, signed-in page shows limits and stopped decline labels.
- [ ] Restore automatic retention, repair renewal escalation selection and preserve pause/window/DND/cap safeguards.
- [ ] Clarify automation health, last actual call, next check and member last-call/next-attempt timing in themed bento cards.
- [ ] Run rule tests and verify authenticated voice page and non-dialing worker checks.

# PT workspace redesign (9 Oct 2026)
- [x] Combine Today/Upcoming into one session timeline, move Automatic Attendance after Clients, and refresh summary cards using existing theme with reduced-motion-aware animation.
- [x] Verify owner tab navigation, real session loading and narrow-screen layout; fix roster action clipping; timeline tests pass and automatic build is clean. Package and payroll logic unchanged.
- [ ] Separate business-rule phase: monthly programs currently remain duration-based; introducing a 26-session allowance requires matching server deduction, purchase and payroll tests, not just a UI default. No existing packages converted.
- [ ] Trainer-account verification and analytics instrumentation remain pending.

# Database performance & storage (2026-10-08 audit follow-up)
- [x] access_logs: gate camera captures no longer stored (`_shared/mipsPayload.ts#stripScanMedia` in mips-webhook-receiver v2.10.0 + reconcile-mips-pass-records v2.7.0, deployed; live scan payload 176 KB → 0.5 KB)
- [x] access_logs: `prune_access_log_media()` safety net in `maintain_log_sizes()` (migration 0019); all 45k historic rows backfilled + VACUUM FULL — database 3.06 GB → 396 MB, access_logs 2.6 GB → 59 MB, zero rows deleted
- [x] RLS hot paths hoisted (0019): member_attendance 30-day count 1326 ms → 89 ms; new `managed_branch_ids()` helper
- [x] Unread-chat badge partial index `idx_wcs_unread_branch` (attendance day/branch index already existed)
- [x] Cron pollers gated on real pending work (0020): whatsapp/rcs/campaign-stats/razorpay/automation-brain — verified "0 rows" (no function spin-up) on idle ticks and "1 row" + successful runs when work exists
- [x] Verified live as owner: dashboard, attendance, devices (Fleet + Live Feed), WhatsApp pages load with 0 failed calls; gates still logging scans
- [ ] Follow-up (optional): `maintain_log_sizes` still has no row-retention for access_logs older than ~1 year — decide a retention window with the owner before adding one

# Security & Lint Audit — phased fixes (2026-10-08)
Source doc: /mnt/documents/Incline_Security_Lint_Audit.md

- [x] Phase 1a — lock 51 internal-only privileged functions to background jobs (migration 0010)
- [x] Phase 1b — in-function permission checks for the 26 app-called functions (migrations 0011–0013; verified live as member + owner: 47 checks)
- [x] Phase 2 — read-function leaks closed (migration 0014): 15 locked to background, 6 helpers self-or-staff, audit reports owner/admin; 5 visitor-open functions rechecked (body-scan token fn locked; share links never issued)
- [x] Phase 3 — remaining signed-in-callable privileged functions reviewed (migrations 0015–0016: 27 locked to background, guards on purchase/lifecycle/punch/consent/scan-quota/presence/measurement helpers); default-deny for new functions is migration 0018
- [x] Phase 4 — pg_trgm + vector moved to `extensions` (0017; pg_net not relocatable — its objects already live in `net`); new functions closed by default (0018); CI step `scripts/check-definer-guards.ts` fails unprotected SECURITY DEFINER functions
- [x] Phase 3 follow-ups — `match_common_plans` re-tested live as Mohit: own member 200, two other members 403 (earlier alarm was a false positive); `resolve_mips_person_alias` callers (mips-webhook-receiver, reconcile-mips-pass-records) both use service-role clients
- [x] Member PT add-on: server is staff-only by design (`_purchase_pt_package_impl` → "Not authorized") but the drawer toasted "activated" — member mode now files a front-desk task (same path as Renewal Concierge), trainer optional; staff mode honours `success:false`
- [x] Phase 5 — 38 lint warnings → 0 (previewAuthStorage.ts excluded from lint: platform-generated)
- [x] Phase 6 — verified live after Phase 4/5: member (14 pages, 0 failed calls), front-desk manager (15 pages, 10/10 RPC allow/deny), visitor (6 public pages); audit doc updated as `Incline_Security_Lint_Audit_v2.md`
- [x] Dual-role fix — manager+trainer accounts saw "No Branch Assigned" everywhere (BranchContext precedence manager > staff/trainer > member)
- [ ] Members page: pre-existing "Function components cannot be given refs" console warning (Primitive.button.Slot) — cosmetic

# Earlier open items
- [ ] Member app: native Android/iOS requires a separate Expo project (web only here)
- [ ] MIPS restart incident: cold-standby parity; re-enable workers one at a time
- [ ] Google Business Profile OAuth expired — owner must reconnect under Settings → Integrations
- [ ] Live checks pending: first October payroll settlement; one small real purchase as Mohit Gurjar
- [ ] TanStack Start migration: deferred — prepare browser-only 3D/PDF modules with dynamic imports first (see audit)

## Membership agreement — one renderer, one document (8 Oct 2026)
- [ ] Server-side canonical agreement PDF renderer (`_shared/membershipAgreementPdf.ts`): header "THE INCLINE LIFE BY INCLINE · MEMBERSHIP REGISTRATION & AGREEMENT · <Branch> | AGR-<code> | signed date", no version label
- [ ] `membership-agreement` edge fn: render (view/print/download), sign (staff drawer), backfill (owner)
- [ ] register-member uses the shared renderer
- [ ] Staff drawer + profile drawer + member profile: single "View signed agreement", no old waiver link, no client-side jsPDF agreement
- [ ] Backfill all 182 signed members to the unified agreement PDF (terms_version unified, legacy kept in audit fields)
- [ ] Verify as staff + member; update memory

# Referrals workspace redesign (9 Oct 2026)
- [x] Branch-secured referral summary with 12-week trend and lifecycle funnel.
- [x] Bento overview, program-off state, searchable/filterable/paginated referral and reward views, mobile cards, and exact approval statuses.
- [x] Create Referral Sheet with searchable member selector, validated Indian phone/email, saved email, and referrer-derived branch scope.
- [x] Verify the owner view at desktop and phone widths with no failed requests or layout overflow; the program-off state correctly blocks creation.
- [ ] Verify the same page through a branch-manager account when a manager session is available; no live referral was created while the program remains off.

- [x] Point DR replication at https://api.joinincline.in (one-way, delete propagation, v1.6.0)
- [ ] Full 1:1 copy to self-hosted standby — BLOCKED: standby has no database tables yet; needs schema applied (user to provide standby DB connection string or apply dump). Edge functions + crons need deploy on the self-hosted side.
