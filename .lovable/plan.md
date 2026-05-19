## Audit — what's wrong in the chat you shared

Looking at `supabase/functions/_shared/ai-agent-brain.ts` and `ai-memory.ts`, three concrete bugs explain that "Could you share your phone number?" loop:

1. **AI asks for phone even though phone is already known.** WhatsApp inbound traffic already carries `ctx.senderId = phone`. The prompt mentions this on line 299, but the lead-capture target field list still includes `phone` (line 245), and `do_not_ask` is **never seeded** with `phone` for the WhatsApp platform. So Gemini happily re-asks.
2. **No real "auto-learning" pass.** `ai_memory.profile/facts` only get written when (a) lead capture completes, or (b) reply ends with "?" (lines 380–428). Free-text signals like "weight loss programme", "first listen my query", "I'm Laveena" never land in memory. Next turn the model has no idea who it's talking to.
3. **No consent / pushback detection.** When the user says "First listen my query", the bot still appends "May I have your phone number?" at the end of the very next reply. There is no rule that suppresses CTAs when the user explicitly asks to be heard, and no `do_not_ask` entry gets added when they decline.

`ai_memory` already supports everything we need (`profile`, `facts`, `asked_questions`, `do_not_ask`, `current_intent`, `summary`). We just aren't writing to it intelligently.

---

## Plan

### 1. Silent context extractor (`extractContextDelta`) — `ai-agent-brain.ts`
A second, cheap LLM call (`google/gemini-3-flash-preview`, `Output.object` schema) that runs once per inbound turn, **after** we load history and **before** the main reply call. It receives the last 6 messages and the current memory snapshot, and returns a structured delta:

```ts
{
  profile:        { first_name?, language?, city?, age_band? },
  facts:          { fitness_goal?, plan_interest?, experience?, preferred_time?, budget_band? },
  current_intent: 'info_seeking' | 'pricing' | 'booking' | 'complaint' | 'careers' | ...,
  consent: {
    push_contact_ask: 'allowed' | 'declined' | 'unknown',  // detects "first listen", "don't ask", "stop asking"
    wants_human:      boolean,
  },
  do_not_ask_add: string[],   // e.g. ['phone'] for WhatsApp, plus anything user pushed back on
  summary:        string      // ≤200 chars rolling summary
}
```

Result is merged into `ai_memory` via the existing `upsertMemory()` — no schema change.

### 2. Seed `do_not_ask = ['phone']` for every WhatsApp contact at first turn
Tiny, deterministic, no LLM needed. Fixes the headline bug immediately even before the extractor warms up.

### 3. Tighten the system prompt (lead-capture branch, ~lines 253–302)
Add three non-negotiable rules driven by the memory we now have:
- **"Listening mode"**: if `memory.facts.push_contact_ask === 'declined'` OR last user turn matches `/^(first|please|wait|hold on|listen|sun(o|iye)|ruk)/i`, the next reply MUST answer the question with zero CTAs, zero contact asks, and zero interactive blocks. Plain text only.
- **Max one question per reply.** Already implicit, now explicit.
- **Phone gate**: never request phone/email on WhatsApp unless `memory.facts.member_requested_callback === true`. Phone is auto-resolved from `ctx.senderId`.

### 4. Render memory more usefully
`renderMemoryBlock()` is already wired in. Add the new fields (consent state, intent, fitness_goal) so the main model can see them. Also prefer `memory.profile.first_name` over `contact_name` when greeting.

### 5. Honor extracted intent
- `current_intent === 'careers' | 'vendor' | 'media'` → already handled by the non-fitness branch; now also persist `do_not_ask_add: ['goal','plan_interest']` so we never re-ask onboarding for that contact.
- `current_intent === 'info_seeking'` AND `facts.fitness_goal` already known → skip the goal interactive_list, go straight to answering.

### 6. Observability
Log every extractor call into `ai_call_logs` with `purpose='context_extract'` so we can see token spend.

### 7. UI (read-only, optional in this pass)
Add a "Learned context" expandable section in the WhatsApp chat right-side drawer showing `profile`, `facts`, `do_not_ask`, `current_intent` from `ai_memory`. Helpful for staff to verify the bot understood correctly.

---

## Files touched

| File | Change |
|---|---|
| `supabase/functions/_shared/ai-agent-brain.ts` | Add `extractContextDelta()`; call before main reply; merge into `upsertMemory`; seed `do_not_ask=['phone']` for WhatsApp; new prompt rules (listening mode, max-1-question, phone gate); use learned `first_name` and `fitness_goal` to skip redundant asks |
| `supabase/functions/_shared/ai-memory.ts` | Add `consent` block helpers; extend `renderMemoryBlock` to include intent + consent + fitness_goal |
| `src/pages/WhatsAppChat.tsx` *(optional UI bit)* | New "Learned context" panel reading `ai_memory` for the active contact |

No database migration needed — `profile`/`facts` are JSONB.

---

## Acceptance test (replay the failing chat)

1. Inbound: "Give me information for weightloss programme" → memory writes `facts.fitness_goal='weight_loss'`, `current_intent='info_seeking'`. Reply describes weight-loss offerings and asks **zero** contact questions.
2. Inbound: "First listen my query" → memory writes `consent.push_contact_ask='declined'`, `do_not_ask_add=['phone','email']`. Next reply contains no CTA, no phone ask.
3. Inbound on a fresh number: bot never asks "Could you share your phone number?" — phone is in `do_not_ask` from turn 1.
4. Staff opens the chat drawer → sees "Learned: name=Laveena, goal=weight_loss, intent=info_seeking, do-not-ask=[phone,email]".

---

## Out of scope
- Changing lead-capture target fields globally (Settings UI). The extractor populates them silently instead.
- Adding new tables. We reuse `ai_memory`.
- Rewriting the Instagram/Messenger path beyond the same shared brain (it inherits the fix automatically).