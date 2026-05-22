
# AI Brain & Context — Single Source of Truth

## 1. Audit findings (where persona/context lives today)

We currently have **5 places** that feed the same AI prompt, edited from **3 different UIs**, with **2 separate handles** (`whatsapp_reply`, `lead_nurture`) reading them inconsistently.

| # | Source | Edited from | Read by | Problem |
|---|---|---|---|---|
| 1 | `ai_purposes.system_prompt` (per purpose, branch-aware) | Settings → AI Agent → **Purposes** | `ai-runtime.generateOnce` and `ai-agent-brain` (SSOT, the intended one) | Correct layer, but not the only one. |
| 2 | `whatsapp_ai_config.system_prompt` (legacy "overlay") | Settings → AI Agent → **Auto-Reply** | `ai-agent-brain.ts` line 202 — appended *after* purpose prompt | Duplicate persona surface for WhatsApp only. Drift vs purpose row. |
| 3 | `organization_settings.lead_nurture_config.nurture_prompt` | Settings → AI Agent → **Lead Nurture** | `lead-nurture-followup` injects into `userMessage` (not system) | Duplicate persona surface for nurture only. Different injection point. |
| 4 | Hardcoded blocks in `ai-agent-brain.ts` (FORMATTING RULES, CRITICAL BEHAVIORAL RULE, ABSOLUTE IDENTITY RULE, fallback "You are a helpful gym assistant…") | Code only | WhatsApp/Meta replies only | Nurture path never gets these rules → tonal/format drift between the two handles. |
| 5 | `ai_knowledge` table (branch + global, topic-tagged) | **No UI exists** | `ai-agent-brain` only (loadKnowledge) — `0 rows` in prod | Designed as the brain, but unreachable and unused. |

Plus hydrated facts (`hydrateGymFacts`) from DB — deterministic, fine to keep.

**Net effect:** the same intent ("be warm, short, push the New Year offer") has to be typed into 2-3 different boxes; WhatsApp gets behavioral rules nurture never sees; `ai_knowledge` (the actual "brain") is empty and invisible.

The user-visible symptom: "we have ai context, also ai brain, frontend, hardcoded… two handles" — exactly the picture above.

---

## 2. Target architecture — one brain, many handles

```text
                     ┌──────────────────────────┐
                     │   ai_knowledge (BRAIN)   │
                     │  gym facts, offers, FAQs │
                     │  branch + global, topics │
                     └────────────┬─────────────┘
                                  │ shared by ALL purposes
        ┌─────────────────────────┼─────────────────────────┐
        ▼                         ▼                         ▼
 ai_purposes               ai_purposes               ai_purposes
 whatsapp_reply            lead_nurture              review_reply / …
 (persona + tools          (persona + cadence        (per-handle persona)
  + guards)                 + guards)
        │                         │                         │
        ▼                         ▼                         ▼
 ai-agent-brain        lead-nurture-followup        other edge fns
 (WhatsApp/Meta)       (cron nudges)
```

Two **purpose rows** = two handles, each with its own persona/temperature/tools.
One **knowledge table** = one brain shared by every handle.
**No** overlays, **no** hardcoded persona, **no** per-tab prompt boxes.

---

## 3. Changes

### 3.1 Database (migration)

- Backfill content: move `whatsapp_ai_config.system_prompt` into `ai_purposes(purpose='whatsapp_reply').system_prompt` (append if non-empty and not already present), then **null it out**.
- Backfill content: move `organization_settings.lead_nurture_config.nurture_prompt` into `ai_purposes(purpose='lead_nurture').system_prompt`, then drop that key from the JSONB.
- Seed `ai_knowledge` with the currently-hardcoded behavioral rules as global rows:
  - `topic='format_rules'`, `topic='behavior_rules'`, `topic='identity_rules'` (the member-first rule).
- Add `ai_knowledge.priority smallint default 100` and `ai_knowledge.applies_to text[] default '{all}'` so a row can be scoped to specific purposes (e.g., `{'whatsapp_reply'}`) or left global.
- Optional view `ai_brain_health` aggregating: empty purposes, stale knowledge, recent `ai_call_logs` error rate per purpose — feeds the self-healing dashboard.

### 3.2 Edge code (one prompt assembler)

- New shared helper `supabase/functions/_shared/ai-prompt.ts::buildSystemPrompt({ purpose, branchId, context })` that returns the final system string for **every** purpose, in this fixed order:
  1. `ai_purposes.system_prompt` (the persona for this handle)
  2. `ai_knowledge` rows where `applies_to` contains `purpose` or `'all'`, ordered by `priority`
  3. Deterministic `hydrateGymFacts(branchId)` block
  4. Per-call dynamic context (member identity, missing fields, etc.) passed in as `context`
- Rewrite `ai-agent-brain.ts` to call this helper — delete the inline `FORMATTING RULES / CRITICAL BEHAVIORAL RULE / ABSOLUTE IDENTITY RULE / customPrompt fallback` strings.
- Rewrite `lead-nurture-followup` to call this helper too (currently it stuffs `nurturePrompt` into the user message — that path goes away).
- Both handlers now produce structurally identical prompts; only the `ai_purposes` row differs.

### 3.3 Frontend (collapse the 3 tabs into 1 brain + N handles)

Settings → AI Agent restructured:

- **Brain** (new) — CRUD over `ai_knowledge`. Columns: Topic, Title, Applies to (multi-select of purposes or "All"), Branch (global / specific), Priority, Active.
- **Handles** — one row per `ai_purposes` record (whatsapp_reply, lead_nurture, review_reply, …). Click → drawer with: persona prompt, model/provider, temperature, tools_allowed, guards, "Preview merged prompt" that calls the new helper and shows exactly what the LLM will see.
- **Auto-Reply** tab keeps only the *operational* toggles (bot on/off, working hours, reply delay) — the persona textarea is removed.
- **Lead Nurture** tab keeps only the *cadence* controls (enabled, delay_hours, max_retries, run-now, stats) — the prompt textarea is removed.

Result: one place to write what the AI knows (Brain), one place per handle to shape *how* it speaks, zero overlap.

### 3.4 Self-learning & self-healing (lightweight, no new infra)

- **Self-learning loop:** nightly job scans the last 24h of `whatsapp_messages` where the AI asked the same question ≥3 times or the user replied with negative-intent regex, summarises with `generateOnce({purpose:'dashboard_insight'})`, and **proposes** new `ai_knowledge` rows (status `suggested`) for an admin to one-click approve in the Brain tab.
- **Self-healing loop:** `ai_brain_health` view + a card on the AI Agent Dashboard flags: purpose disabled, prompt < 50 chars, error rate > 5% in last 1k calls, knowledge older than 90 days. Each flag has a "Fix" button that opens the right drawer.

---

## 4. Migration & rollout (safe, reversible)

1. Ship migration + new helper + Brain UI behind a feature flag (`ai_ssot_v1`).
2. Run backfill in shadow mode — log diffs between old assembled prompt and new one for 24h.
3. Flip flag; legacy textareas become read-only with a "Moved to Brain →" link for one release.
4. Next release: drop the legacy columns/keys and the read-only widgets.

---

## 5. Out of scope (this plan)

- Provider/model registry (`ai_provider_configs`) — already SSOT, untouched.
- `ai_memory` per-contact short-term memory — unrelated, untouched.
- IG comment automation persona — already reads `ai_purposes`, gets the fix for free.
- WhatsApp template content (`templates` table) — different system, untouched.

---

## 6. Acceptance checks

- `select count(*) from whatsapp_ai_config where system_prompt is not null` → 0
- `lead_nurture_config ? 'nurture_prompt'` → false on every row
- `rg -n "FORMATTING RULES|CRITICAL BEHAVIORAL RULE|ABSOLUTE IDENTITY RULE" supabase/functions` → 0 matches in code (only in seeded `ai_knowledge` rows)
- Sending the same test message via WhatsApp and via a nurture run produces prompts that differ **only** in the `ai_purposes.system_prompt` segment (verified by the Preview tool).
- Admin can change the gym's address in **one** place (Brain → Branch Info) and both handles pick it up on next call.
