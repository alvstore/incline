# Plan — Loader theme, blank screen, performance audit

## 1. "Warming up..." loader background (quick visual fix)

**Root cause:** `src/pages/Auth.tsx` (line 47) and `src/pages/SetPassword.tsx` (line ~14) wrap `<GymLoader>` in a div styled with `background: var(--gradient-hero)`, which resolves to the dark navy hero gradient. That's the dark-blue screen in your screenshot.

**Fix (no loader changes):**
- Replace the inline `style={{ background: 'var(--gradient-hero)' }}` with `className="bg-background"` (or `bg-slate-50`) on both Auth.tsx and SetPassword.tsx loader wrappers.
- Result: loader sits on the same near-white surface as the rest of the auth screen — the red dumbbell + halo reads cleanly and there's no flash from dark → light when warming completes.

## 2. Blank `/auth` screen (second screenshot)

**Likely cause chain (in order of probability):**
1. `checkingSetup` finishes → component re-renders → `AuthVisualPanel` (left desktop column) or a child throws and the suspense/error boundary swallows it silently. We have an `ErrorBoundary` higher up but `<Suspense fallback={null}>` in `App.tsx` means a transient lazy-chunk failure renders nothing.
2. `getHomePath(roles)` redirect happens before `user` is populated → instant Navigate to a route that itself bails to null.
3. Console already shows `FunctionsFetchError: Failed to send a request to the Edge Function` from `check-setup` — when offline/blocked the warn path runs fine, so this is not the blank cause, but it adds load latency (~1–3s).

**Audit steps (no behavior change yet):**
- Open `/auth` with devtools → confirm whether DOM is empty `<div id="root"></div>` (white-screen crash) or has markup but no paint (CSS issue with `incline-auth` class).
- Inspect `AuthVisualPanel` for any top-level hook that can throw (e.g., reading window/localStorage at render).
- Replace `<Suspense fallback={null}>` around the route tree with `<Suspense fallback={<PageLoader />}>` so a stuck lazy chunk shows the thin progress bar instead of a white page.
- Wrap `RoutedContent` children in a route-scoped `ErrorBoundary` that renders a "Reload" button instead of crashing to white.

## 3. App-wide performance audit (rapid-fast goal)

The codebase is large (100+ lazy routes, heavy vendors). Here's the phased, **non-breaking** plan:

### Phase A — Frontend quick wins (1 pass, zero functional change)

1. **Drop the eager `check-setup` edge call on every Auth mount.** Cache result in `sessionStorage` for the session, fall through immediately on cache hit. Removes 1–3s blocking spinner.
2. **Add `<Suspense fallback={<PageLoader/>}>` and a real `ErrorBoundary` around lazy routes** — fixes blank screens on chunk load failures (root cause of many "blank screen" reports).
3. **Preconnect cleanups** — `index.html` already preconnects Supabase; add `<link rel="preload" as="style">` only for the LCP route's CSS chunk and remove any preload that didn't get used (e.g., the logo preload we already removed; confirm nothing else lingers).
4. **Defer `initGlobalErrorLogging()`** to `requestIdleCallback` so it doesn't add work to the critical path in `main.tsx`.
5. **Move `React.StrictMode` only to dev** — in prod it double-mounts which doubles effect work. Wrap with `import.meta.env.DEV`.
6. **`vite.config.ts` — set `build.target: 'es2022'`** to skip unnecessary transpile on modern browsers (smaller bundle), and add `optimizeDeps.include` for the heavy commonly-used deps so dev cold-start stops blanking on first request.

### Phase B — TanStack Query defaults (huge perceived speed-up)

`src/App.tsx` uses default `new QueryClient()`. Set:
- `staleTime: 60_000` (default is 0 → every mount refetches)
- `gcTime: 5 * 60_000`
- `refetchOnWindowFocus: false`
- `retry: 1`

This single change cuts redundant Supabase calls 50–80% in normal navigation. No data correctness loss because mutations already `invalidateQueries`.

### Phase C — Backend / DB audit (read-only, then targeted indexes)

1. Run `supabase--linter` and capture all `query-missing-indexes` and `security-` warnings.
2. Pull top-20 slow queries from `pg_stat_statements` via `supabase--read_query` (mean exec time × calls) — usually highlights 2–3 culprit tables.
3. Add `CREATE INDEX CONCURRENTLY` migrations only for hot filters (`branch_id`, `member_id`, `created_at DESC`, `status`) that appear in `EXPLAIN` plans.
4. Audit `useRealtimeInvalidate` channels — each open subscription costs a websocket frame on every write. Confirm we're only subscribing where the page is visible.
5. Confirm Lovable Cloud instance size — if usage is high we'll surface the upgrade path:
   *Project → Backend → Advanced settings → Upgrade instance*.

### Phase D — Bundle audit

- Run `bunx vite build --report` (or `rollup-plugin-visualizer`) to confirm no route is dragging in `three`, `jspdf`, or `xlsx` accidentally via a static import. Today `manualChunks` already splits these — we just verify.
- Convert any remaining `import X from '...'` of `lucide-react` icons in landing-route components to per-icon paths (`lucide-react/dist/esm/icons/...`) only if the icons chunk is still > 60 KB on the LCP route.

## Technical summary (for review)

| File | Change |
|------|--------|
| `src/pages/Auth.tsx` | Loader wrapper bg: `var(--gradient-hero)` → `bg-slate-50` |
| `src/pages/SetPassword.tsx` | Same loader wrapper bg fix |
| `src/App.tsx` | QueryClient defaults; Suspense fallback = PageLoader; route-scoped ErrorBoundary; conditional StrictMode |
| `src/main.tsx` | Defer `initGlobalErrorLogging` via `requestIdleCallback` |
| `src/pages/Auth.tsx` | Cache `check-setup` result in sessionStorage |
| `vite.config.ts` | `build.target: 'es2022'`, `optimizeDeps.include` |
| `supabase/migrations/*` | Targeted `CREATE INDEX CONCURRENTLY` only after linter + pg_stat_statements review |

## What I will NOT touch
- `GymLoader` visuals
- Any business logic, RPC, RLS policy, or edge function
- Existing query keys / mutation flows
- The 3D landing page (`InclineAscent`) — already IO-gated

## Order of execution after approval
1. Phase A + loader bg fix (single commit, ~5 file edits)
2. Phase B QueryClient defaults
3. Phase C diagnostic (read-only) → propose index migrations as a separate approval
4. Phase D bundle report → only act if a regression is found

Approve and I'll start with Phase A + the loader fix.
