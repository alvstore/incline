# Skills activation + /fitness/create redesign

## Skills

`ui-ux-pro-max` is present in this workspace as a draft, but not active — nothing in the active skill set right now. Activate it plus the supporting design/QA skills so the redesign runs on real design intelligence rather than guesswork:

- `ui-ux-pro-max` — style, palette, typography and UX-guideline engine (primary).
- `frontend-design` — React/Tailwind implementation quality bar.
- `ui-design-system` — token/component consistency with the existing Vuexy system.
- `a11y-audit` — contrast, focus, tap-target and label checks at the end.

Note: skills can also be managed by you from Settings > Skills; this plan activates the four above.

## Audit of /fitness/create (current state)

The page (`CreateModePicker.tsx`, 382 lines) already has a gradient hero, three pipeline tiles, AI vs Manual cards and two secondary links. What's weak:

1. **Duplicated CTAs** — "Start with AI" appears in the hero and again inside the AI card; "Build manually" appears in the hero and again as two manual tiles. Four routes, six buttons: the primary action is not obvious.
2. **Pipeline strip is decorative** — Catalog → Templates → Assignments reads as three stat buttons with arrows, but it does not tell the user what to do next (e.g. "0 meals — diet plans will be thin until you add some").
3. **No entry context** — nothing on the page tells you who the plan is for. Member selection only happens on the next screen, so the flow is mode-first instead of member-first.
4. **No recent activity** — the last plans created/assigned are one click away but never surfaced, so repeat work (duplicate a plan for another member) restarts from zero.
5. **Manual path is under-explained** — two tiny tiles with one-line hints; no indication that manual can start from a template.
6. **A11y/responsive gaps** — the whole AI card is a `role="button"` that also contains a real button (nested interactive), pipeline arrows disappear under `sm` leaving three orphan cards, and hard-coded slate/indigo classes bypass theming in dark mode.

## Redesign plan

Presentation-only rewrite of `CreateModePicker.tsx` (routes, queries and role gating unchanged), driven by a `ui-ux-pro-max` design-system lookup for a data-dense admin surface:

- **One primary action.** Hero keeps a single CTA (AI for admins/managers, Workout for trainers); the secondary path becomes a quiet text link. Remove the duplicate button inside the AI card and make the card itself the target (no nested interactive elements).
- **Member-first option.** Add an optional "Who is this for?" combobox in the hero that pre-selects a member and passes it into `/fitness/create/ai` and `/fitness/create/manual` as a query param, so the next screen is already filled. Skipping it keeps today's behaviour.
- **Actionable pipeline.** Convert the three tiles into a single readiness strip with count, a one-line status and a contextual action ("Add meals", "Browse 12 templates", "View 8 assignments"), stacked cleanly on mobile with a vertical connector instead of vanishing arrows.
- **Recent plans row.** Compact list of the last 5 plans created (name, type, member, date) with "Duplicate" and "Open" actions, using the existing templates/assignments data already fetched.
- **Manual card upgrade.** Workout / Diet tiles get an icon, a benefit line and a "Start from template" secondary affordance.
- **Tokens and a11y.** Replace raw `slate-*`/`indigo-*` utilities with semantic tokens so dark mode holds; verified at 375 / 768 / 1024 / 1440; aria-labels on every icon-only control; 44px minimum targets; visible focus rings.

## Technical details

- Activate skills: `ui-ux-pro-max`, `frontend-design`, `ui-design-system`, `a11y-audit`.
- `src/pages/fitness/CreateModePicker.tsx` — full presentation rewrite; extract `PipelineTile`, `ManualTile`, `RecentPlansCard` into `src/components/fitness/`.
- New optional read: recent plans list via the existing `member_fitness_plans` query key, limited to 5 and branch-scoped through `useBranchContext`.
- `CreateAI.tsx` / `CreateManual.tsx` — read an optional `memberId` search param to prefill; no other logic touched.
- Verification: Playwright screenshots of the page at the four breakpoints before/after.
