# Referrals workspace redesign

## Goal
Turn `/referrals` into a clear branch-aware operations workspace while keeping the referral program off and preserving the existing claim → branch-manager approval → wallet-credit flow.

## Audit findings
- The current page is a flat row of four counters followed by two tables; it gives no conversion trend, approval workload, or useful next action when data is empty.
- The live all-branches view currently has no referrals or rewards, so the redesign needs intentional empty states rather than blank charts.
- Loading is handled only by a spinner. Query failures have no visible error or retry state.
- The tables have no search, status filter, result count, pagination, or dedicated mobile presentation.
- Reward status only distinguishes claimed versus pending, even though the data now supports manager-approval states.
- The Create Referral drawer is structurally a Sheet, but it scrolls as one block rather than using a sticky header/body/footer. Its member selector does not scale well, entered email is not written, and the manual record does not explicitly carry the selected member’s branch.
- The page computes all metrics from downloaded rows. Trend charts need a branch-scoped server summary rather than browser aggregation.

## Build

### 1. Bento overview
- Use a 12-column responsive grid with four compact KPI cards: total referrals, conversion rate, awaiting conversion, and rewards awaiting approval/credited.
- Add a wide conversion-trend card for the last 12 weeks and a compact lifecycle/funnel card showing Referred → Joined → Reward issued → Approved → Credited.
- Use semantic theme tokens, Lucide icons, soft Vuexy-style elevation, restrained motion, and reduced-motion support.
- When the program is off, show one calm status strip with a link to Referral Settings; do not expose or alter the setting from this page.

### 2. Operational tabs
- Keep two focused tabs: **Referrals** and **Rewards & approvals**.
- Add search, status chips, result count, and pagination.
- Desktop uses sticky-header tables; phones use stable stacked record cards with the same actions and statuses.
- Add complete skeleton, empty, error, and retry states. Export only the currently filtered result set.
- Show exact approval states: available to claim, awaiting manager approval, approved/credited, and rejected where present.

### 3. Create Referral drawer
- Redesign as a right-side Sheet with sticky title, scrollable form body, and sticky Cancel/Create footer.
- Use a searchable member selector showing name and member code, branch context, properly associated labels, 44px controls, visible keyboard focus, and an error summary.
- Validate name, Indian phone, and optional email before submit.
- Save the email and selected referrer’s branch with the manual referral record; retain the existing referral lifecycle and do not issue wallet credit here.
- Disable creation while the referral program is off and explain that it can be enabled in Referral Settings.

### 4. Data and security
- Add one branch-aware summary RPC for chart/KPI data, aggregated in the database and capped to 12 weekly points.
- Enforce owner/admin global visibility and manager/staff branch visibility inside the server function; explicitly grant only the roles that use it.
- Keep mutations on the existing secured referral conversion and reward-claim paths. The redesign will not add a direct wallet-credit path.
- Scope page queries and member choices to the active branch unless an owner intentionally selects All Branches.

### 5. Verification
- Add focused tests for status mapping, conversion-rate calculation, and filtered export data.
- Verify as owner in All Branches and one branch, and as a branch manager.
- Check empty, loading, query-error, create, convert, claim-request, and approval-status states.
- Check keyboard and screen-reader labels plus 375px, 768px, 1280px, and 1440px layouts.
- Run the relevant tests and confirm the preview build has no errors.

## Technical details
- Split the page into small referral overview, analytics, table/card list, status-badge, and drawer components instead of extending the current 829-line page.
- Use TanStack Query for every fetch/mutation and invalidate referral summary/list/reward keys after mutations.
- Use the existing shadcn chart wrapper with Recharts and CSS-variable colors; provide a textual chart summary for assistive technology.
- Keep existing referral settings, eligibility, conversion, claim approval, and wallet rules unchanged.
