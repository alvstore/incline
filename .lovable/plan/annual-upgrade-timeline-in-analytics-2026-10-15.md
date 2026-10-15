# Annual upgrade timeline in Analytics

## Verified current state
- The widget is on `/dashboard`; `/analytics` is already restricted to owners, admins and managers.
- The existing upgrade summary excludes expired active offers on the server, but also returns converted offers. The widget displays only the first eight rows and has no countdown bar or joining date.
- The daily 9 AM IST Automation Brain rule is enabled and recorded a successful run today. Both annual-upgrade WhatsApp templates are APPROVED as MARKETING.
- The worker sends WhatsApp only. Exact-date matching can miss reminders after a failed run, and it currently treats any non-failed dispatcher response as sent—including suppression or queueing.

## 1. Move the experience to Analytics
- Remove the annual-upgrade widget and its query from Dashboard entirely.
- Add a full-width **Annual upgrades** section within the existing Analytics dashboard, keeping other analytics cards unchanged.
- Keep branch selection and existing owner/admin/manager permissions. Global view shows a branch-selection prompt rather than silently choosing an arbitrary branch.
- Retain compact bento summaries for eligible members, closing soon, upgrades this month and upgrade revenue. Keep completed upgrades in summary totals, not the active countdown list.

## 2. Timeline-based design
Each member row will show:
- Name, member code and current plan.
- Joining date, membership start date when different, and the exact upgrade deadline in IST. Eligibility continues to use the existing membership start date—not account creation.
- A labelled time-left bar with milestones: **Start → Day 7 offer → Day 12 reminder → Deadline**.
- A prominent remaining-days label, switching to hours for the final day; deadline-first ordering.
- Actual WhatsApp reminder states and timestamps: scheduled, queued, sent, failed or suppressed. Never imply delivered without delivery evidence.
- Member-detail navigation, but no manual-send button or staff-follow-up instruction.

Show all eligible members through pagination rather than silently truncating to eight. Use responsive stacked rows, labelled progress indicators, accessible buttons, skeletons, useful empty states and retryable errors.

**Visual direction:** use UI/UX Pro Max for hierarchy, timeline composition and density; preserve the existing Inter typography, semantic colour tokens, rounded cards and light/dark themes. No palette replacement or decorative gradient redesign. Use restrained opacity/transform transitions with reduced-motion support.

## 3. Expiry and reliable automation
- Use one server-defined start/deadline contract across the timeline, reminders and upgrade eligibility. Joining day is Day 1; align Day 7 and Day 12 reminder timing with that convention and retain the existing 15-day eligibility deadline.
- Remove offers at `now >= deadline` from the active list, both server-side and locally while the page remains open. Refresh on focus and periodically; retain expired records for audit rather than deleting them.
- Exclude converted, cancelled and otherwise ineligible memberships from active countdowns and future nudges.
- Replace exact-date-only selection with bounded catch-up within the still-open window. Before Day 12, send an outstanding Day 7 offer; from Day 12 onward, send only the closing reminder—not both messages together. Never send after expiry.
- Make closing reminders independent of successful Day 7 delivery. Use the real deadline in message text instead of an inaccurate fixed “72 hours” promise after a delayed run.
- Track reminder stages independently from delivery outcomes. Keep per-offer/stage/channel deduplication; failed attempts can retry safely, queued sends remain queued, and suppressed recipients are not repeatedly contacted.
- Continue using Automation Brain and the existing communication dispatcher, honouring preferences, quiet hours and do-not-contact. Preserve the existing switch-off control and payment/conversion flow.

## Email limitation
Annual-upgrade offers are promotional marketing emails, not app emails. Lovable does not support marketing emails through its built-in email sender; mixing them damages sender reputation and deliverability. Do not route these offers through the managed email queue or its SMTP fallback, and do not relabel them as account notices.

**Automatic promotional email is a separate dependency:** it requires a dedicated marketing email service outside Lovable's app-email system. This plan completes the timeline and reliable WhatsApp automation; email remains clearly unconfigured rather than appearing sent. No change to existing receipts, scan reports or other app emails.

## Technical scope
- Update Analytics, remove Dashboard mounting, and move/refactor the upgrade widget into focused timeline components.
- Extend the branch-guarded summary with joining/start dates, member code, server time, pagination and verified reminder outcomes. Keep financial values protected on the server as well as the screen.
- Update only annual-upgrade worker/summary/eligibility paths necessary for the deadline and delivery rules; follow existing RPC guards, explicit grants and audit conventions.
- Run the UI/UX Pro Max design-system CLI after approval; use its recommendations for composition only. Record structural decisions in `AGENTS.md` during implementation.

## Acceptance checks
- Tests for Day 1/7/12/15, IST boundaries, exact-deadline expiry, delayed runs, skipped Day 7, deduplication, failed retries, queued/suppressed outcomes and converted/cancelled exclusions.
- Verify Dashboard no longer loads the upgrade widget and Analytics shows real eligible members with correct dates and countdowns.
- Check branch isolation and financial permissions; verify expired offers disappear while Analytics remains open.
- Exercise the savings/payment flow in a controlled test without charging a real member; confirm a conversion leaves the active list and updates summaries.
- Use an approved test recipient for WhatsApp delivery; inspect the actual send result rather than treating a successful scheduler run as delivery.
- Run **Lovable Design Critic** on screenshots at 1440, 1024, 768 and 375 px; fix major findings, check both themes, and confirm no overflow.
- Run relevant tests, RPC guard checks and inspect preview build errors before completion.

## Out of scope
No changes to annual target-plan selection, prices, membership purchase, PT, payroll, other Analytics calculations or public pricing visibility.