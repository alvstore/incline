
# AI Agent Hub — SSOT Redesign

## 1. Why this rebuild

Today `/settings?tab=ai-agent` has **9 tabs**, and the mental model is broken:

| Tab | What it edits | Where it writes |
|---|---|---|
| Dashboard | — | reads `ai_tool_logs` |
| **Brain** | "shared knowledge" | `ai_knowledge` |
| **Purposes** | per-handle prompt + model + temp | `ai_purposes` (incl. a 4,595-char prompt for `whatsapp_reply`) |
| Tools | toggles | local |
| Auto-Reply | ops toggles for the `whatsapp_reply` handle | `whatsapp_ai_config` |
| Lead Capture | flow builder for capture handle | `lead_capture_*` |
| Lead Nurture | cadence for `lead_nurture` handle | `organization_settings.lead_nurture_config` |
| Providers | LLM keys / models | `ai_provider_configs` |
| Call Logs | — | reads logs |

Two concrete failures:

1. **Brain vs Purposes overlap.** Both inject text into the system prompt. A staff member editing "tone" doesn't know whether to use Purpose.system_prompt or a Brain entry. Result: the `whatsapp_reply` purpose still carries a 4.6 KB persona blob even after the Brain was introduced — exactly the duplication we set out to remove last loop.
2. **Three separate handles, three different UIs.** WhatsApp Reply, Lead Capture, Lead Nurture are all `ai_purposes` rows under the hood, but each gets a hand-rolled tab with its own layout, terminology, and save logic. There is no one place to ask "what does the Lead Nurture handle do?".

## 2. Target model — one sentence each

- **Knowledge** = what the AI knows (facts, offers, rules). One row = one fact, scoped to one or many handles. Edited in one place. Lives in `ai_knowledge`.
- **Handles** = the workers (WhatsApp Reply, Lead Nurture, Lead Capture, Review Reply, Fitness Plan…). Each handle has: a short **persona/tone**, a **model + temperature**, its **operational settings** (channel toggles, cadence, flow), and a list of which **tools** it may call. Lives in `ai_purposes` + a small JSONB `ops_config`.
- **Plumbing** = Providers (LLM keys) + Tool Registry.
- **Activity** = Dashboard + Logs.

Rule: a fact never lives on a Handle; a persona never lives in Knowledge.

## 3. New tab layout (4 tabs, was 9)

```text
AI Agent Hub
├─ Overview      → KPIs, live activity, health flags, "needs attention"
├─ Knowledge     → CRUD over ai_knowledge (the Brain), with topic facets
├─ Handles       → One card per ai_purposes row, expandable to full editor
│                  (persona · model · ops · tools · test)  ← absorbs
│                  Auto-Reply, Lead Capture, Lead Nurture, Purposes
└─ Plumbing      → Providers · Tool Registry · Logs (sub-tabs)
```

Removed top-level tabs: **Brain** (renamed Knowledge), **Purposes**, **Auto-Reply**, **Lead Capture**, **Lead Nurture**, **Call Logs**, **Tools** — all folded into the four above.

## 4. The Handle card — single source of truth per worker

Each handle is one expandable card. Sections, in order:

1. **Header** — title, on/off switch, provider+model chip, health badge, "Test" button.
2. **Persona & Tone** — short textarea (≤ 600 chars, soft-warn over). This replaces the multi-KB `system_prompt`. Everything factual moves to Knowledge.
3. **Knowledge in use** — read-only list of `ai_knowledge` rows whose `applies_to` includes this purpose (with "+ Add knowledge" deep-link that opens the Knowledge drawer pre-scoped).
4. **Operational settings** — schema is purpose-aware:
   - `whatsapp_reply` → auto-reply toggle, business hours, hand-off rules, do-not-contact respect.
   - `lead_nurture` → cadence (T+1, T+3, T+7), max nudges, quiet hours.
   - `lead_capture` → flow steps editor.
   - others → none (collapsed).
   Stored as `ai_purposes.ops_config jsonb` so every handle uses the same save path.
5. **Tools** — checkbox list filtered by `risk` level; writes to `ai_purposes.allowed_tools text[]`.
6. **Model & sampling** — provider override, model, temperature, max tokens (as today, but tucked behind "Advanced").
7. **Sandbox** — inline "Test message" box that calls `ai-test-purpose` with a user-supplied input and shows the rendered system prompt + reply.

## 5. Backend changes

```sql
-- 1. One JSONB blob per handle for operational settings.
ALTER TABLE ai_purposes
  ADD COLUMN IF NOT EXISTS ops_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS allowed_tools text[] NOT NULL DEFAULT '{}';

-- 2. Backfill from the legacy tables.
UPDATE ai_purposes p SET ops_config = jsonb_build_object(
  'auto_reply_enabled', w.enabled,
  'business_hours',     w.business_hours,
  'handoff',            w.handoff_rules,
  'respect_dnc',        true
) FROM whatsapp_ai_config w
WHERE p.purpose='whatsapp_reply' AND p.branch_id IS NOT DISTINCT FROM w.branch_id;

UPDATE ai_purposes p SET ops_config = COALESCE(
  (SELECT value->'lead_nurture_config' FROM organization_settings
   WHERE key='lead_nurture'), '{}'::jsonb)
WHERE p.purpose='lead_nurture';

-- 3. Strip factual content out of system_prompt, keep persona only.
-- Migrate the long blobs (e.g. 4,595-char whatsapp_reply prompt) into
-- ai_knowledge rows (topic='persona_facts', applies_to=ARRAY['whatsapp_reply'])
-- and leave a short persona stub in ai_purposes.system_prompt.

-- 4. Mark the legacy tables read-only via trigger, then drop next release:
--    whatsapp_ai_config.system_prompt, lead_nurture_config.nurture_prompt
--    (already nulled), whatsapp_ai_config.business_hours/handoff_rules.
```

Edge code (`_shared/ai-prompt.ts::buildSystemPrompt`) already assembles
persona + ai_knowledge + dynamic context — no change. We only delete the
two remaining overlay reads from the old tables.

## 6. Frontend changes

- **New** `src/components/settings/ai/HandlesTab.tsx` — list of `ai_purposes` rows; each row renders `HandleCard`.
- **New** `src/components/settings/ai/HandleCard.tsx` — expandable, holds the 7 sections above; opens a Sheet for the full editor (per the project's "no Dialog for forms" rule).
- **New** `src/components/settings/ai/handleOps/` — one tiny component per purpose (`WhatsAppReplyOps`, `LeadNurtureOps`, `LeadCaptureOps`). They read/write a slice of `ai_purposes.ops_config`. This is where the existing `WhatsAppAISettings`, `LeadNurtureSettings`, `AIFlowBuilderSettings` bodies move — they just lose their own save logic and use the shared handle mutation.
- **Renamed** `AIBrainTab.tsx` → `KnowledgeTab.tsx`; gains topic facets (Offers · FAQs · Behaviour · Identity · Persona facts) and a "Used by N handles" column so authors see scope before saving.
- **Rewritten** `AIAgentControlCenter.tsx` — 4 tabs, no purpose-specific imports.
- **Deleted** top-level files (after their bodies move): `WhatsAppAISettings.tsx`, `LeadNurtureSettings.tsx`, `AIFlowBuilderSettings.tsx`, `AIPurposesTab.tsx`. `AICallLogsTab` and `AIToolLogsTab` move under Plumbing.

## 7. UX details (Vuexy)

- Tab strip → 4 pills, no horizontal scroll on the current 1113 px viewport.
- Handle cards: `rounded-2xl shadow-lg shadow-slate-200/50`, indigo gradient header for the active handle, collapsed by default; one open at a time.
- Health chips reuse the colour map already in `AIBrainTab` (emerald healthy / amber warn / red error / slate disabled).
- "Needs attention" strip on Overview surfaces any handle with `prompt_too_short`, `high_error_rate`, missing provider key, or no knowledge linked.
- All editors stay in right-side Sheets (`sm:max-w-xl`), sticky header + footer, per the project's strict drawer policy.

## 8. Migration & rollout

1. Ship the migration (additive: `ops_config`, `allowed_tools`, backfill).
2. Ship the new tabs **behind** the old ones for one release — feature flag `settings.ai_v2_layout` on `organization_settings`. Default ON for owners only first.
3. After 1 week of clean logs, delete legacy tab files and drop the overlay columns.

## 9. Out of scope

- Changing the runtime prompt builder (`buildSystemPrompt`) — already SSOT.
- Touching `ai_memory`, IG comment automation, WhatsApp template generator, or `ai_provider_configs` schema.
- New AI features. This is a pure consolidation + redesign.

## 10. Acceptance checks

- 4 tabs render at 1113 px without overflow.
- `ai_purposes.system_prompt` for every row ≤ 600 chars after migration.
- Every operational setting visible in the new Handle card has exactly one writer (`ai_purposes`) — no writes left to `whatsapp_ai_config` or `organization_settings.lead_nurture_config`.
- Same test message run through `ai-test-purpose` for `whatsapp_reply` before vs after migration produces a system prompt that differs only in section ordering (verified by length + hash diff).
- An owner can change the gym's address in **one** Knowledge row and both WhatsApp Reply and Lead Nurture pick it up on the next message.
