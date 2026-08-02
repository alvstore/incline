## What I verified

- `ai_purposes` for `fitness_plan` is on `google/gemini-3.6-flash` with `max_tokens: 8000`, but `generate-fitness-plan` **overrides** it: `maxTokens = Math.min(16000, 4000 + variantCount*1200 + …)`. With no rotation (your screenshot shows rotation `0`) that is **4000 tokens** — and on a thinking model, reasoning tokens are billed against that same budget, so the JSON gets cut off mid-object.
- `parsePlanJson` (index.ts:29-77) silently *repairs* truncated JSON by closing open brackets. A response cut off inside Monday's first exercise becomes a valid object containing exactly one day with one exercise — which is precisely what the Preview screen shows.
- `validatePlanShape` (index.ts:80-97) only requires **"weeks[0].days has at least one day, and some day has at least one exercise"**. The repaired 1-day/1-exercise object passes, so no retry fires and the plan is saved.
- `expandWeeks` then faithfully clones that one broken day into Weeks 1..N — hence "Monday only" repeated on every week with progression notes appended.
- `daysPerWeek` (6) and `durationWeeks` are sent correctly from `CreateAI.tsx` — the form inputs are not the problem; nothing on the server ever checks the AI honoured them.
- `ai_plan_jobs` currently has zero rows, so the run in the screenshot went through the synchronous path.

Root cause: **token starvation + a repair-and-accept parser + completeness checks that are too weak to notice.**

## The fix

### 1. Give the generation a real token budget
- Stop hard-capping at 4000. Use `max(purposeRow.max_tokens, 12000)` for workout, plus the rotation allowance, cap 24000.
- Pass an explicit low reasoning/thinking budget for Gemini thinking models in the dispatcher body (`reasoning_effort: "low"` / `thinkingBudget`), so reasoning cannot eat the output allowance.

### 2. Never accept a truncated plan as final
- `parsePlanJson` returns `{ plan, repaired: boolean }`. A repaired (truncated) parse is treated as a shape failure, not a success.
- Surface the provider `finish_reason` from `generateOnce`; `finish_reason === "length"` is an automatic shape failure.

### 3. Real completeness validation
New `validatePlanCompleteness(plan, { daysPerWeek })` for workouts, run after shape validation:
- `weeks[0].days` must cover all 7 calendar days (Monday…Sunday, no duplicates).
- The number of days with a non-empty `exercises` array must equal the requested `daysPerWeek` (±0), with the rest explicitly `focus: "Rest"`.
- Every training day needs **at least 4 exercises**.
Failing any of these triggers the repair path instead of being saved.

### 4. Make the retry actually able to succeed
- Raise the extra-AI-call budget for *completeness* failures from 1 to 2 (differentiation stays capped, so worst case is bounded).
- Retry 1: same prompt + "BE CONCISE, output must be complete" + increased token budget.
- Retry 2 (**split generation**): ask for the week in two calls — days 1-3, then days 4-7 — and merge. Each call is small enough that truncation is effectively impossible. Stage text reports "Building days 1-3" / "Building days 4-7".

### 5. Fail loudly instead of saving a stub
- If the plan is still incomplete after retries, return 422 with a specific message ("AI returned only 1 of 6 training days — reduce weeks/rotation and retry") rather than a generic error, and do **not** persist it.
- Client-side guard in `CreateAI.tsx`: before showing Preview/allowing Save, reject a plan whose training-day count doesn't match the requested `daysPerWeek`, showing the same message.

### 6. Prompt tightening
- Move the "EXACTLY N training days, remaining days as Rest, minimum 4-6 exercises per training day" instruction to the **top** of the user message (currently buried mid-prompt at index.ts:455) and repeat it as the closing line, which is where models weight hardest.

## Technical summary

- `supabase/functions/generate-fitness-plan/index.ts` — token budget, `parsePlanJson` repaired-flag, `validatePlanCompleteness`, split-generation retry, prompt reordering, 422 messaging. Version bump to v5.0.0.
- `supabase/functions/_shared/ai-runtime.ts` / `ai-dispatcher.ts` — expose `finish_reason`; pass a low reasoning budget for thinking models.
- `src/pages/fitness/CreateAI.tsx` — completeness guard before Preview/Save; surface server stage text for the split-generation stages.

### Verification
Generate a 6-day/4-week Muscle Gain plan and a 4-day Fat Loss plan; confirm each week has 6 (resp. 4) training days with 4+ exercises each, rest days marked, and that the two goals produce visibly different splits and rest ranges.
