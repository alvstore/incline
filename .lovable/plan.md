# Fix plan delivery to WhatsApp / Email / In-app + universal WhatsApp templates

## What I found (verified against the live data)

Mohit Gurjar (INC-26-0025) was assigned "FAT LOSS PROGRAM" at 13:28 UTC today. Checking the actual records:

1. **In-app worked.** A notification row exists for him at 13:28.
2. **WhatsApp and Email never fired.** No `communication_logs` rows at that time — only channels ticked in the drawer are sent, and the drawer defaults to In-app only. Nothing forces the plan to go out on all channels.
3. **The PDF attachment path is broken code.** When "Send PDF on assign" is used, the drawer queries `members.full_name, phone, email` — those columns do not exist on `members` (they live on `profiles`). The query errors silently, the member map ends up empty, and no PDF is ever sent on any channel.
4. **The assignment row has `branch_id = null`.** The Member Plans tab filters strictly by the active branch, so the assignment is invisible even though the template card correctly shows "1 use". A null branch also makes WhatsApp/Email fail with "No branch context".
5. **`valid_until` was saved as the same day as `valid_from`**, so the row would also be dropped by the default "Active" status filter.
6. **WhatsApp templates for these events are misconfigured.** For `workout_plan_ready` the only active template is `workout_plan_ready_doc` with `header_type = 'document'`; the link-style templates are inactive. Per the established rule, Meta rejects DOCUMENT headers that have no uploaded media handle — document events must use `header_type = 'none'` with a `{{document_link}}` body variable, and the dispatcher injects the real PDF at send time. Same problem on `diet_plan_ready`.

## What will be built

### 1. Deliver on all channels, instantly
- Default the assign drawer to **In-app + WhatsApp + Email** all selected, with "Send PDF on assign" on by default.
- Resolve branch context reliably: use the member's own `branch_id` when the drawer has no active branch, so the plan row is never written with a null branch and dispatch never fails on "No branch context".
- Fix the broken member lookup so contact details come from `profiles` (name, phone, email) — this is what currently kills the PDF send.
- Fix the default validity so `valid_until` follows the plan's duration instead of collapsing to the assignment date.
- Surface per-channel results honestly in the confirmation view (sent / skipped / reason), instead of a silent no-op.

### 2. Backfill / repair Mohit's assignment
- Set the correct branch and validity on the existing row so it appears in Member Plans.
- Re-send the plan to him on WhatsApp and Email and confirm delivery in the communication log.

### 3. Universal, reusable WhatsApp templates (Meta-pushable)
- Create one universal, Meta-safe document-delivery template pair used by every PDF event (workout plan, diet plan, invoice, receipt, scan report):
  - `header_type = 'none'`, body carries `{{member_name}}`, `{{document_title}}`, `{{document_link}}`.
  - Marked global (`branch_id = null`) so all branches inherit it.
- Deactivate/repair the invalid `*_doc` document-header templates for `workout_plan_ready` and `diet_plan_ready` so the dispatcher stops picking a template Meta will reject.
- Wire the existing "push to Meta" flow so this universal template can be submitted for approval from the Templates hub, and show its Meta approval status there.

### 4. Test
- Assign the same plan again end-to-end and verify: notification row, WhatsApp log `sent/delivered`, email log `sent`, and the PDF link resolving.

## Technical notes
- Files: `src/components/fitness/AssignPlanDrawer.tsx`, `src/services/fitnessService.ts` (`loadMemberContacts`, `assignPlanToMembers`, `fetchMemberAssignments`), `src/utils/sendPlanToMember.ts`, `src/lib/templates/dynamicAttachment.ts`.
- All sends continue to go through `dispatchCommunication` → `dispatch-communication`; no direct `send-*` calls and no direct `communication_logs` writes.
- Template changes ship as a migration on `public.templates` plus a data fix for the existing rows.
