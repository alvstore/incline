## Audit findings

Today the project runs **5 different AI code paths** that all hit the Lovable gateway directly with their own prompts, configs, and model names. There is no single source of truth and the UI cannot fully control them.

**Brains (duplicated reply logic):**
1. `_shared/ai-agent-brain.ts` — `runUnifiedAgent` (canonical, used by `meta-webhook`)
2. `whatsapp-webhook/index.ts` lines 1040–1450 — full duplicate prompt + 3-step tool loop (the one WhatsApp actually runs)
3. `ai-auto-reply/index.ts` — third copy of the same idea

**One-shot AI callers (each builds its own prompt + fetch):**
- `lead-nurture-followup`, `score-leads`, `automation-brain`,
- `ai-generate-whatsapp-templates`, `ai-draft-campaign-message`,
- `ai-dashboard-insights`, `generate-fitness-plan`, `google-reviews-brain`

**Config sources (fragmented):**
- `settings.whatsapp_ai_config` jsonb (system_prompt, model, lead_capture, delays)
- `ai_provider_configs` table (providers, models, fallback)
- Hard-coded prompts inside each edge function
- Hard-coded model strings (`google/gemini-3-flash-preview`) scattered everywhere

**UI surfaces (also fragmented):**
- `WhatsAppAISettings`, `AIAgentControlCenter`, `AIFlowBuilderSettings`, `AIProvidersSettings`, `AI Studio` tab in `CommunicationTemplatesHub` — each edits a different slice; none is the SSOT.

**Dispatcher already exists but is barely used:** `_shared/ai-dispatcher.ts` (`callAI`) supports provider routing + fallback. Only a couple of callers use it.

---

## Goal

One brain. One config table. One UI. Every AI feature (WhatsApp replies, lead scoring, nudges, templates, dashboard insights, fitness plans, review replies, automation rules) flows through the same pipeline and is configurable from the UI without touching code.

---

## Plan

### 1. Single AI runtime — `_shared/ai-runtime.ts`

New module exposing exactly two entry points used by **every** edge function:

```text
runAgent({ purpose, branchId, userMessage?, messages?, context?, tools? })
   → unified chat / agent loop (replaces the 3 brains)
generateOnce({ purpose, branchId, input, schema? })
   → single-shot text or structured output (replaces the 8 one-shot callers)
```

Both internally use `callAI` from the existing dispatcher, so provider/model/fallback is honored. `generateOnce` uses Vercel AI SDK `Output.object` when a Zod schema is provided.

### 2. Single config table — `ai_purposes`

Replaces `whatsapp_ai_config` jsonb soup and scattered hard-coded prompts.

```text
ai_purposes
├─ id
├─ branch_id (nullable = global default)
├─ purpose (enum/text: whatsapp_reply, lead_nurture, lead_score,
│           campaign_draft, template_generate, dashboard_insight,
│           fitness_plan, review_reply, automation_rule, ...)
├─ enabled
├─ provider_id  → ai_provider_configs.id   (nullable = use default)
├─ model        (nullable = provider default)
├─ system_prompt
├─ temperature, max_tokens, reply_delay_seconds
├─ tools_allowed text[]   (subset of tool registry)
├─ guards jsonb           ({ non_fitness_redirect, quiet_hours, ... })
├─ extra jsonb            (purpose-specific knobs e.g. lead_capture fields)
└─ updated_at, updated_by
```

`runAgent`/`generateOnce` always load the row for `(purpose, branchId)` with global fallback. Nothing in code carries a default prompt or model.

### 3. Knowledge / memory — `ai_knowledge` + `ai_memory`

- `ai_knowledge(branch_id, topic, content, embeddings?)` — gym facts, FAQs, tone, escalation rules; injected by `runAgent` based on classified intent. Replaces `hydrateGymFacts` and inline canned text.
- `ai_memory(phone, branch_id, profile jsonb, facts jsonb, intent, asked_questions text[], summary, last_seen)` — replaces today's free-text `conversation_summary`.

Both fully editable from UI.

### 4. Tool registry — `_shared/ai-tool-registry.ts`

Single Zod-typed registry (extends current `ai-tools.ts` + `ai-tool-executor.ts`):

```text
capture_lead, polite_redirect, mark_intent, remember_fact,
book_class, lookup_member, escalate_to_human, send_template, ...
```

Each purpose row whitelists which tools the agent may call. No more JSON-scraping inside webhooks.

### 5. Observability — `ai_call_logs` (already exists, formalize)

Every `runAgent`/`generateOnce` call writes one row: purpose, branch, provider, model, tokens, latency, tool calls, validation errors, final reply kind. Powers SystemHealth and the new UI.

### 6. Single UI — `Settings → AI Control Center`

Collapses today's 4–5 separate AI screens into one tabbed page:

- **Purposes** (table of `ai_purposes`): toggle, choose provider/model, edit prompt, pick allowed tools, set guards, "Test" button → calls `generateOnce` and shows reply.
- **Providers** (existing `AIProvidersSettings` content, kept).
- **Knowledge Base** (`ai_knowledge` CRUD per branch, with topics).
- **Memory Inspector** (`ai_memory` viewer per phone, with reset button).
- **Logs** (`ai_call_logs` with filters by purpose/branch/status).
- **Playground** (free-form runner that lets owner pick purpose + send a test prompt).

All training/configuration happens here. Code only ships defaults via a seed migration.

### 7. Deletions / consolidation

- Delete duplicate brain block in `whatsapp-webhook/index.ts` (lines ~1040–1450), `tryExtractInteractiveJson`, hard-coded summarizer fetch, canonical-list overrides. WhatsApp webhook becomes thin: parse → `runAgent({ purpose: 'whatsapp_reply' })` → translate reply kind to Meta payload.
- Delete `ai-auto-reply` edge function (third brain copy). Anything still pointing at it is rerouted to `runAgent`.
- Refactor `lead-nurture-followup`, `score-leads`, `automation-brain`, `ai-generate-whatsapp-templates`, `ai-draft-campaign-message`, `ai-dashboard-insights`, `generate-fitness-plan`, `google-reviews-brain` to a single `generateOnce({ purpose: '<their purpose>' })` call. Each loses its inline `fetch('https://ai.gateway.lovable.dev/...')` block and its hard-coded prompt.
- Retire `whatsapp_ai_config` jsonb after data migration into `ai_purposes`.
- Retire scattered prompt strings; seed them into `ai_purposes` once.
- Collapse `WhatsAppAISettings`, `AIAgentControlCenter`, `AIFlowBuilderSettings`, AI Studio tab into the new Control Center; keep `AIProvidersSettings` as a sub-tab.

### 8. Migration & rollout

1. Migration: create `ai_purposes`, `ai_knowledge`, `ai_memory`; seed purposes from current hard-coded prompts; backfill `whatsapp_ai_config` → `ai_purposes('whatsapp_reply', branch)`.
2. Ship `_shared/ai-runtime.ts` + tool registry; add unit tests for `runAgent` reply schema.
3. Refactor edge functions one at a time (webhook first, then one-shots). Each PR removes its old fetch block.
4. Build new UI; hide old AI settings pages behind a feature flag, then delete after one week of green logs.
5. Final cleanup: delete `ai-auto-reply` function, drop `whatsapp_ai_config` column, remove `tryExtractInteractiveJson`.

### Acceptance

- `rg "ai.gateway.lovable.dev" supabase/functions` returns hits **only** in `_shared/ai-dispatcher.ts`.
- Every prompt, model, tool list, and guard for every AI feature is editable from the UI; redeploys are not required to change behavior.
- The job-seeker scenario (and any other non-fitness intent) routes through the same `runAgent` path that WhatsApp uses, with the redirect rule coming from the `whatsapp_reply` purpose row.
- `ai_call_logs` shows one row per AI invocation across the whole product, tagged by `purpose`.

---

### Technical details (for engineers)

- `runAgent` returns a discriminated union `{ kind: 'text'|'list'|'buttons'|'handoff'|'lead_captured'|'tool_only', payload }`; webhooks switch on `kind`.
- Use Vercel AI SDK (`npm:ai`, `npm:@ai-sdk/openai-compatible`) inside the runtime; keep `callAI` for non-SDK providers (groq, mistral, ollama) via the existing dispatcher.
- `stopWhen: stepCountIs(50)` for tool loops.
- All writes go through `dispatchCommunication` as today; the runtime never sends messages itself.
- `ai_purposes`, `ai_knowledge`, `ai_memory` get RLS: owner/admin write, manager read+edit own branch, staff read.