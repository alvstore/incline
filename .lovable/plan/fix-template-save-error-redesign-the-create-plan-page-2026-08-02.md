# Fix template save error + redesign the Create Plan page

## What's broken

Saving a plan as a template fails with:

```text
null value in column "target_gender" of relation "fitness_plan_templates" violates not-null constraint
```

Confirmed cause (verified against the live table and the save code):

- `fitness_plan_templates.target_gender` is `NOT NULL DEFAULT 'any'`, and `target_experience` is `NOT NULL DEFAULT '{}'`.
- The "Save as Template" action on the Preview screen explicitly sends `target_gender: null` and `target_experience: null` when the plan has no audience targeting set. Sending an explicit `null` overrides the column default, so Postgres rejects the insert.

This hits every plan saved without targeting — both AI-generated and manual.

## The fix

1. In the Preview screen's save handler, stop sending explicit nulls for the two non-null columns: fall back to `'any'` for gender and `[]` for experience.
2. Harden the shared `createPlanTemplate` service so it strips `undefined`/`null` values for these two fields regardless of caller — this also protects the AI create screen and any future caller.
3. No database change is needed; the column defaults are already correct.

## Create Plan page redesign (/fitness/create)

Rebuild the page visually using the active `ui-ux-pro-max` design skill, staying inside the project's Vuexy system (rounded-2xl cards, soft shadows, indigo/violet accents, lucide icons only). No logic or data-fetch changes:

- **Hero header** — gradient indigo/violet band with title, one-line purpose, and a primary "Start with AI" CTA.
- **Pipeline strip** — keep Meal Catalog → Templates → Assignments, but as polished stat cards with icon badges, tabular counts, skeletons while loading, and a proper zero state instead of a bare `0`.
- **Mode cards** — AI vs Manual as two equal-height feature cards with clearer benefit copy, a "Recommended" badge on AI, hover lift, and full-card keyboard focus rings.
- **Manual card** — Workout / Diet as two large, 44px+ tap targets with icon + short descriptor.
- **Quick links** — turn the two ghost buttons into a compact secondary row that doesn't compete with the primary actions.
- **Responsive + a11y** — verified at 375 / 768 / 1024 / 1440, aria-labels on icon-only controls, visible focus rings, no horizontal scroll.

## Note on the skill request

`ui-ux-pro-max-v2` isn't available in this workspace; the active skill is `ui-ux-pro-max`, which I'll use for the redesign. New skills are added from Settings > Skills.

## Technical details

- `src/pages/fitness/PreviewPlan.tsx` — audience fallbacks in `handleSaveAsTemplate`.
- `src/services/fitnessService.ts` — normalize `target_gender` / `target_experience` inside `createPlanTemplate`.
- `src/pages/fitness/CreateModePicker.tsx` — presentation rewrite only; queries, roles gating and navigation targets stay identical.
