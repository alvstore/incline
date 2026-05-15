## Two issues, both confirmed

### 1. Delivery failure to 9887601200 (and everyone else right now)

Edge logs show every AI reply crashing:

```
[whatsapp-webhook] runUnifiedAgent failed: ReferenceError: computeAppSecretProof is not defined
  at sendAiReply (whatsapp-webhook/index.ts:653:19)
```

Root cause: `supabase/functions/whatsapp-webhook/index.ts` calls `computeAppSecretProof(accessToken, appSecret)` at line 647 but never imports or defines it. The helper exists in `supabase/functions/_shared/meta-config.ts` (line 91) and is correctly used by `send-whatsapp` and `manage-whatsapp-templates`, but the webhook was missed.

Result: AI generates the interactive plan list correctly, the row is inserted into `whatsapp_messages`, but the `fetch` to Meta never runs — exception bubbles up before the POST. The user sees nothing on WhatsApp; in our DB the message stays at `status='pending'` (or gets flipped to failed by the duplicate-suppression branch). That's exactly the symptom for 9887601200.

**Fix:** Add `import { computeAppSecretProof } from "../_shared/meta-config.ts";` at the top of `whatsapp-webhook/index.ts`. Redeploy `whatsapp-webhook`.

No other change needed for delivery — once the import is in place the existing send path works (it's the same code shipped in `send-whatsapp`).

### 2. AI jumps straight to plan_interest list — no greeting, no name/email collection

In `_shared/ai-agent-brain.ts` the lead-capture system prompt (lines 224–276) tells the model:
- "collect full name + email + at least 1 other field before outputting lead_captured"
- but also hands it ready-made `plan_interest` and `goal` interactive lists with no ordering rule

So on first inbound message the model picks the most "complete" tool — the plan_interest list — and skips the human warm-up. There is no greeting requirement, no "ask name first" rule, and no gate that blocks interactive lists until contact details are known.

**Fix:** Tighten the lead-capture prompt block to enforce a strict ordered flow. Add a new section before the interactive-list templates:

```
ONBOARDING ORDER (STRICT — DO NOT SKIP STEPS):
Turn 1 (first inbound): Plain-text greeting only. Introduce yourself as {gymName}'s
  assistant in 1 short sentence, then ask for their NAME. No JSON, no list, no buttons.
Turn 2 (after name): Thank them by first name, then ask for EMAIL (and phone if not
  already known from WhatsApp). Plain text only.
Turn 3 (after email): Ask FITNESS GOAL using the goal interactive_list above.
Turn 4 (after goal): Ask PLAN_INTEREST using the plan interactive_list above.
Turn 5+: Any remaining target_fields, one at a time, then emit lead_captured JSON.

HARD GATE: NEVER emit an interactive_list or interactive button block until BOTH
full name AND email are present in the conversation history. If they aren't, your
reply MUST be plain text asking for whichever is still missing.
```

Also relax the existing "you MUST collect full name + email + at least 1 other field" line so it explicitly says "in the order above".

The known-lead branch (line 504) already short-circuits this for returning leads, so existing contacts are unaffected.

### Files

- `supabase/functions/whatsapp-webhook/index.ts` — add one import line.
- `supabase/functions/_shared/ai-agent-brain.ts` — extend the lead-capture prompt with the onboarding-order block + hard gate.
- Redeploy `whatsapp-webhook` (which bundles `_shared/ai-agent-brain.ts`).

### Verification

1. Tail `whatsapp-webhook` logs after redeploy — `computeAppSecretProof is not defined` should disappear.
2. Send a fresh "hi" from a phone that is NOT in `leads`/`profiles`. Expected sequence: greeting + name ask → email ask → goal list → plan list → `lead_captured`.
3. Confirm 9887601200 now receives the reply (manual resend from chat UI).

### Out of scope

- No changes to provider routing, AI Control Center UI, Purposes tab, dispatcher normalization, or any other AI feature touched in earlier waves.
- No schema changes.
