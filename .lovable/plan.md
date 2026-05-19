# Plan: Sidebar cleanup + Install UI/UX Pro Max + Redesign IG Automations panel

## 1. Sidebar cleanup

The "IG Comment-to-DM" entry in the sidebar is redundant — it just deep-links to the Communication Hub's Instagram tab, which is already reachable from "Communication Hub" → Instagram tab.

- Edit `src/config/menu.ts` (line 222): remove the `IG Comment-to-DM` item from the **Operations & Comm** group.
- Drop the now-unused `Instagram` icon import (line 7) if not referenced elsewhere in the file.
- Keep `/instagram-automations` route + the `navModules.ts` href registration so old bookmarks still redirect into the tab (no breakage).

## 2. Install the UI/UX Pro Max skill

Install the skill as a project-scoped Lovable skill (drafts go to `.agents/skills/`, then we activate with `skills--apply_draft`).

Steps:
- `mkdir -p .agents/skills/ui-ux-pro-max/{scripts,references,assets}`
- Copy bundled assets from the cloned repo:
  - `src/ui-ux-pro-max/scripts/{search.py, core.py, design_system.py}` → `.agents/skills/ui-ux-pro-max/scripts/`
  - `src/ui-ux-pro-max/data/*.csv` → `.agents/skills/ui-ux-pro-max/assets/data/`
  - `src/ui-ux-pro-max/templates/base/{skill-content.md, quick-reference.md}` → `references/`
- Write `.agents/skills/ui-ux-pro-max/SKILL.md` with frontmatter:
  ```yaml
  ---
  name: ui-ux-pro-max
  description: AI-powered design intelligence — 67 UI styles, 161 palettes, 57 font pairings, 99 UX guidelines. Use when redesigning or polishing UI, picking a color/typography system, or auditing a screen for UX issues.
  ---
  ```
  Body: short usage doc pointing at `scripts/search.py` with the `--design-system`, `--domain`, and `--stack react` flags, plus instructions to copy the script to `/tmp` before exec (per sandbox skill rules).
- Verify with `python3 .agents/skills/ui-ux-pro-max/scripts/search.py "saas admin dashboard" --design-system -p "Incline IG Automations"` to confirm the engine runs.
- Call `skills--apply_draft` with path `.agents/skills/ui-ux-pro-max` to activate it.

## 3. Redesign the IG Comment-to-DM panel using the skill

Scope is **visual only** — no business logic, query, or edge-function changes. Files in play:
- `src/components/ig-automations/IgAutomationsPanel.tsx` (main panel)
- Optional: `IgCampaignDrawer.tsx`, `IgRunsLogDrawer.tsx` for visual consistency only

Process:
1. Run the skill's design-system generator scoped to "SaaS automation control room / Instagram comment-to-DM" on stack `react` + `shadcn` to get a palette, typography, and pattern recommendation. Reconcile against the project's locked Vuexy tokens (indigo/violet, `rounded-2xl`, `shadow-lg shadow-slate-200/50`, Inter) — skill output informs **composition, density, hierarchy, motion**, not raw color tokens, since Vuexy is the locked design system per project memory.
2. Capture a screenshot of the current `/announcements?tab=instagram` panel as the redesign anchor.
3. Apply visual improvements in `IgAutomationsPanel.tsx`:
   - Hero strip: gradient KPI band (campaigns active · DMs sent · public replies · success-rate) using the Vuexy gradient card pattern, replacing the current plain stat tiles.
   - Campaign cards: convert to `rounded-2xl bg-white shadow-lg shadow-slate-200/50` cards with status pill, post thumbnail, keyword chips, and a compact metric row.
   - Add empty state, loading skeleton, and error state matching project standards.
   - Sticky filter/toolbar with clear visual grouping.
   - Trend chart: wrap in matching card, tighten spacing, use semantic chart colors.
   - Inline `Run history` peek with hover/expand affordance.
   - All buttons: 44px touch targets, focus rings, `cursor-pointer`, transition 150–300ms.
4. Preserve all existing data hooks, props, drawer triggers, and the `useIgMedia` error UI in `IgCampaignDrawer.tsx`.
5. QA: open `/announcements?tab=instagram`, verify drawer opens, refresh posts works, log drawer opens, no console errors, responsive at 375/768/1113 px.

## Out of scope

- No DB migrations, no edge-function changes, no changes to matcher/executor pipeline.
- No route changes for `/instagram-automations` (legacy redirect stays).
- No global theme/token changes — Vuexy palette stays the source of truth.

## Risk

Low. Sidebar removal is a one-line edit; skill install is sandboxed under `.agents/skills/`; redesign is presentation-only inside the IG panel. Existing IG DM ingestion, webhooks, AI brain, and cron remain untouched.
