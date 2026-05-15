## Diagnosis (root cause of "all models showing google")

I queried `ai_provider_configs`:

```
scope          | provider    | default_model                | active | default
all            | google      | gemini-flash-latest          | t      | t
all            | lovable     | google/gemini-2.5-flash      | f      | f
fitness_plans  | openrouter  | inclusionai/ring-2.6-1t:free | t      | f   ← NOT default
```

The OpenRouter row you set up for `fitness_plans` is **active but not marked default**. The dispatcher (`_shared/ai-dispatcher.ts::resolveProvider`) requires `is_active=true AND is_default=true` for the scope, so it falls back to the `all` scope (google) — which is why every Purpose card and the Edit drawer show Google models. The architecture is correct; the row is just missing the default flag and the UI doesn't surface this clearly.

I also audited every AI edge function. Good news: all 9 AI functions (`ai-auto-reply`, `ai-dashboard-insights`, `ai-draft-campaign-message`, `ai-generate-whatsapp-templates`, `automation-brain`, `generate-fitness-plan`, `google-reviews-brain`, `lead-nurture-followup`, `score-leads`) already route through `_shared/ai-runtime.generateOnce → callAI → resolveProvider`. So once the provider rows are correct, every purpose will honor OpenRouter / Groq / etc. with Lovable as fallback only.

What's wrong is a mix of dead leftover code and weak UX.

---

## Plan

### 1. Data fix (one-shot migration)

Promote the only-active provider for a scope to `is_default=true` automatically, and add a partial unique index so the invariant holds going forward.

```sql
-- Promote scopes where exactly one active provider exists but none is default
UPDATE ai_provider_configs a SET is_default = true
WHERE is_active = true AND is_default = false
  AND NOT EXISTS (SELECT 1 FROM ai_provider_configs b
                  WHERE b.scope = a.scope AND b.is_active AND b.is_default);

-- Enforce: at most one default per scope
CREATE UNIQUE INDEX IF NOT EXISTS ai_provider_configs_default_per_scope
  ON ai_provider_configs (scope) WHERE is_default = true;
```

After this, `fitness_plans` resolves to OpenRouter `inclusionai/ring-2.6-1t:free`, and the Purposes editor for *Fitness Plan Generator* will show OpenRouter's model list.

### 2. Providers tab UX (`AIProvidersSettings.tsx`)

- Add an inline **"Set as default for this scope"** button on every active row that isn't already default — one click, no drawer.
- Show a red **"Active but not default — won't be used"** warning chip on those rows.
- When saving a provider config with `is_active=true` and no other default exists for the scope, auto-set `is_default=true`.
- When marking a row default, atomically demote any other default row for the same scope (single RPC `set_default_ai_provider(scope, id)` to avoid the unique-index race).

### 3. Purposes tab UX (`AIPurposesTab.tsx`)

- At the top of each purpose card, badge the **resolved scope source** (`scope: fitness_plans` vs `scope: all (inherited)`) so it's obvious whether the Providers tab needs work.
- In the Edit drawer, replace the static amber banner with an **inline "Change provider" link** that opens the Providers tab pre-filtered to that scope — eliminates the two-tab dance.
- Add a **"Use cheapest available model"** quick-pick button per purpose; reads from `PROVIDER_DEFAULTS[provider].models` filtered to entries containing `:free`, `lite`, `nano`, `mini`, or `flash` and picks the first.
- Test toast: when `fallback_used=true`, also show the underlying error (currently just says "fallback to Lovable").

### 4. Cost reduction defaults

In `src/lib/ai/providerCatalog.ts`, lower `PURPOSE_DEFAULTS.max_tokens` for chatty purposes that don't need long output:
- `whatsapp_reply` 600 → 350, `lead_nurture` 400 → 250, `review_reply` 400 → 250, `automation_rule` 400 → 200, `dashboard_insight` 1200 → 800.
- Backfill the same values into `ai_purposes` rows where the user hasn't customized them (only update where current value matches the old default).

Also add a `tier` field (`free | cheap | premium`) to each entry in `PROVIDER_DEFAULTS[].models` so the picker can render a tiny green "FREE" badge next to OpenRouter `:free`, Groq, Together free Llama, etc., nudging selection toward zero-cost tiers.

### 5. Dead-code cleanup in edge functions

These functions all delegate to `ai-runtime`/dispatcher but still carry top-level `Deno.env.get("LOVABLE_API_KEY")` reads (and in two cases throw if missing) — that's misleading: the key isn't used in the call path anymore, and it makes it look like the function is hard-wired to Lovable.

- `ai-dashboard-insights/index.ts` — remove lines 16–17
- `ai-draft-campaign-message/index.ts` — remove lines 34–35
- `ai-generate-whatsapp-templates/index.ts` — remove the unused `apiKey` block
- `automation-brain/index.ts` — drop the `LOVABLE_API_KEY` const and the `&& LOVABLE_API_KEY` guard (use `rule.use_ai` only)
- `generate-fitness-plan/index.ts` — remove lines 118–121
- `google-reviews-brain/index.ts` — remove unused `LOVABLE_API_KEY` constant
- `lead-nurture-followup/index.ts` — remove unused constant + `LOVABLE_API_KEY &&` guard
- `score-leads/index.ts` — remove the throw at lines 18–19
- `process-email-queue/index.ts` — only AI usage is the welcome-email helper; verify whether it should also route through dispatcher (separate decision).

### 6. Test functions — keep all three, document scope

Not duplicates after audit; each has one unique caller:
- `ai-test-purpose` ← Purposes tab "Test" button (pings resolved provider for a purpose)
- `test-ai-provider` ← Providers tab "Test connection" (pings a specific provider config)
- `test-ai-tool` ← Agent Control Center (executes a single AI tool)

I'll add a one-line header comment to each clarifying its role and confirm their import graphs are minimal. No deletions.

### 7. Edge function dependency audit (lightweight)

Quick sweep using `rg` to confirm no edge function still pulls a hard-coded provider URL outside the dispatcher (other than the three test functions, which legitimately do). Already confirmed clean for the 9 production AI functions; just ship as a note in the commit.

---

## Files touched

- migration: promote single-active-to-default + unique partial index + `set_default_ai_provider` RPC + `ai_purposes` token backfill
- `src/components/settings/AIProvidersSettings.tsx` — inline "Set as default", warning chip, auto-default on save
- `src/components/settings/AIPurposesTab.tsx` — inheritance badge, "Change provider" link, cheapest-model button, richer fallback toast
- `src/lib/ai/providerCatalog.ts` — lower `PURPOSE_DEFAULTS`, add `tier` per model
- 8 edge functions listed above — strip dead `LOVABLE_API_KEY` reads, bump version comments
- 3 test edge functions — header comment only

No schema changes beyond `ai_provider_configs` index and the RPC; no breaking changes to dispatcher signature.
