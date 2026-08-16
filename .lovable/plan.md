---
name: template-coverage-audit-2026
description: Plan for deep audit and fix of template coverage, messaging failures, and missing motivation templates.
type: feature
---

## Deep Audit: Communication Templates & Delivery

### 1. Template Coverage Matrix Fix
The UI is currently failing to load because it attempts to query a non-existent `template_coverage_matrix` table. This logic should be client-side using `SYSTEM_EVENTS` from `@/lib/templates/systemEvents` joined against actual `templates` and `whatsapp_triggers` in the database.

### 2. Missing "Motivation" Templates
New events will be added to `SYSTEM_EVENTS` to support absent members (nurture/motivation) to avoid repetitive messaging:
- `absent_member_motivation_low`: First nudge for members missing for 3-5 days.
- `absent_member_motivation_high`: Stronger nudge for members missing for 7-10 days.

### 3. Meta Delivery Failures (131049)
The "Meta pacing limit" error indicates high frequency or cold audience issues.
- Implement a "Cool-down" or "Warm-up" logic in `dispatch-communication`.
- Add retry metadata to `communication_logs` to track failed attempts and prevent immediate spamming of the same template.
- Review `daily_ops_summary` template registration in Meta to ensure it's not being flagged as spam.

### 4. Daily Messages Audit
Check the `automation-brain-tick` and `send-reminders` logic to ensure daily summary and nurture tasks are firing correctly.

## Technical Tasks
- **Database**: 
  - Ensure `whatsapp_triggers` and `templates` have correct RLS for auditing.
  - Verify if `daily_ops_summary` template is actually present in the `templates` table.
- **Frontend**:
  - Remove references to `template_coverage_matrix` and use a computed view of coverage.
  - Enhance `AIGenerateTemplatesDrawer` to support batch-creation of the new motivation templates.
- **Edge Functions**:
  - Update `dispatch-communication` to handle Meta error 131049 with an automatic back-off or fallback to SMS.
