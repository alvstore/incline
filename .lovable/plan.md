# Why the raw JSON leaked into your chat box

Your screenshot shows two AI turns merged into one outbound:

> "Received! I'll make sure this reaching our hiring team."
> "Just to complete your profile … `{"type":"interactive_list", … }`"

Root causes (audited in code):

1. **Two parallel "AI brains" exist and have diverged.**
   - `supabase/functions/_shared/ai-agent-brain.ts` (the canonical one, v2.2.0 with the job-intent guard).
   - `supabase/functions/whatsapp-webhook/index.ts` lines **1055–1193** — a full *duplicate* prompt+chat-completions block that WhatsApp actually executes. The non-fitness guard we added was only fully wired into the shared brain. WhatsApp still falls through to onboarding after a vague job acknowledgement.

2. **Prompt contradiction.** The system prompt says: *"For job/CV/vendor … reply with this single short message and stop."* It also says: *"Your secondary goal is to collect name+email+goal …"* and *"For 'fitness goal' always emit this EXACT list JSON."* The model resolved that conflict by doing **both** — hence prose + JSON in one message.

3. **JSON extractor is a band-aid.** `tryExtractInteractiveJson` (whatsapp-webhook 1707-1764) recovers most cases, but any time the model emits *two* messages worth of content, or the JSON is slightly malformed (smart quote, trailing comma, unicode), the brace walker fails and the raw JSON ships to the user.

4. **No structured-output contract with the gateway.** We're asking a chat model to hand-write valid Meta Cloud API JSON inside free-form prose. That is the wrong primitive — every LLM will eventually leak it.

5. **No real memory.** "Memory" today = last 20 message rows + a `conversation_summary` text blob. There is no canonical intent state, no captured-fact store the model can read/write through tools, no per-thread profile. So every turn re-derives intent from scratch and re-asks already-answered questions.

---

# The upgrade — model-first, code-thin

Move the smarts into the model with a **single brain, structured outputs, and durable memory**, and shrink the backend to a thin executor. No more regex post-processors, no more "force canonical plan list" hacks.

## 1. Collapse to one brain
- Delete the duplicated prompt block in `whatsapp-webhook/index.ts` (1055–1193) and the `sendAiReply` post-processors that re-write the model's output (1815–1861).
- Route WhatsApp through `runUnifiedAgent` from `_shared/ai-agent-brain.ts`, the same path Instagram/Messenger use. One prompt, one place to evolve.

## 2. Structured outputs via the AI SDK
Replace raw `fetch` to `ai.gateway.lovable.dev` with the **Vercel AI SDK** + Lovable AI Gateway provider (per project knowledge `ai-sdk-lovable-gateway`).

Define a single discriminated-union response schema with Zod and pass it as `Output.object({ schema })`. The model can no longer ship malformed JSON or mixed prose:

```text
AgentReply =
  | { kind: "text",         body: string }
  | { kind: "buttons",      body: string, buttons: [{id,title}] (1..3) }
  | { kind: "list",         body: string, button: string,
                            sections: [{title, rows:[{id,title,description?}] }] }
  | { kind: "handoff",      body: string, reason: "job"|"vendor"|"press"|... }
  | { kind: "lead_captured",data: {...} }
  | { kind: "tool_call",    name: string, args: object }    // for member tools
```

The webhook's only job becomes: switch on `kind` → translate to the Meta payload. No JSON scraping, no canonical-list overrides, no plan-question regex.

## 3. Intent classification as a first-class step
Before the conversational turn, run a tiny classifier call (cheap `gemini-3.1-flash-lite-preview`) that returns:

```text
Intent = membership_inquiry | pricing | location | timings
       | facility_booking   | account_question
       | job_application    | vendor | press | partnership
       | complaint          | spam | greeting_only | other
ConfidenceScore: 0..1
```

Persist `current_intent` on `whatsapp_conversation_state`. The main brain receives the intent in its system prompt and is *told* which conversational track to run (onboarding vs. polite-redirect vs. member-tools). This removes the "do both" failure mode that produced your screenshot.

## 4. Persistent, structured memory
Replace the free-text `conversation_summary` with a typed memory record per phone+branch:

```text
chat_memory (
  branch_id, phone,
  intent text,              -- last classified intent
  intent_locked_at timestamptz,
  profile jsonb,            -- {name,email,goal,plan_interest,budget,...}
  facts jsonb,              -- gym facts the user already heard (don't repeat)
  asked_questions text[],   -- last 5 questions, prevents loops
  do_not_ask text[],        -- ["goal","budget"] once captured
  last_summary text,        -- rolling 200-token summary
  last_seen timestamptz
)
```

The brain reads it into the system prompt as a compact JSON block and *writes back* through two new tools:
- `remember_fact(key, value)` — upsert into `profile`/`facts`.
- `mark_intent(intent)` — locks intent until user changes topic.

This is the "context/training" you asked for: memory the model curates itself, no backend rules.

## 5. Lead capture as a tool, not a JSON convention
Today the model emits `{"status":"lead_captured", ...}` and we regex-match it. Instead, expose `capture_lead(fields)` as an AI SDK tool with `needsApproval: false` and Zod-validated args. The model calls the tool; the executor inserts the lead and returns confirmation. No more JSON parsing.

For non-fitness intents the prompt simply forbids calling `capture_lead` and provides `polite_redirect(reason)` — also a tool — that returns the canonical "email info@theinclinelife.com" message. The model can no longer "almost capture" a job seeker.

## 6. Knowledge grounding
Move the `hydrateGymFacts` blob (plans, hours, USPs, FAQs) into a small `gym_knowledge` table per branch with a `topic` column, and inject only the topics relevant to the current intent. Saves tokens and makes the model answer factual questions deterministically.

## 7. Observability
- Log every turn to `ai_turn_log` with: intent, model, latency, prompt-tokens, completion-tokens, structured-output validation result, tool calls, and final `kind`. Surface in System Health.
- A failed Zod parse increments a metric so we *see* model regressions instead of users seeing raw JSON.

---

## Technical changes (files)

| File | Change |
|---|---|
| `supabase/functions/_shared/ai-agent-brain.ts` | Rewrite to use Vercel AI SDK + `createLovableAiGatewayProvider`, structured `Output.object`, intent pre-classifier, memory read/write, tools (`capture_lead`, `polite_redirect`, `remember_fact`, `mark_intent`, existing member tools). Single source of truth. |
| `supabase/functions/whatsapp-webhook/index.ts` | Remove duplicate brain (1055-1193). Remove `tryExtractInteractiveJson`, `CANONICAL_PLAN_LIST` overrides, plan/duration regex (1707-1861). `sendAiReply` becomes a thin switch over `AgentReply.kind` → Meta payload. |
| `supabase/functions/meta-webhook/*` | Same simplification — call `runUnifiedAgent`, render reply by `kind`. |
| `supabase/functions/_shared/ai-tools.ts` | Add `capture_lead`, `polite_redirect`, `remember_fact`, `mark_intent` tool definitions with Zod schemas. |
| `supabase/functions/_shared/ai-tool-executor.ts` | Implement the four new tools against `leads`, `chat_memory`, `whatsapp_conversation_state`. |
| `supabase/migrations/<new>.sql` | `chat_memory` table + RLS, `gym_knowledge` table + RLS, `ai_turn_log` table + RLS, indexes on `(branch_id, phone)`. |
| `src/pages/SystemHealth.tsx` | New "AI Brain" card: turns/day, structured-parse failure rate, intent distribution, avg latency, top failed intents. |
| `src/pages/Settings.tsx` (Communication Templates → AI Studio) | UI to view/edit `gym_knowledge` rows per branch and inspect `chat_memory` for any phone (debug aid). |

## Migration & rollout

1. Ship migrations + new tools.
2. Implement new brain behind a feature flag `organization_settings.whatsapp_ai_config.brain_v3 = true`.
3. Shadow-mode for 24h: run v3 in parallel, log only, compare output kinds.
4. Cut over WhatsApp first, then IG/Messenger.
5. Delete legacy duplicate prompt + extractor + canonical-list overrides once metrics confirm zero structured-parse failures for 48h.

## Out of scope (this plan)

- Replacing the `WhatsAppMediaAttachment` flow (already shipped).
- Changing Meta number routing or template registration.
- Adding new lead fields beyond what `lead_capture.target_fields` already declares.

---

## Immediate hotfix (optional, while v3 is built)

If you want today's leak stopped before the full rewrite:

- Wire the WhatsApp inbound through `runUnifiedAgent` (delete the duplicate prompt block) so the **non-fitness guard you already approved actually runs on WhatsApp**. That single change would have produced: *"Thanks for reaching out! For careers, partnerships … please email info@theinclinelife.com"* — and nothing else — for the job-seeker chat in your screenshot.

Tell me whether to:
**(a)** ship just the hotfix now, then do the full v3 brain after, or
**(b)** go straight to v3.
