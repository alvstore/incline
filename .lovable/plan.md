
## Goal

Stop the "Slot-Filling Trap" in the WhatsApp/IG/Messenger AI brain. When a user replies to a name/email prompt with a Hinglish question ("Kha pr h", "kitna", "kab khulega"), the bot must:

1. Recognize the intent (Location / Pricing / Timeline).
2. Answer it from knowledge.
3. Re-ask for the missing field in the SAME reply.
4. Never persist the question as `first_name`.

## Why Epic 2 is adapted

The user's epic targets an `upsert_lead_contact` function-calling tool. This project does not use that pattern — capture is deterministic in `supabase/functions/_shared/ai-agent-brain.ts` (Steps 1–4 short-circuit + regex auto-learn + LLM enrichment). The hardening lives there, not in a tool schema.

## Scope (files touched)

1. `supabase/functions/_shared/ai-agent-brain.ts` — intent gate, answer-and-pivot, expanded blocklist, observability log.
2. `supabase/functions/_shared/ai-prompt.ts` — add `<intent_override>` block to `<strict_rules>` so the LLM follows the same rule on any turn the deterministic gate doesn't short-circuit.
3. `.lovable/plan.md` — log entry.

No new migrations, no UI changes, no new edge functions. Deploy `whatsapp-webhook` and `meta-webhook` after edit (they import the shared brain).

## Changes

### 1. Hinglish intent classifier (new, top of brain, runs BEFORE Step 1 short-circuit)

Add three regexes + a small classifier:

```ts
export const LOCATION_INTENT_RE =
  /\b(kha(?:a|n)?\s*pr?\s*h|kaha[ny]?|kidhar|location|address|where(?:\s+is)?|locate|reach|directions?)\b/i;
export const PRICING_INTENT_RE =
  /\b(kitna|kitne|paisa|paise|fees?|price|cost|charges?|rate|rates|kharcha|kharch)\b/i;
export const TIMELINE_INTENT_RE =
  /\b(kab\s*(?:khul|start|open)|open(?:ing)?\s+(?:when|kab)|start\s*date|launch|kab\s*se|opens?\s+when|when\s+(?:do\s+you\s+)?open)\b/i;

type HinglishIntent = "location" | "pricing" | "timeline" | null;
function classifyHinglishIntent(text: string): HinglishIntent {
  if (LOCATION_INTENT_RE.test(text)) return "location";
  if (PRICING_INTENT_RE.test(text)) return "pricing";
  if (TIMELINE_INTENT_RE.test(text)) return "timeline";
  return null;
}
```

Canned answers (sourced from existing memory constants — Sector 14 Udaipur, Founder's Embargo on price, June 22 launch):

```ts
const INTENT_ANSWERS: Record<Exclude<HinglishIntent,null>, string> = {
  location: "We're at Sector 14, Udaipur, Rajasthan ✨",
  pricing:  "Founding Member (Annual) is our only active enrollment right now — full pricing is shared by our team once you're on the Founder's list ✨",
  timeline: "We open on June 22nd — Founding Members get launch-day perks ✨",
};
```

### 2. Answer-and-pivot inside each capture short-circuit step

In the `shouldCaptureLead` block (lines 665–751), before each `return { replyText: … }`, run:

```ts
const intent = classifyHinglishIntent(ctx.messageContent);
const pivotPrefix = intent ? `${INTENT_ANSWERS[intent]} ` : "";
```

Then prepend `pivotPrefix` to the existing canned reply. Example for Step 1:

```ts
return {
  replyText: `${pivotPrefix}Hi! I'm Ananya, the member concierge at Incline. May I have your name to get started? ✨`,
  …
};
```

Same pattern for Step 2 (email), Step 3 (goal), Step 4 (plan duration). For interactive_list replies (Step 3/4), the pivot prefix is prepended to the `body` field of the JSON, not the outer string.

### 3. Block Hinglish question words from becoming a name

Two layers — both already exist, just extend:

a. Expand `FAKE_NAME_TOKENS` (line 90) with the new tokens:
```
"kha","khan","kahan","kidhar","kab","kitna","kitne","paisa","paise",
"fees","price","cost","rate","rates","location","address","open","khulega",
"start","launch","reach","directions"
```

b. In the auto-learn name block (lines 2052–2076) add an explicit guard:
```ts
const hasHinglishIntent = classifyHinglishIntent(lastUser) !== null;
if (!looksLikeQuestion && !isHandoffOrDecline && !hasHinglishIntent && … ) { … }
```

c. In the LLM-enrichment merge (lines 2150–2155), apply the same `classifyHinglishIntent(lastUser)` guard before accepting `parsed.profile.first_name` / `full_name`.

### 4. Observability log (the epic's "[AI Tool Call Attempt]" requirement)

Right before each deterministic name write, log a structured line so we can audit false positives in `supabase functions logs`:

```ts
console.log(
  "[AI Tool Call Attempt] capture_first_name",
  JSON.stringify({
    sender: ctx.senderId,
    platform: ctx.platform,
    raw: lastUser.slice(0, 80),
    candidate: tokens[0],
    intent: classifyHinglishIntent(lastUser),
    accepted: true,
  })
);
```

Mirror a `accepted:false` log when any guard rejects, so we can grep for `[AI Tool Call Attempt] capture_first_name` and see both sides.

### 5. System-prompt intent-override (ai-prompt.ts)

Extend `<strict_rules>` (around line 215 in `ai-prompt.ts`) with:

```
- [INTENT OVERRIDE]: Before extracting name/email/phone, check if the user is asking a NEW question. Hinglish slang dictionary:
    • "kha pr h" / "kaha" / "kidhar" / "location" → Location intent → answer: Sector 14, Udaipur.
    • "kitna" / "fees" / "price" / "paisa" → Pricing intent → invoke Founder's Embargo (no ₹).
    • "kab khulega" / "open kab" / "start date" → Timeline intent → June 22 launch.
  If the user asks a question, ANSWER it first using <knowledge_base>, THEN politely re-ask for the missing detail in the SAME message. Never save Hinglish questions, greetings, or single-word replies (hi/hello/no/ok/haan/nahi) as names.
```

This belt-and-braces the deterministic gate for any future turn the LLM handles directly.

## Verification

1. `tail -f` on `meta-webhook` + `whatsapp-webhook` edge logs via `supabase--edge_function_logs`, search `[AI Tool Call Attempt]`.
2. Manual replay through `supabase--curl_edge_functions` on `/meta-webhook` with three fixtures:
   - `"Kha pr h"` after name prompt → expect "We're at Sector 14, Udaipur… May I know your name?" AND `accepted:false` log AND `profile.first_name` unchanged in `ai_memory`.
   - `"kitna"` after name prompt → location embargo answer + name re-ask.
   - `"Aarav"` after name prompt → captured normally, `accepted:true` log.
3. Confirm no regressions to existing human-handoff (`"can I speak to a person"` still pauses bot 24h).

## Out of scope

- No changes to `ai_knowledge` rows, `ai_purposes`, persona text, or the four interactive lists.
- No new edge function. No DB migration. No UI changes.
- The user's literal `upsert_lead_contact` tool-schema edit is N/A — capture is deterministic; equivalent hardening is in §3.
