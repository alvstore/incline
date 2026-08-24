---
name: lovable-design-critic
description: "Use when reviewing or polishing a screen, component, page or drawer before shipping — visual hierarchy, spacing rhythm, contrast, typography, state coverage, motion and responsive behaviour. Triggers: 'does this look right', 'polish this page', 'design review', 'UI feels off', 'make it premium', or any Incline screen redesign. Distilled from sarthakrastogi/design-ai-agent (lovable) and adapted to Incline's Vuexy design system."
metadata:
  origin: sarthakrastogi/design-ai-agent (lovable) — adapted
  version: "1.0.0"
---

# Lovable Design Critic

A pre-ship review pass for a single screen. Run it *after* the screen works and *before* you call it done. For deep UI system work (new component families, tokens, full design languages) defer to the `ui-ux-pro-max` skill — this skill is the fast critique loop, not a replacement for it.

## How to run a critique

1. **Look at it.** Screenshot the real screen with Playwright at 1440, 1024, 768 and 375 px. Never critique from source alone.
2. **Score the seven axes** below. Anything below "good" is a finding.
3. **Report findings ranked by severity** with the exact file:line and a concrete replacement, not adjectives.
4. **Fix, re-screenshot, confirm.**

## The seven axes

### 1. Hierarchy
One unmistakable focal point per view. Ask: where does the eye land first, and is that the thing that matters?
- Primary metric or CTA is visually loudest; secondary actions are ghost/outline.
- No two elements compete at the same weight for the same job.
- Section labels are quiet (`text-xs font-semibold text-slate-500 uppercase tracking-wider`); data is loud (`text-2xl font-bold text-slate-900`).

### 2. Spacing rhythm
- Spacing comes from one scale (4/8-based Tailwind steps). No arbitrary `mt-[13px]`.
- Related things are closer than unrelated things — proximity does the grouping, not borders.
- Card padding is consistent across siblings; page gutters consistent across routes.
- Dense data screens still breathe: minimum `gap-4` between cards, `py-3` per table row.

### 3. Contrast and colour
- Text contrast ≥ 4.5:1 everywhere, including on gradient hero cards.
- Colour carries meaning, never decoration: emerald = healthy/paid, amber = partial/warning, red = overdue/destructive, blue = frozen, slate = neutral.
- No more than one gradient surface per viewport.
- Never hardcode `text-white` / `bg-black` / `bg-[#hex]` — use semantic tokens so theming holds.

### 4. Typography
- Inter only. Max three sizes and two weights per screen.
- Numbers in tables and money columns are tabular/right-aligned.
- No sentence longer than ~75 characters in body copy.

### 5. State coverage (most common failure)
Every data surface needs all four, and you must be able to point at the code for each:
- **Loading** — skeletons shaped like the real content, never a bare spinner on an empty page.
- **Empty** — icon + one-line explanation + the primary action that resolves it.
- **Error** — human sentence + retry affordance. Never a raw error string dumped to the user.
- **Success/populated** — the happy path.
Also: button disabled + inline spinner during async; optimistic toggles for switches.

### 6. Motion
- 150–300 ms, ease-out. Anything slower feels broken; anything faster is invisible.
- Animate transform and opacity only.
- Hover states on every interactive element; visible focus rings (`focus:ring-2 focus:ring-indigo-500`).
- No looping/attention-seeking animation in an admin product.

### 7. Responsive and touch
- Check 375 px first. No horizontal scroll, ever.
- Touch targets ≥ 44×44 px.
- Tables collapse to stacked cards on mobile rather than shrinking to unreadable.
- Mobile layouts use `100dvh`, `viewport-fit=cover` and safe-area padding.

## Incline house rules (hard constraints — a violation is always a finding)

- **Side drawers, not dialogs.** Every create/edit/multi-field form is a right-side `Sheet` (`sm:max-w-lg`/`xl`) with sticky header, scrollable body, sticky footer. Center dialogs are only for simple destructive confirmations.
- **Cards:** `rounded-2xl bg-white shadow-lg shadow-slate-200/50`, no borders. Hover: `transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10`. Hero/KPI cards use `bg-gradient-to-r from-violet-600 to-indigo-600` with white text.
- **Icons:** `lucide-react` only. No emojis as icons. Icon badges: `bg-indigo-50 text-indigo-600 p-2 rounded-full` (destructive: red-50/red-600, success: emerald-50/emerald-600). 16 px inline, 20 px card headers.
- **Status is always a coloured badge**, never plain text: `rounded-full px-2.5 py-0.5 text-xs font-medium` in the semantic pair for that state.
- **Page background** is `slate-50`; content sits on white cards.
- **Nav active state:** `bg-indigo-50 text-indigo-700 font-medium rounded-lg`.
- **Money** is INR with grouping, and only rendered to roles allowed to see financials.
- **Icon-only buttons** carry `aria-label`; every input has a real `<label>`.

## Output format

```
FINDING <n> — <axis> — <severity: blocker | major | minor>
Where:  src/pages/Foo.tsx:214
Now:    plain grey text renders the payment status
Should: emerald/amber/red badge per the status palette
Why:    status is scannable colour in every other Incline surface; this breaks the pattern
```

Close with a one-line verdict: ship, ship-after-blockers, or redesign.
