## Audit findings

### 1. Two log tabs — different data, bad labels
- `AICallLogsTab` reads `ai_call_logs` (LLM provider calls — latency, fallback, errors).
- `AIToolLogsTab` reads `ai_tool_logs` (tool/function invocations — `get_membership_status`, etc.).
- They are NOT duplicates, but the labels "Call Logs" / "Tool Logs" tell the user nothing, and they share filter/clear UX.
- Fix: single **Logs** tab with a segmented control `[ LLM calls · Tool calls ]` and a shared toolbar (window, status, clear). Plumbing tab drops from 4 sub-tabs to 3 (Providers · Tools · Logs).

### 2. Handles tab — five surfaces per row, two editors for the same data
Today each `whatsapp_reply` card stacks:
1. Persona stub preview (read-only)
2. `KnowledgeForHandle` (shared)
3. `WhatsAppAISettings` (ops, writes legacy column)
4. `AIFlowBuilderSettings` (capture flow, writes legacy column)
5. Footer with **"Edit persona / model"** that opens **AIPurposesTab** — a second full editor of persona/provider/model/temperature

That's two editors writing the same `ai_purposes` row, plus embedded panels that still write to deprecated JSONB columns.

Fix: one `HandleCard` with these sections only:
- **Persona & tone** — inline editable Textarea (≤ 800 chars), provider/model select, temperature slider. No "Advanced" toggle. No `AIPurposesTab` mount.
- **Knowledge in use** — `KnowledgeForHandle` (already SSOT, keep).
- **Operational settings** — rendered from `ai_purposes.ops_config` directly (auto-reply delay, quiet hours, cadence, retries, capture-flow questions). Single save writes `ai_purposes`.
- **Test handle** — unchanged.

Result: one row = one editor = one table write. Removes the dual-editor confusion the user is flagging.

### 3. Deprecated layer still alive
DB has both the new SSOT and the old JSONB:

| Surface | New (SSOT) | Old (still written) |
|---|---|---|
| Persona | `ai_purposes.system_prompt` | `ai_knowledge` row `"Legacy persona for whatsapp_reply"` (4 595 chars, duplicates the prompt) |
| WhatsApp ops | `ai_purposes.ops_config` (added, never used) | `organization_settings.whatsapp_ai_config` JSONB |
| Lead nurture ops | `ai_purposes.ops_config` (added, never used) | `organization_settings.lead_nurture_config` JSONB |
| Capture flow | `ai_purposes.ops_config` (added, never used) | `organization_settings.whatsapp_ai_config.flow` |

The May 22 migration added `ops_config` + `allowed_tools` on `ai_purposes` and the new tabs, but the frontend (`WhatsAppAISettings`, `LeadNurtureSettings`, `AIFlowBuilderSettings`) and edge functions (`meta-webhook`, `lead-nurture-followup`, `_shared/ai-agent-brain`) still read/write the old JSONB. So we're paying SSOT cost with zero SSOT benefit.

### 4. Unused/dead files to delete after migration
- `src/components/settings/AIPurposesTab.tsx` — its only caller becomes the inline editor inside `HandleCard`.
- `src/components/settings/WhatsAppAISettings.tsx` — fields move into `HandleCard` ops section for `whatsapp_reply`.
- `src/components/settings/LeadNurtureSettings.tsx` — fields move into `HandleCard` ops section for `lead_nurture`.
- `src/components/settings/AIFlowBuilderSettings.tsx` — fields move into `HandleCard` ops section for `whatsapp_reply`.

---

## Plan

### Phase 1 — Frontend collapse (no DB changes)
1. **Logs**: build `AILogsTab.tsx` with a `Tabs` of `llm | tools` reusing the existing fetch/filter logic from `AICallLogsTab` and `AIToolLogsTab`. Update `PlumbingTab` to render `[Providers · Tools · Logs]`. Delete `AICallLogsTab.tsx` and `AIToolLogsTab.tsx`.
2. **Handles**: rewrite `HandlesTab.tsx` to render one `HandleCard.tsx` per row. `HandleCard` owns persona/provider/model/temperature inline (replaces the "Show model & sampling editors" toggle and the embedded `AIPurposesTab`).
3. Remove the `AIPurposesTab` import from `HandlesTab.tsx` and delete the file.

### Phase 2 — Backend SSOT cutover (one migration + edge-function edits)
4. Migration: backfill `ai_purposes.ops_config` from `organization_settings.whatsapp_ai_config` and `lead_nurture_config` for the matching purposes. Move capture-flow questions into `ai_purposes.ops_config.capture_flow`.
5. Edge functions: switch reads to `ai_purposes.ops_config`:
   - `supabase/functions/_shared/ai-agent-brain.ts` (drop the `whatsapp_ai_config` overlay path; rely on `buildSystemPrompt`).
   - `supabase/functions/meta-webhook/index.ts` (read auto-reply toggle from `ops_config`).
   - `supabase/functions/lead-nurture-followup/index.ts` (read cadence from `ops_config`).
6. Frontend `HandleCard` ops section reads/writes `ai_purposes.ops_config` only.
7. Delete the duplicate `ai_knowledge` row `"Legacy persona for whatsapp_reply"` (DB-only delete, ai_purposes.system_prompt is already the 177-char SSOT).
8. Delete `WhatsAppAISettings.tsx`, `LeadNurtureSettings.tsx`, `AIFlowBuilderSettings.tsx`.

### Phase 3 — Drop deprecated columns (after Phase 2 ships green)
9. Migration: `ALTER TABLE organization_settings DROP COLUMN whatsapp_ai_config, DROP COLUMN lead_nurture_config, DROP COLUMN ai_tool_config;` plus a `dr_block_writes`-safe migration. Update `src/integrations/supabase/types.ts` regenerates automatically.

### Acceptance checks
- AI Agent Hub renders 4 top tabs; Plumbing renders 3 sub-tabs.
- Each Handle row has exactly one editor; saving updates `ai_purposes` and nothing else.
- `rg "whatsapp_ai_config|lead_nurture_config"` returns zero matches in `src/` and `supabase/functions/`.
- Live WhatsApp message still routes through `ai-agent-brain` and uses the same persona text as `ai_purposes.system_prompt`.
- `ai_call_logs` and `ai_tool_logs` both visible under one Logs tab with working filters and clear.

### Out of scope
- `ai_memory`, `ai_dashboard_insights`, `ai_brain_health` view, IG comment automation, template generator, provider catalog.
- The repetitive-question bug on live WhatsApp (separate root-cause work; tracked under the AI brain conversation loop, not this UI audit).

### Open question
Phase 3 drops three JSONB columns from `organization_settings`. Confirm you want them dropped in the same release as Phase 2, or staged one release later with the columns left in place as read-only fallback for one week.
