# Incline design system

Source of truth: tokens in `src/index.css` (light `:root`, dark `.dark`) exposed through `tailwind.config.ts`. This guide documents them; it never redefines them. **Never hardcode colors** (no hex/rgb, no `bg-slate-*`, `text-white`, `bg-black`).

## 1. Color tokens
| Token | Tailwind | Light | Dark | Use |
|---|---|---|---|---|
| background | `bg-background` | soft off-white | deep navy | page |
| foreground | `text-foreground` | navy | near-white | body text |
| card / popover | `bg-card` | white | navy surface | all content containers |
| primary | `bg-primary` `text-primary` | navy | orange | main actions |
| accent | `bg-accent` `text-accent` | orange | orange | highlights, active state |
| secondary | `bg-secondary` | light grey-blue | navy | secondary buttons, hover |
| muted | `bg-muted` `text-muted-foreground` | grey | navy / grey text | labels, empty states |
| success / warning / info / destructive | `bg-success` etc. | — | — | status |
| border / input / ring | `border-border` `ring-ring` | — | — | dividers, inputs, focus (orange) |
| sidebar-* | `bg-sidebar` … | always dark navy, orange active | | navigation |
| lux-* | `hsl(var(--lux-gold))` | public marketing site only | | |

Alpha variants: `bg-primary/10`, `border-border/60`, `bg-card/80`. Gradients: `var(--gradient-primary|accent|hero)`.

### Status badges
Pattern `bg-{status}/10 text-{status} border border-{status}/20`:
Active/Paid → success · Frozen → info · Partial → warning · Overdue → destructive · Pending → `bg-muted text-muted-foreground border-border`.

## 2. Typography
- Font: Inter (`font-sans`); Oswald (`font-oswald`) only for marketing display.
- Page title `text-2xl font-semibold tracking-tight`; card title `text-base font-semibold`.
- Stat `text-3xl font-bold tabular-nums`; label `text-xs font-semibold uppercase tracking-wide text-muted-foreground`.
- Body `text-sm`; helper `text-xs text-muted-foreground`. Money: `₹` + `en-IN` grouping, `tabular-nums`.

## 3. Shape, spacing, elevation
- Radius base `--radius` 0.75rem: inputs/buttons `rounded-lg`, cards `rounded-xl`/`rounded-2xl`, pills `rounded-full`.
- Spacing scale 4px; card padding `p-5`/`p-6`; grid gaps `gap-4`/`gap-5`; mobile page `px-4`.
- Elevation: soft shadows (Vuexy style), no heavy drop shadows; hover `hover:bg-secondary transition-colors duration-150`.

## 4. Layout
- Dashboards: bento `grid grid-cols-12` with mixed `col-span-*`; collapse to 1 column below `md`.
- All content in cards. Mobile: `100dvh`, safe-area (`pb-safe`), bottom dock for member/team roles, ≥44px targets.

## 5. Components
- Forms: right-side `Sheet` (`sm:max-w-lg|xl`), sticky header/footer, scroll body. Dialog/AlertDialog only for destructive confirmations.
- Tables: sticky header `bg-card`, row hover `bg-muted/50`, "Showing X of Y" pagination; wide tables scroll inside their card.
- Every data view: Skeleton loading, error fallback with retry, empty state (lucide icon + CTA).
- Icons: `lucide-react` only, `h-4 w-4` inline / `h-5 w-5` in cards. No emojis.
- Charts: Recharts or SVG with `hsl(var(--primary|accent|success|…))`, grid `hsl(var(--border))`.

## 6. Motion
- Default `transition-colors duration-150`; enter 0.32s `cubic-bezier(0.22,1,0.36,1)`; stagger 0.06s.
- Team mobile timings: see [team-pwa-motion-blueprint.md](team-pwa-motion-blueprint.md).
- Respect `prefers-reduced-motion` everywhere.

## 7. Accessibility
Contrast ≥ 4.5:1 (guaranteed by token pairs `x` / `x-foreground`), visible `ring-ring` focus, labelled inputs, `aria-label` on icon buttons, `cursor-pointer` on clickables.

## 8. Review checklist
Tokens only · cards rounded-xl · lucide icons · loading/error/empty states · Sheet for forms · works in light + dark · no horizontal overflow at 375px.
