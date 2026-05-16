## Audit findings

### 1. "Clear" button shows fake toast on AI Call Logs

`ai_call_logs` has only a SELECT RLS policy (`staff_view_ai_call_logs`) — there is **no DELETE policy**. So `supabase.from('ai_call_logs').delete().select('id')` is silently filtered to 0 rows by RLS, returns success with `data=[]`, and the UI toasts **"Cleared 0 AI call logs"** — which the user reads as a fake success while the list never changes.

### 2. Errors are truncated / unreadable

Each row in `AICallLogsTab.tsx` renders `l.error_message` inline with `truncate`. There's no expand, no copy, no way to read the full `google HTTP 403: [{...}]` payload. The only way to know what went wrong is to click into the DB.

### 3. Edit Automation Rules — model dropdown only shows Google models

In `AIPurposesTab.tsx`:
- The provider for each purpose is **resolved by scope** (`PURPOSE_TO_SCOPE`) against `ai_provider_configs` and the model picker only lists `PROVIDER_DEFAULTS[resolvedProvider].models`.
- For `automation_rule` the resolved provider is `google`, so only Google models appear.
- DB already has `ai_purposes.provider_id` (uuid → `ai_provider_configs`) — wired but the UI never lets you override it.
- Two providers are currently enabled: `google`, `openrouter`. The user wants both visible.

## Plan

### Fix 1 — Real DELETE on `ai_call_logs`

Migration: add an owner/admin DELETE policy (mirroring the existing SELECT policy's role check). Also add the same for `ai_tool_logs` for symmetry (its tab has the same Clear button pattern — quick check, add only if missing).

```sql
CREATE POLICY "staff_delete_ai_call_logs"
  ON public.ai_call_logs FOR DELETE
  USING (has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role]::app_role[]));
```

(Owner/admin only — managers can view but not purge, matching destructive-action conventions.)

### Fix 2 — Honest result + readable errors in `AICallLogsTab.tsx`

- Use `.delete(..., { count: 'exact' })` and read `count` instead of relying on the returned rows array. Toast the real count; if 0, show an info toast ("No logs older than X to delete") instead of green success.
- Make each error row expandable: a chevron toggles a collapsible block under the row that shows the full `error_message`, `provider`, `model`, `purpose`, `duration_ms`, timestamp, with a "Copy" button. Use `useState` Set of expanded row ids; no extra deps.
- Add a "status" filter chip row (all / success / fallback / error) so the user can quickly isolate failures, plus a refresh button that visually spins while `isLoading`.

### Fix 3 — Provider + Model pickers in Edit Automation Rules drawer

In the edit drawer (`AIPurposesTab.tsx`):
- Add a **Provider** Select above the Model Select, populated from `ai_provider_configs` filtered to `is_active=true`, deduped by provider name. Default selection = the purpose's `provider_id` if set, else the resolved provider.
- When provider changes, reset `model` to `null` (use provider default) so we don't carry a Google model into OpenRouter, etc.
- The **Model** Select reads its options from `PROVIDER_DEFAULTS[selectedProvider].models` (this already exists in `providerCatalog.ts`).
- Persist `provider_id` alongside the other fields in `saveMut` (the column already exists).
- Update `resolveProvider` callsites and the row header badge to prefer the explicit `provider_id` when set, so the card and the "Will send to provider as" hint stay accurate.
- Tidy the drawer header banner: replace the amber "Provider for this purpose is X — change it in Providers tab" with a neutral indigo note that explains the new behaviour ("Default provider comes from the Providers tab; override here per purpose if needed").
- Keep the existing "Reset to recommended defaults" button; extend it to also clear `provider_id` so reset returns to the scope-resolved provider.

No edge-function changes — `ai-runtime`/`ai-dispatcher` already read `ai_purposes.provider_id` to choose the provider, so wiring the UI is sufficient.

### Verification

1. Sign in as owner → AI Call Logs → "Clear" with "All logs" → list empties, toast shows real count.
2. Click an error row → full Google 403 payload renders with a Copy button.
3. Edit `Automation Rules` → Provider dropdown shows `google` and `openrouter`; switching to `openrouter` repopulates the model list; save → row header badge updates and `Test` runs against the new provider.
