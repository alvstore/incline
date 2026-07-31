# AI Fitness & Diet Plan Generator — Fix + Redesign

## What I verified

- Config row `ai_purposes.fitness_plan` has **`max_tokens = 2500`**, `temperature 0.5`, no model pinned.
- `generate-fitness-plan/index.ts` asks for a full **4-week × 7-day** JSON plan (plus an optional `rotation` block with up to 4 variants) in **one** completion, then does a hard `JSON.parse(content)`.
- 2,500 output tokens cannot hold that JSON, so the model output is cut mid-object and `JSON.parse` throws → the function returns 500 `"Failed to parse AI response"`, which the UI shows as a generic red toast. This is the primary failure.
- Provider routing: default is **Google direct** (`gemini-2.5-flash`, `enable_fallback = true` → Lovable AI). `ai_call_logs` shows the last two `fitness_plan` calls succeeded at the provider level but took **12.4s and 13.7s** — the provider succeeded, the parse downstream is what breaks.
- `ai-dispatcher` timeout is 60s with up to 3 attempts, so a slow generation can sit for ~3 minutes before erroring, and the client (`supabase.functions.invoke`) has no timeout at all.
- The UI (`CreateAI.tsx`) shows only a static text line that swaps after 12s — no progress bar, no cancel, no elapsed timer.

## Plan

### 1. Fix generation reliability (backend)
- Raise the token budget for this purpose: pass an explicit `maxTokens` from the edge function (sized by request — roughly 4,000 base + per-week/per-variant allowance, capped ~16,000) instead of inheriting `2500`, and update the `ai_purposes.fitness_plan` row's default to a sane value via migration.
- **Chunked generation for long plans**: generate week 1 (the template week) plus rotation variants in one call, and derive weeks 2..N by progressive-overload transformation server-side rather than asking the model to re-emit every week. This cuts tokens ~4x, cuts latency to ~10-15s, and removes the truncation class of bug entirely.
- **Resilient parsing**: strip ```json fences, and on a parse failure attempt a bracket-balanced repair before erroring; return a clear, actionable error (`AI response was truncated — try fewer weeks`) instead of `Failed to parse AI response`.
- **Shape validation** before returning: assert `weeks[].days[].exercises[]` (workout) or `meals[]` (diet) exist and are non-empty; if not, retry once with a tightened prompt, then fail loudly with the reason.
- Lower per-attempt timeout for this purpose and drop the retry count to 2 so a hard failure surfaces in <60s instead of ~3 minutes.
- Keep the existing owner/admin/manager role gate as-is (it already matches the requirement).

### 2. Real progress UI (frontend)
- Replace the static message in `CreateAI.tsx` with a **generation progress panel**: indeterminate-then-timed progress bar, elapsed-seconds counter, and staged labels ("Reading member profile" → "Matching gym equipment / meal catalog" → "Composing week 1" → "Building rotation variants" → "Finalising").
- Add a **client-side timeout + Cancel** (AbortController on the invoke) at 90s, so the button can never hang forever.
- Disable the Generate button and show a spinner inside it during the call; on error, show the real server message plus a "Try 2 weeks instead" quick action when the failure was a size/timeout failure.
- Skeleton + empty/error states on the preview step so a partial plan never renders blank.

### 3. Cleanup
- Remove the now-dead multi-week prompt scaffolding and the unused `rotation` fallback branches that are superseded by server-side week expansion.
- No files deleted wholesale — `CreateAI.tsx`, `PreviewPlan.tsx`, `CreateManual.tsx`, `Templates.tsx` and `planNormalizer.ts` are all still in use; the normalizer already handles both AI and manual shapes and stays the single parse path.

### 4. Test
- Deploy the function and run a real end-to-end generation for both `workout` and `diet` (with and without rotation, 4-week and 12-week) via a direct function call, and confirm: HTTP 200, valid JSON, correct day count, `daysPerWeek` honoured, and total latency logged in `ai_call_logs`.

## Technical notes
- Files touched: `supabase/functions/generate-fitness-plan/index.ts`, `supabase/functions/_shared/ai-runtime.ts` (allow per-call token override — already supported, just needs to be passed), `src/pages/fitness/CreateAI.tsx`, `src/services/ptService.ts` (abort signal), plus one migration to update `ai_purposes.fitness_plan.max_tokens`.
- No schema changes to plan tables; the stored plan JSON shape stays identical so `planNormalizer.ts`, `PreviewPlan`, `AssignPlanDrawer` and the member dashboard keep working unchanged.
