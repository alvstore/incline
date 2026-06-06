## Audit summary

**1. Why LLM Logs never show Instagram / Messenger**
- `runUnifiedAgent` (used by both WhatsApp and Meta webhooks) hard-codes `purpose: "whatsapp_reply"` regardless of platform, so every IG/Messenger reply is logged as `whatsapp_reply` — they're hidden inside the same bucket. There is no `platform` column on `ai_call_logs`.
- The blank "—" rows in the Logs view are duplicate inserts: `ai-dispatcher.logCall` writes a row without `purpose`/`branch_id`, then `ai-runtime.generateOnce` writes a second, properly-tagged row.

**2. Why Live Activity Feed is empty**
- Table `ai_tool_logs` exists and is wired into the UI, but **no edge function ever inserts into it**. The agent's tool dispatcher in `ai-agent-brain.ts` executes tools but never logs them.

**3. Is IG/Messenger AI guaranteed off?**
- Current DB state: `ai_purposes.whatsapp_reply.ops_config = { auto_reply_enabled: false, channels: { whatsapp:{enabled:true}, instagram:{enabled:false}, messenger:{enabled:false} } }`.
- `meta-webhook` calls `isAiChannelEnabled(branchId, platform)` and short-circuits **before** claim/runUnifiedAgent.
- Same gate is applied in `process-ig-comment-runs` and `lead-nurture-followup`.
- **Verdict:** Safe to flip Instagram live for inbox/visibility — even if you later set `auto_reply_enabled=true` for WhatsApp, IG and Messenger AI stay off because of the per-channel sub-toggle. WhatsApp is the only channel that will reply.

---

## Fix plan

### A. Schema — `supabase/migrations/<new>.sql`
- `alter table ai_call_logs add column platform text, add column contact_key text;`
- `alter table ai_tool_logs add column platform text;` (column already has branch_id, phone_number)
- Backfill: best-effort `update ai_call_logs set platform='whatsapp' where platform is null and purpose in ('whatsapp_reply','context_extract');` — historic rows stay grouped under WhatsApp.

### B. Runtime — `supabase/functions/_shared/ai-runtime.ts`
- Extend `GenerateOnceOptions` with `platform?: 'whatsapp'|'instagram'|'messenger'` and `contactKey?: string`.
- Pass both into both `logCall` paths (success/fallback/error).

### C. Dispatcher — `supabase/functions/_shared/ai-dispatcher.ts`
- Remove the redundant `logCall` insert (or guard it to only fire when invoked outside `generateOnce`). This kills the "—" blank-purpose duplicates.

### D. Brain (callers) — `supabase/functions/_shared/ai-agent-brain.ts`
- Wherever `generateOnce` is called (`whatsapp_reply`, `context_extract` paths), forward the inbound `platform` and `contact_key` already in scope.
- Add `logAiToolCall(supabase, { platform, branch_id, contact_key, tool_name, args_preview, status, duration_ms, error_message })` helper.
- Wrap the tool execution loop: capture start ts → run tool → write one `ai_tool_logs` row on success or failure. `args_preview` = first 500 chars of JSON.stringify(args). This makes the Live Activity Feed start populating immediately.

### E. UI — `src/components/settings/ai/AILogsTab.tsx`
- LLM query: also select `platform, contact_key`. Render a small platform badge per row (WA green / IG pink / Messenger blue).
- Add a platform filter chip row (All / WhatsApp / Instagram / Messenger) next to the existing status chips.
- Change the default window from `"7"` (which reads as "Older than 7 days" — confusing) to `"all"` so recent activity is visible by default.

### F. Overview Live Activity Feed
- No code change needed beyond (D). Already reads `ai_tool_logs` and auto-refreshes every 10s; will populate once the brain starts logging tool calls.

### G. Verification
- Send one WhatsApp message → expect 1 `whatsapp_reply` row with `platform='whatsapp'`, plus N `ai_tool_logs` rows (memory_save, context_extract, etc.) visible in the Live Activity Feed.
- Send one IG DM with `instagram.enabled=false` → expect **zero** new `ai_call_logs` / `ai_tool_logs` rows; only a meta-webhook console line `[AI:instagram] skipped — channel disabled`.
- Temporarily flip `instagram.enabled=true` → expect a new `ai_call_logs` row tagged `platform='instagram'` (proving the platform tag works).

### Files touched
- 1 new migration
- `supabase/functions/_shared/ai-runtime.ts`
- `supabase/functions/_shared/ai-dispatcher.ts`
- `supabase/functions/_shared/ai-agent-brain.ts`
- `src/components/settings/ai/AILogsTab.tsx`
