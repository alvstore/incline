# Fix plan — AI plan generation timeouts + 3 related System Health clusters

## What the evidence shows

Clusters 1, 3 and 4 are the **same root cause**: a long-running request is killed by the browser before the server finishes. Cluster 2 is separate (memory on the MIPS photo sync).

Confirmed from the edge logs for `generate-fitness-plan`:

- Run started 11:33:23, finished successfully 11:36:03 — **160 seconds**.
- On the way it logged `retrying — AI returned days without any exercises` plus two `[ai-dispatcher] transient google fail (attempt N/3) — retrying`.
- It ended with `Http: connection closed before message completed` — the browser had already gone.

The client gives up at 90s (`CreateAI.tsx` hard-aborts the AbortController), so the plan *is* generated on the server but the user only sees an error. That is the whole "cannot generate plan" complaint.

Why runs exceed 90s today:
- AI dispatcher: up to **3 attempts × 60s timeout** each, plus backoff.
- On top of that: a **shape retry** (invalid AI JSON) and a **differentiation retry** (plan too similar to previous). Each of those is another full dispatcher cycle.
- Worst case is well over 5 minutes; nothing can survive a synchronous browser wait.

## Cluster-by-cluster

**Cluster 1 — `/fitness/create/ai` "Fetch is aborted" (2x)**
Root cause: 90s client abort during a 160s server run.
Files: `src/pages/fitness/CreateAI.tsx`, `src/services/ptService.ts`, `supabase/functions/generate-fitness-plan/index.ts`, `supabase/functions/_shared/ai-dispatcher.ts`.

**Cluster 4 — `/fitness/create/manual` "Load failed" (1x)**
Same family: Safari's wording for an aborted/dropped fetch on the same generation path (manual editor pulls the same equipment/plan endpoints). Fixed by the same change; no separate fix.

**Cluster 3 — `/dashboard` "Failed to fetch" (1x)**
Same family, single occurrence, transient network drop on a dashboard query. No code defect found. Handled by noise-filtering rather than a code fix (see below).

**Cluster 2 — `sync-to-mips` "not having enough compute resources" (1x)**
Separate cause: `normalizePhotoBytes` decodes the full member photo into memory with `imagescript` and loops re-encoding to hit the 400KB target. A large source image blows the function's memory ceiling. File: `supabase/functions/sync-to-mips/index.ts`.

## The fix

### 1. Make plan generation a background job (removes clusters 1 and 4)

Stop waiting on one long HTTP request.

- New table `ai_plan_jobs` (id, branch_id, requested_by, type, request payload, status `queued|running|done|error`, `stage`, result JSONB, error text, timestamps) with RLS + GRANTs scoped to owner/admin/manager and the requesting user.
- `generate-fitness-plan` gains two modes:
  - `POST { ...existing body, async: true }` → insert the job row, kick the existing generation inside `EdgeRuntime.waitUntil(...)`, return `{ job_id }` in under a second.
  - The background worker writes `stage` as it goes (`building prompt` → `calling AI` → `retry` → `enforcing equipment` → `expanding weeks` → `done`) and stores the final plan on the row.
- `ptService.generateFitnessPlan` switches to: start job → poll `ai_plan_jobs` (Realtime subscribe, 2s polling fallback) → resolve with the stored plan.
- `CreateAI.tsx` drops the 90s abort. `GenerationProgress` renders the live `stage` text, elapsed time, and a Cancel that marks the job cancelled. Refreshing the page no longer loses a running generation — the job is resumable from its id.

### 2. Cut the worst-case runtime (so jobs finish in ~40-70s)

- `_shared/ai-dispatcher.ts`: per-attempt timeout 60s → **35s**; attempts 3 → **2**. A stuck provider now fails fast instead of eating 3 minutes.
- `generate-fitness-plan`: allow **at most one** extra AI round trip in total — if the shape retry already ran, skip the differentiation retry and accept the plan (it is still equipment-enforced and periodised). Log the skip.
- Keep the existing template-week + server-side `expandWeeks` approach — that is already the cheap path.

### 3. Surface the real failure

- Job rows store the provider error text, so the UI shows "Google provider timed out — retry" instead of a generic edge error.
- 402/429 from the gateway map to explicit messages (credits exhausted / rate limited).

### 4. MIPS photo memory (cluster 2)

In `sync-to-mips`:
- Lower the pre-decode refusal ceiling and, before `decodeImage`, downscale in a single pass to a bounded max dimension instead of iterative re-encode loops.
- Wrap normalization in a try/catch that falls back to "queue photo for `mips-face-sweep`" rather than failing the whole person sync, so a heavy image never takes the function down.

### 5. Dashboard noise (cluster 3)

Add `Failed to fetch` / `Load failed` with no stack to the benign-noise filter in `src/lib/errorReporter.ts` **only** when `navigator.onLine === false` or the request was aborted, so genuine backend outages still report.

## Technical summary

- Migration: `ai_plan_jobs` table + RLS + GRANTs (`authenticated` scoped by branch/requester, `service_role` all).
- Edge: `generate-fitness-plan` (async job mode, single-retry budget), `_shared/ai-dispatcher.ts` (35s / 2 attempts), `sync-to-mips` (bounded photo decode).
- Frontend: `src/services/ptService.ts` (job start + subscribe), `src/pages/fitness/CreateAI.tsx` (no client abort, live stage), `src/components/fitness/GenerationProgress.tsx` (stage text + elapsed), `src/lib/errorReporter.ts`.
- Verification: generate one workout and one diet plan end to end, confirm the job row reaches `done`, confirm no new `Fetch is aborted` fingerprints, and re-run a MIPS photo sync for a member with a large photo.
