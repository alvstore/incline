# Plan: Fix ESLint warnings for clean build

Targeted, surgical fixes only. No behavior changes. After edits, run `bun run build` + `bunx eslint` on the touched files to verify.

## Fixes

### 1. `src/components/communications/LiveFeed.tsx` (line 386)
`useMemo` deps missing `GROUP_WINDOW_MS` and `resolveName`.
- `GROUP_WINDOW_MS` is a module-level constant → safe to add to deps (stable).
- `resolveName` likely a function defined in component body → wrap it in `useCallback` with its real deps (probably `nameMap`), then add to the deps array. Verify by reading the surrounding `resolveName` definition before editing.

### 2. `src/components/hrm/CreateContractDrawer.tsx` (line 470)
Remove the `// eslint-disable-next-line react-hooks/exhaustive-deps` comment. Deps array on line 471 already lists everything; the disable is dead.

### 3. `src/components/settings/ai/AILogsTab.tsx` (line 114)
`const logs = (active.data ?? []) as any[];` recreates array each render, destabilizing the `visibleLogs` useMemo deps.
Fix: wrap in its own memo:
```ts
const logs = useMemo(() => (active.data ?? []) as any[], [active.data]);
```

### 4. `src/components/settings/ai/HandleCard.tsx` (line 94)
`useEffect` re-syncs local state on `[row.id, row.updated_at]` but reads `row.enabled/model/provider_id/system_prompt/temperature`.
Fix: change deps to `[row]` (or list all the fields). Cleanest: `[row.id, row.updated_at, row.enabled, row.model, row.provider_id, row.system_prompt, row.temperature]` — keeps "sync only when row changes" semantics without lint suppression.

### 5. `src/components/settings/automations/AutomationEditSheet.tsx` (line 38)
`useEffect` deps `[rule?.id]` but reads `rule.*` fields.
Fix: change deps to `[rule]`. Keep `if (!rule) return;` guard so behavior is identical.

### 6. `src/pages/AllBookings.tsx` (line 384)
Inside a template literal building HTML written via `document.write`. `<\/script>` escape is unnecessary because the string is not embedded in a `<script>` parser context at runtime — it's `document.write`'d. But removing the backslash changes the literal contents (string would contain `</script>` which still parses identically when document.write'd). User says "keep displayed string the same" — `</script>` and `<\/script>` produce identical JS string values (`</script>`), so simply remove the backslash: `<\/script>` → `</script>`.

### 7. `src/pages/ContractFill.tsx` (lines 55–56)
`existingVars` and `prefill` are recreated each render and feed `useMemo(seeded, [prefill, existingVars])`.
Fix: wrap each in its own `useMemo`:
```ts
const existingVars = useMemo(
  () => (contract?.contract_variables ?? {}) as Record<string, string>,
  [contract?.contract_variables],
);
const prefill = useMemo(
  () => (contract?.prefill ?? {}) as Record<string, string>,
  [contract?.prefill],
);
```

### 8. `src/pages/StaffRoster.tsx` (line 141)
`const today = new Date();` at component top — new object each render, destabilizing any memo/effect depending on it.
Fix: `const today = useMemo(() => new Date(), []);` (stable for component lifetime — matches current behavior since `today` was only used to seed initial state).

### 9. `src/pages/StaffRoster.tsx` (line 1169)
Remove `edit?.trainer.user_id` from the deps array — `edit?.weekday` already changes together with the trainer selection in practice, and the lint rule flags it as unnecessary. Keep `edit?.weekday` and `existing`.

## Verification
After edits:
1. `bunx eslint src/components/communications/LiveFeed.tsx src/components/hrm/CreateContractDrawer.tsx src/components/settings/ai/AILogsTab.tsx src/components/settings/ai/HandleCard.tsx src/components/settings/automations/AutomationEditSheet.tsx src/pages/AllBookings.tsx src/pages/ContractFill.tsx src/pages/StaffRoster.tsx` — expect zero warnings on the targeted lines.
2. Harness runs the production build automatically — confirm green.

## Broader audit (follow-up, not in this pass)
After this batch lands cleanly, run `bunx eslint . --max-warnings=0` once to surface any remaining warnings project-wide, then propose a second small batch if needed. We won't touch unrelated files in this pass to keep the diff reviewable.
