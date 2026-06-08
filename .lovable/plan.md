## Problem

Pallavi (lead `+91 88548 69672`) received a message with a literal ` ```json … ``` ` block containing a Meta-style interactive list payload instead of an actual tappable list.

## Root cause

`whatsapp-webhook/index.ts → tryExtractInteractiveJson()` (lines 526-580) and the brain's outbound guards only recognise the project's own two shapes:

- `{ "type": "interactive",       "buttons": [...] , "body": "…" }`
- `{ "type": "interactive_list",  "sections": [...], "button": "…", "body": "…" }`

But Gemini occasionally emits Meta Cloud API's **native** envelope instead:

```json
{ "type": "interactive",
  "interactive": {
    "type": "list",
    "header": {...},
    "body": { "text": "…" },
    "action": { "button": "…", "sections": [...] }
  } }
```

The extractor matches `parsed.type === "interactive"`, sees no `parsed.buttons`, falls through the `if` without setting `interactivePayload`, and **leaves `replyText` untouched** — so the fenced JSON block is sent verbatim as the WhatsApp text body. That is exactly what Pallavi saw.

A secondary safety hole: even after extraction, the function never asserts that `replyText` is free of ```` ``` ```` fences or stray `{"type":"interactive…` substrings before sending.

## Fix (3 changes, scoped, no business-logic changes)

### 1. Extend `tryExtractInteractiveJson` to normalise Meta-native shape

In `supabase/functions/whatsapp-webhook/index.ts` (right before the `return null` at line 579), add a normaliser that detects the Meta envelope and rewrites it into the brain's canonical shape so the existing `parsed.type === "interactive_list"` branch handles it.

Pseudocode:
```ts
function normalizeMetaNative(p: any): any {
  if (p?.type === "interactive" && p.interactive && !p.buttons && !p.sections) {
    const inner = p.interactive;
    const bodyText = inner.body?.text || inner.body || "";
    if (inner.type === "list" && inner.action?.sections) {
      return { type: "interactive_list", body: bodyText,
               button: inner.action.button || "Select",
               sections: inner.action.sections };
    }
    if (inner.type === "button" && inner.action?.buttons) {
      return { type: "interactive",
               body: bodyText,
               buttons: inner.action.buttons.map((b: any) =>
                 b?.reply?.title || b?.title).filter(Boolean) };
    }
  }
  return p;
}
```
Call `parsed = normalizeMetaNative(parsed)` in all 3 extraction branches (whole-string, fenced, brace-balanced) before the `interactive` / `interactive_list` checks.

### 2. Final residue guard inside `sendAiReply`

After the existing extraction block (around line 629), add a last-mile sanitiser:

```ts
// If anything resembling JSON / fences slipped through, scrub it.
if (/```|"type"\s*:\s*"interactive/i.test(replyText)) {
  replyText = replyText
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\{[\s\S]*?"type"\s*:\s*"interactive[\s\S]*?\}\s*\}?/gi, "")
    .trim();
  // Telemetry so we know the LLM mis-shaped a payload
  await supabase.rpc("log_error_event", {
    p_source: "whatsapp_webhook",
    p_severity: "warning",
    p_message: "interactive JSON leaked past extractor — scrubbed",
    p_context: { branch_id: branchId, phone: cleanPhone,
                 had_payload: !!interactivePayload },
  }).catch(() => {});
}
if (!replyText && !interactivePayload) {
  replyText = "Got it — one moment.";   // never send an empty WA message
}
```

### 3. Tighten the prompt contract (defensive)

In `_shared/ai-agent-brain.ts` near lines 571-578 (the goal/duration HARD GATE block), append one explicit anti-example:

> "Emit the canonical brain shape ONLY: `{ "type": "interactive_list", "body": "...", "button": "...", "sections": [ { "title": "...", "rows": [...] } ] }`. NEVER wrap it in Meta's `{type:'interactive', interactive:{...}}` envelope. NEVER wrap any JSON in markdown ```json fences."

No prompt rewrite — single appended paragraph.

## Out of scope

- Pallavi's existing thread: no retro-send. Next inbound message will work correctly.
- `ai_lead_loss` monitor / SystemHealth — already shipped last turn.
- `meta-webhook` Instagram signature_mismatch (separate IG App Secret issue, unrelated).

## Verification

1. Unit-style: feed `tryExtractInteractiveJson` the exact JSON from Pallavi's thread (fenced) and assert it returns a normalised `interactive_list` with 4 rows.
2. End-to-end: send a fresh inbound from a test number through the same goal turn; confirm WhatsApp renders a list (not text) and `whatsapp_messages.outbound` row's `payload` has `type=list`.
3. `error_logs` shows zero `"interactive JSON leaked"` warnings within 1h of redeploy.

## Files touched

- `supabase/functions/whatsapp-webhook/index.ts` — `tryExtractInteractiveJson` + `sendAiReply` residue guard.
- `supabase/functions/_shared/ai-agent-brain.ts` — 1 added paragraph in the founder-phase prompt.

Used the senior-architect skill.
