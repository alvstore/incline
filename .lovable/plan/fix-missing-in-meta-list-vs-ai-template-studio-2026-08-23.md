# Fix: "Missing in Meta" list vs AI Template Studio

## What the audit found (verified against the database)

The two screens read **two different tables**, which is why they disagree.

- The amber **"37 missing in Meta"** popover reads `whatsapp_templates` — the local mirror of your Meta catalog. 37 of its 106 rows are flagged `is_stale = true` (marked when a send returned Meta error 132001, i.e. the template no longer exists in Meta).
- The **templates list** (69 WhatsApp rows) and the **AI Template Studio** read the `templates` table — the CRM-side templates that actually drive sends.

Verified facts about those 37 names (`internal_new_lead_alert`, `invoice_pdf__whatsapp`, `feedback_request`, `class_reminder`, `renewal_reminder_1d`, `campaign_1784097153528`, …):

- **None of them exist in `templates`** — zero join matches on `meta_template_name`.
- **None are wired to any `whatsapp_triggers` row.**
- Their last sync timestamps run from 26 Apr to 15 Jul 2026 — they are leftovers from an older catalog/import.
- The events they look like they serve are already covered by current, approved templates (`birthday`, `payment_received`, `lead_welcome`, `class_reminder_24h`, `membership_expired`, `pt_session_booked`, `referral_reward`, `freeze_confirmed`, `unfreeze_confirmed`, `facility_booked`, `invoice_generated`, `receipt_generated` all have live approved rows).

So the AI Studio is not broken in the way it looks: it correctly shows **2 real event gaps**, because every event those dead names once served already has a live approved template. What is wrong is that dead mirror rows are surfaced as a scary warning with no way to act on them, and the Studio's coverage check ignores Meta's *live* status.

## What to change

### 1. Make the "missing in Meta" badge actionable and honest
- Split the popover into two groups, computed rather than dumped as one list:
  - **Orphaned (no CRM template)** — the current 37. Label them "not used by the CRM — safe to clear", with a **Clear orphaned entries** button that deletes those `whatsapp_templates` rows (only rows that are stale, have no matching `templates.meta_template_name`, and no trigger reference).
  - **Broken (a CRM template points at it)** — these are the ones that actually break sends. Show the affected CRM template name and a **Recreate in Meta** action that opens the existing submit-to-Meta flow pre-filled.
- Badge count and colour follow the *broken* group; orphans render as a muted secondary line instead of a warning.

### 2. Fix the Studio's coverage computation
Currently an event counts as covered when the local row says `meta_template_status = APPROVED`. That ignores whether Meta still has the template. Join the same `whatsapp_templates` live-status data the Templates table already uses (`live_meta_status`, `is_stale`) so an event whose only template is missing/stale in Meta is reported as a gap and becomes selectable in the Studio.

### 3. Explain the empty-looking Studio
When there are 0–2 gaps, show a short summary line above the list: "X of Y system events covered · N templates missing in Meta" with a link that jumps to the Missing/Stale filter on the Templates table. Add a **Recreate missing in Meta** section inside the Studio listing the broken group from step 1, so one place can both generate new copy and repair broken links.

### 4. Cleanup safety
Clearing orphans is delete-only on the mirror table and never touches `templates` or anything in Meta. A confirmation modal lists exactly what will be removed and the count.

## Technical notes

- `src/components/settings/MetaSyncControls.tsx`: fetch stale `whatsapp_templates` joined against `templates.meta_template_name` to classify orphan vs broken; add clear/recreate actions; invalidate `whatsapp-templates-stale`, `whatsapp-templates-live-alignment`, `communication-templates`.
- `src/components/settings/AIGenerateTemplatesDrawer.tsx`: coverage query also loads `whatsapp_templates(name, status, is_stale)` and treats a template as covering an event only when its Meta twin exists and is not stale; add coverage summary header and the recreate section.
- `src/components/settings/TemplateTable.tsx`: no logic change — its `alignmentState` already classifies missing/stale correctly; only the deep-link filter hook is added.
- No schema change. Orphan deletion runs through the existing `whatsapp_templates` staff delete policy.
