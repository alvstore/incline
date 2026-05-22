
## Audit — what actually happened

Transcript replay against live `ai_memory` for `919414296741`:

```
ai_memory row:
  profile.first_name      = "Sandeep"
  facts.fitness_goal      = "muscle_gain"
  facts.plan_interest     = "Annual"
  do_not_ask              = ["phone", "membership duration", "goal"]
  asked_questions         = [name×1, email×4]   ← plan_interest list never logged
```

The data layer is correct — the auto-learn extractor in `extractContextDelta` (lines 986-1064) did capture `plan_interest="Annual"` after the very first tap. The bug is **purely in prompt enforcement + outbound de-dup**, not in storage:

1. **`renderRuntimeRules`** (lines 1068-1084) emits "KNOWN GOAL" and "KNOWN NAME" runtime rules but has **no `KNOWN PLAN_INTEREST` rule** — so the LLM never sees a hard "do not re-ask duration" instruction.
2. **`do_not_ask` is not surfaced** to the model in any structured way. The extractor stores `"membership duration"` (LLM-generated synonym) instead of the canonical `plan_interest` key, so nothing downstream matches.
3. **No outbound de-dup guard** — if the LLM returns the same `interactive_list` JSON whose `body` text already appears in the last N outbound messages, it is sent again. This is what produced the 3 identical "Which membership duration suits you best?" prompts.
4. **Onboarding `HARD GATE` (line 296) is prompt-only**. The model violated it (skipped email → jumped to plan_interest). There is no server-side guard that strips interactive blocks when `email` is missing.
5. **`asked_questions` tracker** is fed by the LLM extractor only; interactive lists emitted by the bot are never logged, so the existing "Never repeat the same question more than twice" rule has no data to act on.

No DB schema change is needed — `ai_memory.facts` already has what we need.

## Fix plan (single edge function file)

**File: `supabase/functions/_shared/ai-agent-brain.ts`**

### 1. Canonicalize `do_not_ask` keys (extractContextDelta + upsertMemory side)
Add a small `DNA_ALIASES` map and normalize before push:
```
membership duration | plan | duration  → plan_interest
fitness goal | goal                    → goal
phone number | mobile                  → phone
```
Apply both to LLM output and to deterministic pushes.

### 2. Deterministic plan_interest capture from interactive list_reply title
Mirror the existing `GOAL_HINTS` block. Add a `PLAN_HINTS` map keyed off the list-reply titles the bot sends:
```
/monthly/i      → "Monthly"
/quarterly/i    → "Quarterly"
/half[- ]?year/i → "Half-Yearly"
/annual|yearly/i → "Annual"
```
Set `delta.facts.plan_interest` + `do_not_ask_add: ["plan_interest"]` when the last user message matches and memory doesn't already have it.

### 3. Add `KNOWN PLAN_INTEREST` runtime rule in `renderRuntimeRules`
```
if (memory?.facts?.plan_interest) {
  rules.push(`KNOWN PLAN_INTEREST: "${memory.facts.plan_interest}". 
    Do NOT re-emit the membership duration interactive_list. 
    Acknowledge their choice and move to the NEXT missing field.`);
}
```
Also append a generic line that lists `do_not_ask` keys so the LLM sees the canonical set.

### 4. Outbound interactive-list de-dup guard (post-LLM, pre-send)
Right after the LLM returns `replyText`, before the lead-capture parse:
- Detect if `replyText` is/contains a JSON block with `type:"interactive_list"`.
- Pull `body.text` (or the `body` string).
- Compare against the last 8 outbound messages already in `history` (already loaded at line 174).
- If the same `body` appears in the last 3 outbound turns → drop the interactive block and substitute a short plain-text follow-up using the canonical "next missing field" picker (email if missing, else goal, else plan_interest acknowledgement + ask for budget/time).

### 5. Hard-gate enforcement (server-side, not prompt-only)
Before sending an interactive block, if `memory.profile.full_name` or any email-bearing field is missing → strip interactive entirely and substitute a plain-text question for the missing field. This makes the "HARD GATE" actually hard.

### 6. Log emitted interactive lists into `ai_memory.asked_questions`
When we send an interactive_list, append the `body` text so the existing repeat-detection logic and future analytics can see it.

## Out of scope (do not touch)

- DB schema, RLS, migrations — none required.
- `whatsapp-webhook/index.ts` message extraction is already correct (`list_reply.title` is forwarded).
- `meta-webhook/index.ts` — same brain, gets the fix transitively.
- UI / frontend — no changes.
- Lead capture write path (`tryParseAndCaptureLead`) — unchanged.

## Verification after build

1. `supabase--read_query` on `ai_memory` for `919414296741` → confirm `do_not_ask` now includes canonical `plan_interest`.
2. Send a test inbound via `supabase--curl_edge_functions` to `/whatsapp-webhook` simulating a 5th turn for the same phone with text "tell me more" → assert the response does NOT contain `"Which membership duration suits you best?"`.
3. Edge logs (`supabase--edge_function_logs` for `whatsapp-webhook`) → look for new `[AI:whatsapp] dropping duplicate interactive_list` line.
4. Manually replay the transcript flow with a fresh phone via curl: name → email → goal → plan → confirm only ONE plan list is ever sent.

Used the senior-architect + senior-backend skills.
