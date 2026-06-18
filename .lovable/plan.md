# Fix two WhatsApp-brain bugs surfaced in Rsss's chat

## What went wrong (root causes)

### Bug 1 — "Location intent —" meta-prefix leaked into the user reply
`intentPivotPrefix()` in `supabase/functions/_shared/ai-agent-brain.ts:169` pulls a curated row from `ai_dynamic_memory` and uses its raw `correction_instruction` as the user-facing prefix:

```ts
return `${dyn.correction_instruction.split(/[.!?]\s/)[0]} `;
```

The admin-curated row for the `location` category literally starts with `"Location intent — Sector 14, Udaipur."` — that string is an **internal instruction to the model**, not a customer-facing answer. We never sanitized it, so it shipped verbatim as the prefix and the user saw:

> *"Location intent — Sector 14, Udaipur. Hi! I'm Ananya …"*

### Bug 2 — Bot repeats the full self-introduction + name ask on every turn
The deterministic onboarding short-circuit at line 772:

```ts
if (!hasName) {
  return { replyText: `${_pivot}Hi! I'm Ananya, the member concierge at Incline. May I have your name to get started? ✨`, … };
}
```

…fires on **every** inbound until a name is captured. Rsss sent 5 messages, never gave a name → got the full "Hi! I'm Ananya, the member concierge…" five times. There is no turn-count awareness, no softening after N asks, and no acknowledgement of the user's actual message ("Sector 14 is too far", "Nevertheless", "Thank you").

## Fix (scope: `supabase/functions/_shared/ai-agent-brain.ts` only, v4.6.0)

### Fix 1 — sanitize the intent pivot prefix
Rewrite `intentPivotPrefix()`:
1. Strip any leading meta-label like `"<Category> intent —"`, `"<Category> intent:"`, `"INTENT:"`, `"Intent:"` (case-insensitive) before using `dyn.correction_instruction`.
2. If the curated row has a dedicated `intent_answer` / `customer_facing` column, prefer that. (Inspect `ai_dynamic_memory` columns first; if a customer-facing field exists, use it; otherwise the sanitized first sentence + fallback to hardcoded `INTENT_ANSWERS[intent_category]` when the cleaned string is empty.)
3. As a final guard: if the cleaned prefix still contains the word `"intent"` followed by `—`/`:`, drop it and fall back to `INTENT_ANSWERS`.

### Fix 2 — turn-aware name-ask de-duplication
Add a small helper `nameAskTurnCount(history)` that counts how many **bot** turns in the last 10 messages match `NAME_ASK_RE`. Then:

- **Turn 1 (first ask):** unchanged — full greeting *"Hi! I'm Ananya, the member concierge at Incline. May I have your name to get started? ✨"*.
- **Turn 2:** drop the self-introduction, just *"…and may I have your name so I can help better? ✨"* (prefixed with the answer-pivot when the user asked a real question).
- **Turn 3:** acknowledge the user explicitly: *"No problem — whenever you'd like to share your name, I'll line up your Founding Member invite. Meanwhile, anything specific I can help with? ✨"*.
- **Turn 4+:** stop re-asking; respond only to the user's last message (let the LLM generate, no forced name funnel). Mark `do_not_ask_add: ["first_name"]` for this conversation in memory so the short-circuit no longer fires; flag conversation for human follow-up via `whatsapp_chat_settings.needs_human_review = true` (column exists per existing usage — verify; otherwise log a `[AI:guards] giving_up_name_ask` warning).
- Also: when the user's last 2 messages are pure acknowledgements ("thank you", "ok", "nevertheless"), do NOT re-ask name at all — return a brief close *"Anytime ✨ I'm here when you'd like to continue."* (regex `ACK_RE`).

Mirror the same turn-count guard inside `enforceNoRepeatNameAsk()` so model-generated replies are gated identically.

### Fix 3 — version bump + observability
- Update file-top changelog to **v4.6.0**.
- Add `console.log("[AI:guards] name-ask softened — turn=" + n)` and `[AI:guards] stripped intent meta-prefix` for traceability.

## Deploy
Redeploy `whatsapp-webhook` and `meta-webhook` (they bundle the shared brain).

## Verification
Replay Rsss's transcript shape against the deployed function via `supabase--test_edge_functions` with a stubbed history (mock 1–4 ask turns):
1. Inbound *"Can you pls brief abt the location"* → reply starts with *"We're at Sector 14, Udaipur, Rajasthan ✨"* (no "Location intent —" leak).
2. Inbound *"Sector 14 is too far"* (turn 2) → no self-intro repeat; short *"…and may I have your name so I can help better? ✨"*.
3. Inbound *"Nevertheless"* (turn 3) → graceful acknowledgement, no name re-ask.
4. Inbound *"Thank you for the response"* (turn 4) → *"Anytime ✨ …"* — no greeting at all.

Also `rg "Location intent" supabase/functions/_shared/ai-agent-brain.ts` should return zero matches in user-facing strings.

## Out of scope
- `ai_dynamic_memory` row content edits — fix is defensive at the brain layer so future curated rows can't leak meta text.
- No schema or RLS change.
- SEO files, dispatcher, RCS, Telinfy — untouched.

## Files touched
- `supabase/functions/_shared/ai-agent-brain.ts` (sanitizer + turn-aware funnel + version comment)
