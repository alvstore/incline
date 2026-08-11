# WhatsApp template alignment + workout day-rotation repair

## Confirmed findings

- **Plan delivery is choosing the wrong CRM template.** `diet_plan_ready` has three active CRM candidates. The dispatcher gives the local `document` flag a large score even when that template has no live Meta mirror, so it selects `diet_plan_document_v1` and then blocks on its three empty variables. Two other live-approved templates exist for this event.
- **Pre-flight validation failures are incorrectly retried.** Exhausted queue rows show the identical `template_param_empty:member_name,plan_name,branch_name` result three times. This deterministic configuration failure should stop immediately, not consume function resources.
- **CRM/Meta status can drift.** The live mirror contains 102 rows: 65 currently approved and 37 stale. CRM has 65 WhatsApp rows marked approved, but template selection does not require an existing, non-stale live mirror. “Approved” can therefore mean only the cached CRM status.
- **Meta list sync is incomplete for larger accounts.** The management function fetches only one page with `limit=100`; there are already 102 cached rows. It also imports unmapped provider templates as nearly empty CRM stubs, without deriving variables, event compatibility, or dynamic-document rules.
- **Workout offsets are saved and displayed in the member portal.** Active plans exist across offsets 0–6, and the viewer relabels/sorts Monday’s complete exercise block onto Tuesday/Wednesday/etc. The main delivery gap is PDF generation: `buildPlanPdf()` renders the unshifted source plan, so every shared PDF is identical.
- **Sunday rule:** follow the authored plan. An explicit Sunday workout participates in rotation; otherwise Sunday remains rest/off.

## 1. Make template delivery fail-safe

- Change dispatcher candidate selection so a CRM template is eligible only when its Meta mirror exists, is `APPROVED`, and is not stale.
- Score from the **live** Meta header, category, and components rather than trusting local header/status fields. For a PDF send, prefer a live DOCUMENT-header template; if none exists, use a compatible live body template rather than a ghost document template.
- Add deterministic tie-breaking (branch match, exact event, live media compatibility, then newest synced row) so duplicate event mappings cannot produce unstable sends.
- Populate plan-send variables consistently (`member_name`, `plan_name`/`plan_title`, `branch_name`, trainer where required), but never invent missing member identity. If a chosen template does not match the available variable contract, skip it and try the next compatible candidate.
- Classify `template_param_empty`, stale/not-approved templates, and missing Meta templates as terminal in the retry worker. Preserve retries only for transient network/provider/compute failures.
- Add a small concurrency/batch cap to the retry worker so one run cannot fan out 50 nested function calls and trigger the reported compute-resource failure.

## 2. Turn Meta sync into reconciliation

- Upgrade the Meta list action to follow pagination until all templates are fetched, then reconcile the complete snapshot atomically: upsert live rows, mark absent rows stale, and mirror live status/category/components into CRM.
- For provider templates missing from CRM, derive body text, variable count/order, header format, category, language, and approval state. Do not auto-activate them for a system event until their variable/header contract is compatible.
- Add an alignment result for every CRM row: **Ready**, **Needs mapping**, **Variable mismatch**, **Header mismatch**, **Pending/Rejected**, or **Missing/Stale in Meta**.
- Enforce document-event rules during reconciliation: diet/workout/invoice/receipt/report events must map to an approved live DOCUMENT-header template for native PDF delivery. Body-only templates remain visible but are flagged as link fallback, not silently treated as document templates.
- Do not resubmit existing Meta names with a forced category. Reuse the live category or create a versioned name when a category/header contract must change.

## 3. Complete the Template Manager workbench

- Make **Sync from Meta** run the full reconciliation and show fetched/imported/updated/stale/conflict counts.
- Extend the table with live Meta status, category, header type, sync age, event mapping, and a clear alignment badge.
- Add filters for Ready / Missing in CRM / Missing in Meta / Contract mismatch / Pending / Rejected.
- In Coverage, treat a WhatsApp event as ready only when its mapped template is live-approved, non-stale, active, and contract-compatible. Replace the current status-only check.
- Add per-row actions: map to CRM event, repair CRM metadata from Meta, edit CRM copy, submit a new version, and test-send with validated sample variables.
- Keep all creation/editing flows in right-side Sheets and retain the current Vuexy workbench styling.

## 4. Make day rotation consistent everywhere

- Extract one pure whole-day rotation helper that moves each complete workout block—focus, exercises, warm-up/cool-down and notes—from its authored weekday to the shifted weekday. Use the same helper in member UI, previews, and PDF generation.
- Preserve authored Sunday semantics: if the plan explicitly schedules Sunday, include it in the cycle; otherwise keep Sunday as rest/off while rotating the authored workout days.
- Pass each assigned plan’s `schedule_offset_days` into PDF generation and WhatsApp/email delivery so member A’s Monday block can appear on Tuesday while member B’s appears on Wednesday.
- Keep exercise contents unchanged; only the complete day assignment moves. Do not use exercise-variant rotation for this requirement.
- Improve assignment preview to show explicit mappings such as `Mon → Wed`, including each selected member’s final weekly schedule before save.
- Add a staff-visible offset badge and change-shift action for an existing assignment, then regenerate/resend that member’s PDF from the same resolved schedule.

## 5. Verification

- Sync Meta and confirm the reconciled total is not truncated at 100; verify stale rows cannot be selected for sends.
- Test each CRM-required WhatsApp event with validated sample variables, reporting pass/fail without sending to real members unless explicitly chosen.
- Re-send one diet PDF through the real dispatcher and confirm: no `template_param_empty`, a live approved template is selected, and the PDF is a native document when the mapped Meta template has a DOCUMENT header.
- Run the retry worker against one terminal variable error and one simulated transient failure; confirm terminal stops once and transient retries with bounded concurrency.
- Assign one workout to members at offsets 0, 1, and 2; verify portal, preview, downloaded PDF, WhatsApp PDF, and email PDF all show the same member-specific day mapping, with Sunday following the authored plan.

## Technical notes

- No new messaging bypass: all sends continue through `dispatchCommunication()` / `dispatch-communication`.
- No change to exercise content or the existing `schedule_offset_days` database contract.
- Database changes, if needed, are limited to reconciliation metadata/indexes; existing template/message records remain intact.
- UI/UX direction follows the UI/UX Pro Max audit while preserving the project’s Vuexy tokens and Sheet-only form rule.