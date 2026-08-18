# Fix: Task notifications, AI Template Studio, Quick Presets

## 1. Task update fails — `linked_entity_id` does not exist

Confirmed root cause: the database function `create_system_notification` inserts into a `notifications.linked_entity_id` column that does not exist (the table has `id, user_id, branch_id, title, message, type, category, is_read, action_url, metadata, created_at`). That function is called by the `tasks_notify_management` trigger, which fires on every task INSERT/UPDATE — so any task write returns 400.

Fix: rewrite `create_system_notification` to write the linked entity into `metadata` (jsonb) and `action_url` instead of the missing column, keeping the same function signature so no callers break. Also wrap the trigger's notification insert in an exception guard (the same pattern `tasks_notify_assignee` already uses) so a notification failure can never block a task write again.

## 2. AI Template Studio — nothing submits, no way to go back, footer glitch

Confirmed root cause of "Successfully submitted 0 templates": the drawer calls the edge function `manage-whatsapp-templates` with `action: 'upsert'` and a `template` key. That function only accepts `list | create | edit | get_status | bulk_delete_local | sync_ig_icebreakers | sync_messenger_quick_replies` and reads `template_data`, so every call returns "Unknown action" — the loop swallows the error and then always shows a success toast.

Fixes in `src/components/settings/AIGenerateTemplatesDrawer.tsx`:
- Send `action: 'create'` with `template_data` shaped as the edge function expects (name, category, language, body/header/footer, branch_id).
- Stop lying about the result: count failures, surface the first real error message, and show an error/partial toast when any submit fails. Keep the drawer open on total failure so the user can retry.
- Add a **Back** button on the review step so a different event can be picked without closing the drawer, and let individual proposals be deselected/removed before submitting.
- Make the review step per-proposal aware: show a per-row status (pending / submitted / failed + reason) as submission progresses.

UI/UX (per the screenshots):
- The footer is `absolute` inside a scrolling sheet, which is why it floats over content and the Submit button stretches oddly next to Cancel. Convert the sheet to a fixed three-row layout (sticky header, `flex-1 overflow-y-auto` body, sticky footer) so the footer never overlaps and buttons sit on one balanced row (Back / Cancel on the left, primary action right, fixed height, no `scale` hover jump).
- Empty state when there are no gaps, and a skeleton while the coverage matrix loads.

Coverage accuracy: the "missing" list is derived from `whatsapp_triggers` rows only, so events that have an approved template but no trigger row are wrongly listed as gaps. Recompute uncovered events from the `templates` table (approved `meta_template_status` matched on `trigger_event`) joined with triggers, so the gap count is real.

## 3. Quick Presets

Quick Presets is a shortcut menu that pre-fills the manual template editor from `DYNAMIC_PDF_PRESETS` in `src/lib/templates/dynamicAttachment.ts` (Invoice PDF, Receipt PDF, Body Scan, Posture Scan, Diet/Workout plan, etc.) — it does not create anything by itself. It looks incomplete because the list is a small hardcoded set mixing WhatsApp and Email presets with no labelling or filtering.

Fix: group the menu by channel, filter to the channel currently selected in the Templates Hub, label each item with its trigger event, and add a short menu description explaining that a preset only pre-fills the editor. No behavioural change to `applyPreset`.

## Technical summary
- Migration: redefine `public.create_system_notification` (metadata/action_url instead of `linked_entity_id`); harden `tasks_notify_management` with an exception guard.
- `src/components/settings/AIGenerateTemplatesDrawer.tsx`: correct edge-function contract, honest error handling, back/step navigation, per-proposal status, sticky-footer layout, accurate gap computation.
- `src/components/settings/TemplateManager.tsx`: Quick Presets menu grouping/filtering and helper copy.
