# Team mobile PWA — motion & layout blueprint (Halvi-inspired, Incline-themed)

Reference studied: `demo.codeandchill.store/halvi/` (React + GSAP Core/Flip + custom CSS + hand-built SVG charts).
We copy **structure and motion only**. Colors, fonts and radii always come from Incline tokens in `src/index.css` — never from the reference.

## 1. Theme rules (non-negotiable)
- No hex, rgb or Tailwind palette classes (`bg-slate-*`, `text-white`, `#…`). Use `bg-background`, `bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `text-primary`, `bg-primary`, `text-accent`, `border-border`, `ring-ring`, sidebar tokens.
- Translucency via token alpha: `bg-card/80`, `bg-primary/10`, `border-border/60`.
- Charts read colors from CSS variables: `stroke="hsl(var(--primary))"`, `fill="hsl(var(--accent) / 0.15)"`, grid `hsl(var(--border))`, labels `hsl(var(--muted-foreground))`.
- Status colors follow the project badge tokens (emerald/blue/amber/destructive pattern in project knowledge).
- Light/dark both work automatically because only tokens are used.

## 2. Layout
- Mobile shell: `min-h-[100dvh]`, safe-area padding (`pb-safe`), content padding `px-4`, bottom space for dock (`pb-24`).
- Bottom dock: floating pill, `bg-card/90 backdrop-blur border border-border rounded-2xl`, 5 slots with centre "+" quick-action (existing `TeamMobileDock.tsx`). Targets ≥ 44px.
- Home: greeting header → hero stat card → 2-col stat grid → chart card → activity list. Cards `rounded-2xl p-5`.

## 3. Motion tokens (exact timings)
| Token | Duration | Easing | Use |
|---|---|---|---|
| `fast` | 0.18s | `power2.out` | press, toggle, chip |
| `base` | 0.32s | `power3.out` | card enter, sheet content |
| `slow` | 0.55s | `expo.out` | hero, page enter |
| `flip` | 0.45s | `power3.inOut` | dock indicator, layout reorder (GSAP Flip) |
| `stagger` | 0.06s each | — | lists / grids |
| `count` | 1.2s | `power2.out` | number tickers |
| `chart` | 0.9s | `power2.inOut` | SVG path draw (strokeDashoffset) |
CSS equivalent of `power3.out`: `cubic-bezier(0.22, 1, 0.36, 1)`. Press scale `0.96`, enter offset `y: 12px, opacity 0`.

Keyframes: `pulse-dot` 1.6s ease-in-out infinite (live indicator, `bg-primary`); `tick-up`/`tick-down` 0.35s for changed numbers.

## 4. Implementation pattern
- `src/lib/motion.ts`: register `Flip`, export `dur(name)` returning 0 when `prefers-reduced-motion: reduce`.
- Use `useGSAP` / `gsap.context` scoped to a ref; always revert on unmount.
- Dock indicator: `Flip.getState(indicator)` → move to active tab → `Flip.from(state, { duration: .45, ease: 'power3.inOut' })`.
- Charts: plain SVG (sparkline, ring, bar), sizes via `viewBox`, colors via CSS variables, `role="img"` + `aria-label` with the value.

## 5. Accessibility
Reduced motion disables all non-essential animation; focus rings use `ring-ring`; contrast ≥ 4.5:1 is guaranteed by tokens; live numbers announce via `aria-live="polite"` only on user-triggered changes.

## 6. Scope
Applies to owner/admin/manager/staff/trainer mobile PWA screens. Data, permissions and branch scoping stay unchanged — this is presentation only.
