## Part 1 — Why you can't reply from the dashboard

**Confirmed root cause (verified in the database and code):**

The Google Business Profile connection was never completed. The `google_business` integration row holds only `client_id`, `client_secret`, `api_key` — there is **no `refresh_token`**. Without it, `google-reviews-brain` falls back to the Places API lane, which is public and read-only. Every review is therefore stored with `source: "places"`, and `ExternalReviewsTab.tsx` line 365 disables the "Post reply to Google" button whenever `r.source === 'places'` (hence the "Places · read-only" badge on every card in your screenshot). The draft you typed was never rejected — the button simply can't fire.

Secondary gaps found:
- Reply posting (`replyToReview`) targets `mybusiness.googleapis.com/v4/{review}/reply`, which needs a Business Profile review name. Places reviews have no such ID, so even a forced click would fail.
- Nothing in the UI tells you *what to do* — the disabled state has only a tooltip. There's no visible "Connect Google" call-to-action on the Feedback page.
- `account_id`, `location_id`, and `place_id` are already saved, so once OAuth completes, the Business Profile lane can run immediately.

### What will be built

1. **Connection Status Banner (Feedback → External Reviews)**
   A Vuexy gradient status card at the top of the tab with three states:
   - *Read-only mode* (current): amber card explaining that replies need Business Profile access, with a primary "Connect Google Business Profile" button that launches the OAuth flow directly — no digging through Settings.
   - *Connecting / partial*: shows which of the 4 steps are done (Credentials → OAuth → Account → Location) as a compact stepper.
   - *Live*: emerald card showing account name, location name, last sync time, and review count.

2. **Guided 4-step connect drawer** (right-side Sheet, per project standard) replacing the current scattered flow: paste OAuth Client ID/Secret → "Connect Google" popup → pick Business Account → pick Location. Each step self-validates and shows the exact Google error text if it fails (redirect URI mismatch, API not enabled, no locations, etc.).

3. **Reply path hardening in `google-reviews-brain`**
   - Store the Business Profile `review name` on each row so replies always resolve.
   - When a Places review and a Business Profile review match (same author + text + date), merge them and promote `source` to `business_profile` so history typed under read-only mode becomes replyable.
   - Surface real Google API status + body on failure instead of a generic error.
   - Persist unsent drafts (typed reply survives refresh and becomes sendable the moment you connect).

4. **Review card UI/UX refresh (2026)**
   - Cleaner card: reviewer avatar, star row, relative time, verdict chip.
   - Reply composer with character counter (Google caps at 4096), tone chips (Warm / Concise / Apologetic), AI re-draft inline, and an explicit "Sent to Google · timestamp" state.
   - Disabled send button gets a visible inline reason bar instead of a hidden tooltip.
   - Skeleton, empty, and error states for the whole list.

## Part 2 — Why every AI plan looks the same

**Confirmed root causes:**

1. **The goal never changes the programming rules.** `ai_purposes.fitness_plan.system_prompt` is a single generic line ("You are a certified fitness coach…"), with **no model and no temperature set**. The goal is passed only as one bullet (`- Fitness Goals: …`) buried inside a long prompt that is otherwise dominated by a rigid JSON output contract plus a 100-line equipment list. The model treats it as a label, not as an instruction — so weight loss and muscle gain both come back as a generic 4-day split.
2. **No goal→parameter mapping exists anywhere.** Nothing tells the model that fat loss means higher density, shorter rest, conditioning finishers, and a calorie deficit, while hypertrophy means 8–12 reps, 90–120s rest, higher per-muscle volume, and a surplus.
3. **`expandWeeks` clones week 1 verbatim** into every later week, appending only a one-line progression note — so the plan also looks repetitive *within* itself.
4. **Equipment is a soft preference, never enforced.** The prompt says "prefer"; nothing validates the output. 56 of 73 machines have muscle groups tagged; the other 17 arrive with no metadata, so the model ignores them.

### What will be built

1. **Goal-specific programming engine** (new `_shared/plan-programming.ts`): a hard parameter block injected per goal — fat loss / muscle gain / strength / recomposition / endurance / general — defining split style, session count, rep ranges, rest, tempo, weekly volume per muscle, conditioning dose, and (for diet) calorie delta and macro split. The goal moves to the **top** of the prompt as a directive, not a bullet.

2. **Equipment enforcement, not suggestion**
   - Send the full operational catalog grouped by muscle group and movement pattern.
   - Add a server-side validation pass: every prescribed `equipment` value must match a real machine (fuzzy + alias). Anything unmatched is auto-substituted with the closest owned machine that trains the same muscle group, or downgraded to a bodyweight/free-weight alternative. A `equipmentMatchSummary { matched, substituted, total }` is returned like the existing diet catalog summary.
   - Flag the 17 untagged machines in the UI so they can be classified.

3. **Real variety between weeks and between plans**
   - Replace verbatim week cloning with a periodisation model: exercise-order rotation, accessory swaps drawn from the owned-equipment pool, and goal-appropriate volume/intensity waves plus a deload.
   - Add a deterministic variety seed per member+goal+date so two members with the same goal don't receive byte-identical programs.
   - Raise temperature for this purpose to a value that produces variation without breaking the JSON contract, and pin an explicit model on the `fitness_plan` purpose.

4. **Differentiation guard**: after generation, compare the exercise/meal signature against the member's last plan. If similarity is above threshold, auto-retry once with an explicit "produce a materially different program" instruction before returning.

5. **UI feedback on the Create-AI page**: the review step shows Goal → applied training parameters, equipment match rate, and how much the plan differs from the previous one. No change to the PDF output — that stays exactly as it is.

## Technical notes

- Files touched: `supabase/functions/google-reviews-brain/index.ts`, `supabase/functions/generate-fitness-plan/index.ts`, new `supabase/functions/_shared/plan-programming.ts`, `src/components/feedback/ExternalReviewsTab.tsx`, `src/components/settings/GoogleBusinessDiscovery.tsx` (folded into the new connect drawer), `src/pages/fitness/CreateAI.tsx`, `src/services/equipmentService.ts`.
- Migrations: add `source`, `gbp_review_name`, and `draft_reply` columns to the Google reviews table (with GRANTs and RLS per project rules); update `ai_purposes.fitness_plan` with a goal-aware system prompt, model, and temperature.
- Edge function version bumps and try/catch wrappers per project standard.
- **You will need to complete the Google OAuth consent step once in the new drawer** — that's the only action that cannot be automated from here.
