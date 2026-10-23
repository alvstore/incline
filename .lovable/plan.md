# Fix stuck "Sign in" tab title + SEO/AEO/LLM tidy-up

## Problem 1 — tab still says "Sign in" after logging in
Confirmed cause: the sign-in page sets the browser tab title ("Sign in | The Incline Life") and a "noindex" tag. When you move to the dashboard, the app pages never set their own title, so the old one stays until a refresh. Nothing is wrong with your login — it's only the title.

Fix:
- Every signed-in page gets its own tab title, e.g. "Dashboard · Incline", "Members · Incline", "POS · Incline", taken from the page name in the menu (fallback "Incline").
- Signed-in pages also get a "don't index" tag so private pages never appear in Google.
- Check: sign in through the preview and confirm the tab changes to "Dashboard · Incline" without refreshing.

## Problem 2 — SEO / AEO / LLM audit fixes
Found:
- The site head has the share title and description written twice (two different versions) — previews can pick either. Keep one clean set.
- Search data and AI files still say "Public opening: Sunday, 26 July 2026" as a future event (now past). Update to "Open now — 24/7" in the search data, ai.txt and llms files; remove the past "grand opening" event entry.
- robots.txt lists llms.txt as a sitemap (invalid) and uses a non-standard "Host" line — remove both; add a proper llms link instead in ai.txt (already there).
- Confirm sitemap covers public pages (home, register, feedback, legal) — no prices anywhere (pricing blackout kept).
- Keep AI bot opening-date embargo rules untouched (they apply to WhatsApp/Instagram bot only).

## Technical details
- New `useRouteTitle` via Helmet in `AppLayout.tsx`, title looked up from `src/config/navModules.ts` by current path; adds `<meta name="robots" content="noindex">` through Helmet so it replaces the Auth one.
- `index.html`: delete the second og:title/twitter:title/og:description/twitter:description block (lines ~460–470); update JSON-LD descriptions; drop the Event schema.
- `public/robots.txt`, `public/ai.txt`, `public/llms.txt`, `public/llms-full.txt`: opening-date and directive fixes.
- Changes reach theincline.in on the next publish.
