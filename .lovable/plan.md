## Why "Annual" is missing today

In `whatsapp-webhook/index.ts` (and mirrored `_shared/ai-agent-brain.ts`) the lead-capture prompt mentions plan durations as a soft guideline but gives **no concrete JSON example** for `plan_interest`. Gemini took the easy path and emitted a 3-button `interactive` block. Meta v25.0 hard-caps reply buttons at 3 → "Annual" got silently dropped.

WhatsApp itself controls how list rows render — we can't restyle bubbles — but we make rows feel premium via a clear section title, emoji-led row titles, and short benefit-only descriptions (no prices, no Day Pass).

## Changes

### 1. Hard-code a plan_interest list template in the prompt
Both files: `whatsapp-webhook/index.ts` (~line 1132) and `_shared/ai-agent-brain.ts` (~line 212).

Replace the soft "always offer … as a list" line with this exact template the model must emit verbatim for `plan_interest`:

```json
{"type":"interactive_list","body":"Which membership duration suits you best, {{name}}?","button":"View Plans","sections":[{"title":"Choose your plan","rows":[
  {"id":"plan_monthly","title":"📅 Monthly","description":"Flexible — try us out, no commitment"},
  {"id":"plan_quarterly","title":"⚡ Quarterly","description":"3 months — most popular starter"},
  {"id":"plan_halfyearly","title":"💪 Half-Yearly","description":"6 months — better value, real results"},
  {"id":"plan_annual","title":"🏆 Annual","description":"12 months — our most committed members"}
]}]}
```

Same emoji-led list treatment for `goal` (5 options: Weight Loss, Muscle Gain, Endurance, General Fitness, Flexibility) so it stops degrading to a "Select Goal" placeholder.

Add an explicit rule:
*"NEVER omit Annual. NEVER use a button block for plan_interest or goal — these always render as `interactive_list`. NEVER mention prices, fees, or Day Pass — pricing is handled by a human."*

Update the existing `fieldLabels.plan_interest` line to drop "Day Pass" so the model never even considers it:
`plan_interest: "Interested Membership Plan Duration (Monthly, Quarterly, Half-Yearly, or Annual)"`

### 2. Server-side safety net (auto-promote)
In `whatsapp-webhook/index.ts` near the existing >3 buttons → list auto-promotion (~line 1630), strengthen the rule: when parsed model output asks about plans/duration **and** has fewer than 4 options, replace it with the canonical 4-row plan list before sending to Meta. Detection: body matches `/plan|duration|membership/i` AND buttons look like plan tokens.

Also strip any row whose title/description matches `/day\s*pass|₹|\bRs\.?\b|\/-|price/i` as a final guard so prices and day-pass can never leak through.

### 3. Files touched
- `supabase/functions/whatsapp-webhook/index.ts` — prompt template + safety net + price/day-pass strip
- `supabase/functions/_shared/ai-agent-brain.ts` — mirrored prompt template
- Redeploy `whatsapp-webhook`

### Non-goals
- No DB changes (`plan_interest` column already exists from Wave A).
- No frontend changes — WhatsApp controls list rendering.
- No pricing exposure anywhere in the bot flow.

After approval I'll implement and redeploy in one pass.