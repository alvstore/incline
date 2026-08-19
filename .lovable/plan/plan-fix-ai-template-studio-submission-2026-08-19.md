# Plan - Fix AI Template Studio Submission

The AI Template Studio's "Submit All" functionality is currently failing because it invokes an unsupported `upsert` action on the `manage-whatsapp-templates` edge function. Additionally, it lacks the logic to create local template rows and map them to system events via `whatsapp_triggers`.

## User Review Required

> [!IMPORTANT]
> This fix will automatically create a local `templates` record and a `whatsapp_triggers` mapping for every AI-generated proposal submitted to Meta.

- Do you want these templates to be marked as `is_active = true` by default, or should they remain inactive until manually enabled? (Plan assumes **inactive** to follow safety standards).

## Proposed Changes

### Backend (Edge Functions)

#### `manage-whatsapp-templates`
- Add a `upsert` action handler.
- If `template_id` (local ID) is missing, first create a local `templates` row.
- If `trigger_event` is provided, create or update a row in `whatsapp_triggers` for the branch.
- Proceed to submit the template to Meta (reusing the `create` logic).

### Frontend (UI)

#### `AIGenerateTemplatesDrawer.tsx`
- Ensure `branch_id` is passed correctly in the "Sync from Meta" call.
- Update `submitAll` to pass `trigger_event` to the edge function so the backend can handle the event mapping.
- Improve error handling in the submission loop to ensure the toast reflects actual successes.

## Technical Details

### `manage-whatsapp-templates` logic update:
```typescript
if (action === "upsert") {
  // 1. Ensure local 'templates' row exists
  // 2. Ensure 'whatsapp_triggers' mapping exists if trigger_event is present
  // 3. Trigger Meta API 'create' flow
}
```

### RLS and Permissions
- The edge function already runs with service_role for DB writes but verifies the user's role via JWT. No new RLS policies should be required.
