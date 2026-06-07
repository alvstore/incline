## Goal

Audit and refactor the three pages shown in the screenshots so every color comes from the semantic design tokens (`primary`, `foreground`, `muted-foreground`, `card`, `accent`, `destructive`, `success`, `warning`, `info`, `border`) instead of raw Tailwind palette classes (`indigo-600`, `violet-600`, `slate-900`, `emerald-500`, `amber-500`, etc.). This is required so the Theme Picker + light/dark mode actually change the look.

## Scope

Pages in scope:
1. **Trainers** — `src/pages/Trainers.tsx`
   - Plus drawers: `src/components/trainers/TrainerProfileDrawer.tsx`, `EditTrainerDrawer.tsx`
2. **Tasks (Mission Control)** — `src/pages/Tasks.tsx` (already clean) + all `src/components/tasks/*` files that flagged in the audit:
   - `TasksHeader.tsx`, `TaskStatsBento.tsx`, `TaskFilterPills.tsx`, `TaskBoard.tsx`, `TaskCard.tsx`, `TaskListView.tsx`, `TaskCalendarView.tsx`, `DueDatePill.tsx`, `AssigneeAvatar.tsx`, `taskTokens.ts`
3. **PT Packages** — `src/pages/PTSessions.tsx` (~140 hardcoded usages including the big hero/stat cards, "Top Performer", "Package Type Split", "Revenue by Trainer", tier gradients, status pills)

Out of scope: any other page, any business logic, any data-fetching code, drawers other than the ones above.

## Token Mapping (applied everywhere)

```text
bg-white, bg-slate-50           → bg-card / bg-background
text-slate-900                  → text-foreground
text-slate-700/600              → text-foreground / text-muted-foreground
text-slate-500/400              → text-muted-foreground
border-slate-200, border-*-200  → border-border
shadow-slate-200/50             → shadow-md (keep soft shadow, drop color)
bg-indigo-600, bg-violet-600,
gradient from-indigo to-violet  → bg-primary  (or gradient from-primary to-primary with brightness variation via /80)
text-indigo-700, text-violet-700→ text-primary
bg-indigo-50, bg-violet-50      → bg-primary/10
ring-indigo-500                 → ring-ring / ring-primary
bg-emerald-* / text-emerald-*   → bg-success / text-success (token exists in tailwind.config.ts)
bg-amber-* / text-amber-*       → bg-warning / text-warning
bg-red-* / text-red-*           → bg-destructive / text-destructive
bg-sky-* / text-sky-*           → bg-info / text-info
bg-rose-500 (cancelled bar)     → bg-destructive
```

For the gradient hero cards (Trainers "Active Trainers", PT "Top Performer", Tasks "Today's Focus") use `bg-gradient-to-br from-primary to-primary/70 text-primary-foreground` so the brand gradient follows the active theme.

For tier palettes in `PTSessions.tsx` (silver / gold / platinum) keep distinct hues but swap to token-aware equivalents:
- silver → `from-muted to-muted-foreground/40`
- gold   → `from-warning/80 to-warning`
- platinum / default → `from-primary to-primary/70`

## Approach

1. Read each target file once, then do a careful search-and-replace per file using the mapping table above. Group edits per file into a single `code--line_replace` where possible.
2. Preserve all layout/spacing/typography classes — only swap color tokens.
3. After edits, run the build (auto) and visually verify the three pages in light + one dark theme via the preview.

## Non-goals / constraints

- No changes to copy, layout, icons, or data.
- Status semantics stay the same (success=green, warning=amber, destructive=red, info=sky) — they just route through tokens so themes can re-skin.
- Keep `rounded-2xl`, soft shadows, and Vuexy density unchanged.

## Validation

- Toggle Settings → Appearance theme + dark mode; confirm Trainers, Tasks, and PT Packages re-skin instead of staying indigo/slate.
- Confirm contrast on hero gradient cards in both modes.
- No regressions in drawers opened from these pages.
