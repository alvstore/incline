# Restore member visibility and daily owner reporting

## Confirmed causes

- The database still contains **93 members (92 active)** and named admin profiles; this is a visibility failure, not data loss.
- The recent `Manager manage own branch staff` policy selects from `staff_branches` while evaluating access to `staff_branches`. PostgreSQL raises `42P17`, and the failure propagates into profile joins used by Members, Attendance, the user menu, plan-member lists, and other screens.
- The 11 PM IST `daily_ops_summary` automation is active and ran successfully on 8–9 August.
- Both owner emails were recorded as sent on 9 August. WhatsApp sends to both owners were suppressed with `no_template_for_closed_session` because there is no approved WhatsApp template mapped to `daily_ops_summary`.
- Automation currently marks the worker successful when its HTTP call succeeds, even if individual channels were suppressed, which hides this delivery failure in System Health.

## Fix plan

1. **Remove the recursive access rule immediately**
   - Replace the self-referencing manager policy with the existing security-definer branch visibility helper, so policy evaluation never recursively invokes `staff_branches` RLS.
   - Preserve the intended boundary: owners/admins manage all assignments; managers can manage staff assignments only within branches already assigned to them; users can still read their own assignment.
   - Do not broaden anonymous or unrelated role access.

2. **Verify every affected identity/data path**
   - Test the logged-in profile query and confirm the admin name/avatar render again.
   - Test the Members list, member-plan side sheet, and staff attendance profile join against the active branch.
   - Confirm all 93 members are visible to owner/admin and branch-scoped visibility remains correct for managers.
   - Run the database security linter after the policy change.

3. **Repair WhatsApp delivery for the daily report**
   - Add a dedicated `daily_ops_summary` WhatsApp template using the existing owner-report variables and wire its trigger mapping.
   - Submit/sync it through the existing WhatsApp template workflow. Until the provider approves it, report WhatsApp as pending rather than falsely successful; once approved, the dispatcher will resolve it event-first.
   - Keep the report routed through the universal communication dispatcher and retain the once-per-recipient/day deduplication.

4. **Make report health truthful and testable**
   - Update `daily-ops-summary` to inspect each dispatch result and return a failure/partial-delivery result when WhatsApp or email is suppressed/failed.
   - Update the automation run outcome so System Health shows per-channel failures instead of only the worker HTTP success.
   - Add structured delivery details without exposing recipient contact information in general logs.

5. **End-to-end verification**
   - Run a non-sending preview to validate the IST date window and totals.
   - Run a controlled owner-report send with a fresh dedupe key and inspect communication logs separately for email and WhatsApp.
   - Verify email provider acceptance in logs; inbox arrival must be confirmed in the recipients’ inboxes.
   - Verify WhatsApp delivery immediately if the template is approved; otherwise record the provider-approval dependency explicitly and confirm the automatic path is ready.

## Technical details

- Database change: replace the recursive `staff_branches` policy expression with `branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))` (or an equivalent narrowly scoped security-definer helper), with a pinned `search_path`.
- Edge functions: increment versions for `daily-ops-summary` and, only if needed for truthful status propagation, `automation-brain`; preserve strict dispatcher-only outbound delivery.
- No member, profile, attendance, payment, or report data will be deleted or rewritten.
