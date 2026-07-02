# Launch Countdown — "26 July 2026" Moment

## Intent
Turn the flat "BEGIN YOUR ASCENT • 2026" line into a **living countdown** to `Sunday, 26 July 2026 00:00 IST`, without changing hero layout, 3D scene, register flow, or breaking the pricing embargo. Everything degrades gracefully to a static date label.

## What the user will see

1. **Hero scroll indicator (upgraded in place)**
   Existing line:
   ```
   BEGIN YOUR ASCENT • 2026
   ```
   New line (same spot, same typography, same pulse):
   ```
   BEGIN YOUR ASCENT · SUN 26 JUL 2026
   ── 142d : 07h : 22m : 18s ──
   ```
   - Ticks every second via a single `setInterval`; pauses when tab is hidden (`visibilitychange`) to keep it cheap.
   - Honours `prefers-reduced-motion`: no `animate-pulse`, no seconds tick — shows just `142 days to go`.
   - After the moment passes: collapses to `WE ARE OPEN · SUN 26 JUL 2026` (no negative numbers, no broken UI).

2. **Floating "Founding Membership" chip (new, bottom-right, desktop + mobile)**
   Small glass pill, appears after 1.5s idle:
   ```
   ◐ Launching in 142 days  →  Reserve your spot
   ```
   - Click opens the **existing** `RegisterModal` (no new flow, no new route).
   - Dismissable (session-scoped `sessionStorage` flag). Never re-nags the same session.
   - Hidden on `prefers-reduced-motion` and when the register modal is already open.
   - Never mentions pricing — pivot copy aligns with the SSOT embargo rule.

3. **Section 8 (final CTA), if it exists** — append the same countdown as a single muted line under the primary CTA. Purely additive text; no button/layout changes.

## Technical plan

### New file: `src/lib/launch.ts`
Single source of truth for the date + helpers. No React.
```ts
export const LAUNCH_ISO = '2026-07-26T00:00:00+05:30'; // Sun 26 Jul 2026 IST
export const LAUNCH_LABEL_SHORT = 'Sun 26 Jul 2026';
export const LAUNCH_LABEL_LONG  = 'Sunday, 26 July 2026';
export function msUntilLaunch(now = Date.now()) { … }
export function formatCountdown(ms: number): { d:number; h:number; m:number; s:number; past:boolean };
```
Matches the existing SSOT already used in `ai-agent-brain.ts` and `public/llms*.txt`.

### New file: `src/components/launch/LaunchCountdown.tsx`
- Tiny presentational component: `<LaunchCountdown variant="inline" | "chip" | "line" />`.
- Uses one shared `useCountdown()` hook (single interval per mount, cleared on unmount, paused on `document.hidden`).
- Reduced-motion + past-launch branches handled inside; parent doesn't care.
- No new dependencies.

### New file: `src/components/launch/FoundingChip.tsx`
- Fixed-position glass pill (`bottom-4 right-4 z-40`), keyboard-focusable button, `aria-label="Reserve your Founding Membership spot"`.
- Fires the same custom event `RegisterModal` already listens to (or dispatches `window.dispatchEvent(new CustomEvent('open-register'))` — we'll reuse whatever `RegisterModal` already exposes; if none, we lift a small callback via `useState` in `InclineAscent`).

### Edits
- **`src/components/ui/ScrollOverlay.tsx`** — replace the `BEGIN YOUR ASCENT • 2026` `<span>` with `<LaunchCountdown variant="inline" />`. No other change to that file.
- **`src/pages/InclineAscent.tsx`** — mount `<FoundingChip />` lazily (idle callback, same pattern as `RegisterModal`) so it never blocks LCP. Skip mount if `prefers-reduced-motion`.
- **`index.html`** — extend existing JSON-LD with a single `Event` object:
  ```json
  { "@context":"https://schema.org", "@type":"Event",
    "name":"The Incline Life — Grand Opening",
    "startDate":"2026-07-26T00:00:00+05:30",
    "eventStatus":"https://schema.org/EventScheduled",
    "eventAttendanceMode":"https://schema.org/OfflineEventAttendanceMode",
    "location":{ "@type":"Place","name":"The Incline Life","address":"Sector 14, Udaipur, Rajasthan 313001, IN" },
    "url":"https://theincline.in/" }
  ```
  Keeps existing `openingDate` on `HealthClub` untouched.

## What we deliberately do NOT do
- No pricing, tier, or ₹ number anywhere (embargo remains).
- No changes to the 3D scene, `Scene3D`, canvas, or scroll-driven animations.
- No new routes, no new backend calls, no `ai_knowledge` edits (already aligned last sprint).
- No changes to `ScrollProgressBar`, sound effects, register flow, or waiver.
- No new npm dependencies.

## Verification (post-build)
- Landing renders with countdown ticking; toggling reduced-motion in devtools removes the seconds tick.
- Playwright headless: navigate `/`, screenshot hero, assert `Sun 26 Jul 2026` text present, assert `FoundingChip` becomes visible ~1.5s later, click → register modal opens.
- Set system clock forward (unit test on `formatCountdown`) to confirm the past-launch branch renders `WE ARE OPEN` instead of negative numbers.
- `rg -n "26 July 2026|2026-07-26"` still shows every existing SSOT hit intact; new hits only in `src/lib/launch.ts`, `index.html`, and the two new components.
- Lighthouse: LCP unchanged (chip mounts on idle, countdown is text-only).

## Files touched
- **New:** `src/lib/launch.ts`, `src/components/launch/LaunchCountdown.tsx`, `src/components/launch/FoundingChip.tsx`
- **Edit:** `src/components/ui/ScrollOverlay.tsx` (1 line swap), `src/pages/InclineAscent.tsx` (lazy mount chip), `index.html` (add Event JSON-LD)

Skills used: `ui-ux-pro-max` (motion + hierarchy check), `code-reviewer` (kept components <200 lines, no `any`, TanStack-free presentational only, a11y).
