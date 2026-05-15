# Wire AI Control Center into AI Agent Hub (single source of truth)

## Audit findings

There are two AI hubs today:

1. **Settings → AI Agent Hub** (`src/components/settings/AIAgentControlCenter.tsx`)
   Tabs: Dashboard · Tools · Auto-Reply · Lead Capture · Lead Nurture · Providers.
   Surfaces tool logs, WhatsApp AI flow builder, lead nurture, and provider keys.
   Reachable from Settings → AI Agent.

2. **Standalone `/ai-control-center`** (`src/pages/AIControlCenter.tsx`, added in Wave 2)
   Tabs: Purposes (edit prompt/model/temperature for `ai_purposes`) · Recent Calls (`ai_call_logs`).
   Owner/admin only. **Not linked from any nav** — that's why you can't see it.

The Purposes editor and AI call logs are net-new SSOT capabilities. Everything else in the standalone page already overlaps conceptually with the hub. Two pages = confusion. We collapse to one.

## Plan

**1. Add two tabs inside `AIAgentControlCenter.tsx`:**
   - `Purposes` — full prompt/model/temperature editor for every row in `ai_purposes` (the canonical SSOT). Same Sheet-based editor pattern as the standalone page.
   - `AI Call Logs` — `ai_call_logs` feed (purpose, provider, model, status, duration, fallback, error). Auto-refresh.

   Final tab order: Dashboard · **Purposes** · Tools · Auto-Reply · Lead Capture · Lead Nurture · Providers · **AI Call Logs**.

**2. Lift the editor + logs UI** from `src/pages/AIControlCenter.tsx` into two new internal components inside `src/components/settings/` (`AIPurposesTab.tsx`, `AICallLogsTab.tsx`). Pure UI move, no logic changes.

**3. Delete the standalone page and route:**
   - Remove `src/pages/AIControlCenter.tsx`.
   - Remove the `/ai-control-center` lazy import + `<Route>` from `src/App.tsx`.
   - Anyone hitting `/ai-control-center` will fall through to `NotFound`. (Optional: add a redirect to `/settings?tab=ai-agent` — will include if you want.)

**4. Access control:** Settings page already gates the AI Agent tab to owner/admin. No new RBAC needed.

**5. Verify:** open Settings → AI Agent → Purposes; edit a row; confirm `ai_purposes` row updates and the change reflects in the `ai_call_logs` tab on next AI call.

## Out of scope

- No edge function changes (Wave 1+2 SSOT runtime stays as-is).
- No schema changes.
- No new routes.

## Files touched

- `src/components/settings/AIAgentControlCenter.tsx` — add 2 tabs.
- `src/components/settings/AIPurposesTab.tsx` — new (extracted).
- `src/components/settings/AICallLogsTab.tsx` — new (extracted).
- `src/pages/AIControlCenter.tsx` — delete.
- `src/App.tsx` — remove route + lazy import.
