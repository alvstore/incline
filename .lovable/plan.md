## Audit findings

- Meta can reclassify approved WhatsApp templates after approval, so `internal_lead_alert` must not be treated as permanently UTILITY.
- The local cache currently stores Meta category in `whatsapp_templates.category`, but the legacy `templates` row used by sends does not store/validate the live category before dispatch.
- `dispatch-communication` already humanises common Meta errors, but failed WhatsApp sends still stop at `failed`; there is no automatic channel fallback or template health suppression.
- `notify-lead-created` has a naming mismatch risk: the code looks for `internal_new_lead_alert`, while your live row is `internal_lead_alert`. This can cause it to send without a template and then hit Meta errors.
- `lead_nurture_followup` is MARKETING and can be paced by Meta with 131049. That should be expected behavior, not a system error loop.

## Plan

1. **Backfill and sync live Meta category context**
   - Extend the template status view to expose `whatsapp_category`, `whatsapp_meta_status`, `quality_score`, `is_stale`, and a derived `send_risk` field.
   - Update the Meta sync function so category/status changes from Meta are mirrored into the main `templates` row validation context, not just `whatsapp_templates`.
   - Backfill the current `internal_lead_alert` / lead templates from Meta cache so UI and send logic see the real category.

2. **Fix lead-alert template resolution**
   - Change `notify-lead-created` to resolve by `trigger_event='lead_created'` first, then fallback to both known Meta names: `internal_lead_alert` and `internal_new_lead_alert`.
   - Only use a WhatsApp template if the live Meta status is APPROVED and not stale.
   - If no safe template is available, send admin alerts via SMS/email/in-app where enabled instead of attempting a risky WhatsApp send.

3. **Add pre-flight WhatsApp template guard**
   - In `dispatch-communication`, before sending any WhatsApp template, look up the live `whatsapp_templates` row.
   - Block send cleanly with `delivery_status='suppressed'` when the template is not APPROVED, stale, missing, or category-incompatible for the use case.
   - For Meta category drift:
     - internal/team operational alerts should not be retried endlessly if Meta reclassifies to MARKETING.
     - marketing/nurture sends should be allowed but treated as paceable.

4. **Graceful fallback for Meta pacing and category failures**
   - Enhance `send-whatsapp` to return structured Meta error fields: `meta_code`, `meta_subcode`, `fallbackable`, `category_issue`, `pace_limited`.
   - Enhance `dispatch-communication` to record those fields in `communication_logs.delivery_metadata`.
   - For fallbackable WhatsApp failures, queue or mark fallback intent instead of returning opaque errors.

5. **Update Templates Hub visibility**
   - Show the live Meta category badge next to the approval badge.
   - Highlight category drift for operational templates like lead alerts.
   - Add a clear action hint: “Request Meta review” or “Create alternate template”.
   - Keep this as audit/status UI only; no hardcoded one-off category assumptions.

6. **AI template generation guardrails**
   - Update system-event category mapping so internal staff lead alerts are treated as operational UTILITY proposals, but also label them as Meta-risk because Meta may reclassify them.
   - Ensure AI-generated WhatsApp templates include rationale/category notes for staff to review before Meta submission.

7. **Validation**
   - Query recent `communication_logs` for 131049/131047/132001 failures.
   - Sync Meta templates and verify `internal_lead_alert` displays its live category.
   - Test `notify-lead-created` with the existing lead template row and confirm it either sends via approved template or suppresses WhatsApp with a clear fallback reason.
   - Test `lead_nurture_followup` failure handling so Meta pacing is recorded as “paced by Meta”, not a generic error.