# Make Audit Logs human-readable

## Audit findings (live data, last 30 days: 13,707 events)
- **Logging works:** every create, change and delete is recorded, and the page updates live.
- **"Who" is missing on 3,014 events (22%).** These were mostly automatic actions (gate scans, system jobs, an employee filling in a signing link), but they show as "Unknown user" or blank.
- **"What record" is missing on 13,279 events (97%).** Rows read like "System updated 2158b03c", with only a record code instead of a member, task or contract name.
- **Descriptions are technical:** e.g. "Updated tasks row", "Updated integration settings row".
- **191 special events show raw codes** such as `CONTRACT_FIELDS_FILLED` and `dr_standby_config_updated`. The action filter offers only Create/Update/Delete, so these can't be filtered.
- **The detail view shows raw data:**
  - Field names like `due_time` and `is_late`.
  - Long record codes.
  - Contract text pasted in full.
  - New and deleted records shown as a raw data dump.
- **Noise:** gate attendance creates 2,618 "updated" rows. Many differ only in internal timestamps.
- **Accessibility problems:**
  - Rows are clickable boxes rather than real buttons.
  - The "online" dot relies on colour alone.
  - The "Open" link and expand arrow have no clear label.
  - Text is very small (10px badges).

## What you will see after the change
1. **Plain sentences per row:** "Rajat Lekhari marked task *Workout plan request from Shakeel makrani* as Completed", "Gate system checked in *Bhagirath Gurjar*", "Gyaneshwar Athwal filled his contract details".
   - Who: a real name, or a clear label such as "Gate system", "Automation", "Employee (via signing link)" or "Member (self-service)".
   - What: the record's real name (member, task title, contract person, plan, invoice number).
2. **Readable change list** in the expanded view, written as "Status: Pending → Completed":
   - Friendly field labels.
   - Dates in IST.
   - Money in ₹.
   - Yes/No for true/false.
   - Names instead of record codes where known.
   - Long text collapsed ("Contract text changed, show").
   - Internal fields (ids, updated_at, search vectors) hidden behind a "Technical details" toggle for admins.
3. **Special events get proper titles and icons**, e.g. "Contract details filled", "Standby server updated". The action filter adds a "Special events" group so you can filter them.
4. **Noise control:**
   - A "Hide automatic updates" switch, on by default. It hides gate/system timestamp-only changes and keeps them one click away.
   - Repeated identical events within a minute are folded together ("×4").
5. **Layout:**
   - Summary cards (events today, people active, deletions, special events).
   - A cleaner filter bar.
   - Day-grouped timeline with larger readable text.
   - A colour-plus-icon badge for Created / Changed / Deleted.
   - Phones get stacked cards with no sideways scrolling.
6. **Accessibility:**
   - Rows become real buttons with keyboard Enter/Space and `aria-expanded`.
   - "Open record" links get descriptive labels.
   - "Online" gets text, not just a dot.
   - Minimum 12px text and 44px tap targets.
   - New live events are announced politely.

## Technical details
- **Backend (additive):**
  - Improve `_resolve_audit_target_name` to cover the main tables: members, tasks (title), contracts (employee name), employees/trainers, invoices (number), memberships/PT packages (member + plan), staff_attendance (user name), integration_settings (provider), lockers (number).
  - Make the trigger fall back to a "system/gate/automation" actor label from the `source` field or session context when `auth.uid()` is null.
  - Backfill `target_name` and `actor_name` for the last 90 days in batches. Old payloads stay untouched (the log remains append-only; only the display columns are filled).
- **Frontend:**
  - New `src/lib/audit/humanize.ts`: field-label dictionary per table, value formatters (IST dates, ₹, enums, booleans, uuid→name lookup from the log's own resolved names), a sentence builder per action/table, a special-action catalog, and a noise rule (only `updated_at`/`last_seen`/`synced_at` changed).
  - Refactor `AuditLogs.tsx` into `AuditRow`, `AuditChangeList` and `AuditFilters` components. Keep React Query fetching, realtime, CSV export (the export uses the human sentences too) and deep links.
  - Unit tests for `humanize.ts`: sentence for a task status change, money/date formatting, noise detection, special-action titles.
- **Verification:**
  - Screenshot the page at 1440 / 1024 / 768 / 375 before and after, signed in as owner.
  - Expand an Update, an Insert and a special event, and confirm no horizontal scroll.
