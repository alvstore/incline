# Resend assigned plans, see who's assigned, and deliver real PDFs on WhatsApp

## What I checked

- The Plan Templates card shows "1 use" but has no way to open that list — the usage count is only a number (`fetchTemplateUsageCounts` returns counts, nothing clickable).
- A per-row send menu already exists on Member Plans (`SendPlanPdfMenu`: Download / WhatsApp / Email), but it sits inside a collapsed member group, so in practice there is no visible "resend" affordance from where staff actually work (the template card).
- WhatsApp templates in the database: `workout_plan_ready_doc` and `diet_plan_ready_doc` are active, global, `header_type='document'`, `attachment_source='dynamic'`, with Meta template names — these are the ones that deliver a native PDF. The link-style variants are inactive.
- No plan PDF has ever actually been dispatched: there are zero `communication_logs` rows carrying a `fitness-plans/...` attachment, so the document path is untested end to end.

## What will be built

### 1. "Who is assigned" from the template card
- Make the usage chip on each template card clickable ("1 use" → opens an Assignments sheet for that template).
- The sheet lists every member assigned that template: name, member code, avatar, assigned date, valid-until, active/expired badge, and the trainer who assigned it.
- Empty and loading states included; count reflects the same source as the chip so they never disagree.

### 2. Resend from where it matters
- Each row in the Assignments sheet gets a Resend action (WhatsApp / Email / Download) reusing the existing send menu, plus View plan and Revoke.
- On the Member Plans page, promote the send menu to a clearly labelled "Resend" button on each plan row instead of an icon buried in the group.
- Every resend shows a per-channel toast result (sent / reason it failed) rather than a silent success.

### 3. Real PDF on WhatsApp, not a link
- Force the document path: when sending a plan, always resolve the approved document-header template first; if one exists the PDF goes out as a native WhatsApp document (HEADER document component with the freshly uploaded PDF), and the caption no longer contains any URL.
- If no approved document template is available for the branch, fall back in this order: native document message when the member is inside the 24h service window, then link template as the last resort — and surface which path was used in the result so it's visible when a link went out instead of a file.
- Filename sent to WhatsApp becomes readable (`Workout-Plan-<Plan Name>.pdf`) so the member sees a proper document title.
- Verify end to end with a real send and confirm the log row shows the attachment and a `sent`/`delivered` status.

## Technical notes

- Files: `src/pages/fitness/Templates.tsx` (clickable usage chip), new `src/components/fitness/TemplateAssignmentsSheet.tsx`, `src/pages/fitness/MemberPlans.tsx`, `src/components/fitness/SendPlanPdfMenu.tsx`, `src/utils/sendPlanToMember.ts`, `src/lib/templates/dynamicAttachment.ts`.
- New service function `fetchAssignmentsForTemplate(templateId, branchId)` in `src/services/fitnessService.ts`, reusing the existing assignment-row shape (member contact details joined from `profiles`).
- All sends continue through `dispatchCommunication` → `dispatch-communication`; no direct `send-*` calls and no direct `communication_logs` writes.
- No schema changes expected; template rows already carry the document-header configuration needed.
