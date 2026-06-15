# Dynamic AI Memory System

## Injection Strategy (from audit)

1. **New table `ai_dynamic_memory`** — `ai_knowledge` is embedding/RAG-shaped and wrong for short slang→intent rules. A dedicated table keeps SELECT < 5ms (in-mem cache, small row count).
2. **Inject at two layers** in `ai-agent-brain.ts` / `ai-prompt.ts`:
   - **Deterministic layer:** load rows into a per-request `Map<phrase, {intent, instruction}>`, used by `classifyHinglishIntent()` and `FAKE_NAME_TOKENS` checks (so DB rules override/extend the hardcoded regexes without removing them as fallback).
   - **LLM layer:** append a `[DYNAMIC TRAINING RULES]` block to the system prompt right after `<strict_rules>` in `buildSystemPrompt()`.
3. **UI lives inside `AIAgentControlCenter`** as a new "Training" sub-tab — no new admin page, matches existing Handles/Knowledge tab pattern.

---

## Epic 1 — Schema (migration)

Table `ai_dynamic_memory`:

| col | type |
|---|---|
| id | uuid pk |
| phrase_or_pattern | text not null (lowercased, unique) |
| intent_category | text not null (`location` / `pricing` / `timeline` / `handoff` / `decline` / `name_block` / `custom`) |
| correction_instruction | text not null |
| is_active | boolean default true |
| match_type | text default `'contains'` (`'exact' \| 'contains' \| 'regex'`) |
| priority | int default 100 |
| created_by | uuid → auth.users |
| created_at / updated_at | timestamptz |

Index: `(is_active, priority desc)`.
GRANTs: `authenticated` SELECT/INSERT/UPDATE/DELETE, `service_role` ALL, no `anon`.
RLS: SELECT for `authenticated`; INSERT/UPDATE/DELETE gated by `has_role(auth.uid(),'owner'|'admin')`.
Seed 8 baseline rows from existing hardcoded regexes (kha pr h / kaha / kitna / fees / kab khulega / human / agent / nahi).

## Epic 2 — Brain Injector

`supabase/functions/_shared/ai-dynamic-memory.ts` (new, ~60 lines):
- `loadDynamicMemory(supabase)` → `{ rows, promptBlock, classify(text) }`
- In-process cache, 60s TTL, keyed by nothing (global).
- `promptBlock`: `<dynamic_training_rules>` … `</dynamic_training_rules>` with bullet list `phrase → instruction`.
- `classify(text)`: returns matching row (exact > regex > contains, ordered by priority).

`ai-prompt.ts`: in `buildSystemPrompt()`, after pushing `<strict_rules>`, push `dynMem.promptBlock` if non-empty. Remove the hardcoded Hinglish dictionary from `<strict_rules>` (it becomes seed data in DB) but keep the meta-rule sentence ("ANSWER first, THEN re-ask").

`ai-agent-brain.ts`: 
- Load dynamic memory once at top of handler (parallel with existing `loadMemory`).
- `classifyHinglishIntent()` first checks DB rows, then falls back to hardcoded regexes.
- `looksLikeRealName()` rejects any phrase appearing in DB with `intent_category='name_block'` (union with `FAKE_NAME_TOKENS`).
- Pass `dynMem` to `buildSystemPrompt` via new optional field on `BuildSystemPromptInput`.

Latency budget: one indexed SELECT, expected < 5ms; cached 60s.

## Epic 3 — Admin UI

New file `src/components/settings/ai/AITrainingTab.tsx`:
- Mounted as new sub-tab `"Training"` inside `AIAgentControlCenter` (alongside Handles/Knowledge/Ops).
- TanStack Query: `useQuery(['ai_dynamic_memory'])` + `useMutation` for create/update/toggle/delete with `invalidateQueries`.
- Table built with `@tanstack/react-table` (already in deps if present; else fall back to existing styled table primitive — verify in build step). Columns: Phrase · Intent (badge) · Instruction (truncated) · Active (Switch) · Priority · Actions.
- **Add/Edit uses right-side Sheet** (per project "No Dialog" rule), `sm:max-w-lg`, sticky footer Save/Cancel, Zod + RHF.
- Intent badges colored per design system (location=indigo, pricing=amber, timeline=violet, handoff=red, decline=slate, name_block=blue, custom=emerald).
- Inline test input: "Type a sample message" → live shows which rule (if any) would match — gives admins instant feedback.

## Files

**New:**
- `supabase/functions/_shared/ai-dynamic-memory.ts`
- `src/components/settings/ai/AITrainingTab.tsx`
- `src/components/settings/ai/AITrainingRuleSheet.tsx`
- DB migration

**Edited:**
- `supabase/functions/_shared/ai-prompt.ts` (inject block, drop inline Hinglish dict)
- `supabase/functions/_shared/ai-agent-brain.ts` (load + extend classify/name-guards, log `[AI Tool Call Attempt]` with matched rule id)
- `src/components/settings/AIAgentControlCenter.tsx` (mount new tab)

## Out of scope

No changes to `ai_knowledge`, `ai_purposes`, embeddings, webhook routing, or any non-AI surface. Hardcoded regexes stay as fallback (defense-in-depth) — not deleted.
