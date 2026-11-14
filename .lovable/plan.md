# Fix crawler rules, missing-page handling and sitemap

## 1. Crawler rules (priority 1)
- Each named crawler (Googlebot, GPTBot, PerplexityBot, OAI-SearchBot, ClaudeBot, Applebot) gets the same blocked list as the general group, so private areas are blocked for every crawler.
- Add any missing private areas found in the app's page list (e.g. register-success style pages, embeds, contract signing).
- Private pages stay protected by sign-in; crawler rules are only a hint.

## 2. Unknown pages (soft 404)
- The branded "page not found" screen will tell search engines not to index it (noindex) and drop the page-specific canonical, and set a proper "Page not found" title.
- Unknown member/service-style paths (e.g. /member/random, /service/random) land on the same screen.
- Limitation: on current hosting, every address returns the app with a "success" status, so a true 404 status code is not possible without server rendering. The noindex step is what Google accepts for apps like this. A true 404 would need the upgrade to Lovable's latest template ([what it gives you](https://lovable.dev/blog/building-apps-using-tanstack-start)) — not part of this plan.

## 3. Sitemap and service pages
- New public pages with real content from the club's facts (no invented prices or dates): Personal Training, Pilates, Yoga, Group Classes (incl. Zumba), Recovery (sauna, ice bath, steam, lounge), 3D Body Scan, and a "Gym in Udaipur" location page with address, hours (24/7), map and contact.
- Each page: unique title/description, one heading, canonical, breadcrumb + service structured data, links from the homepage and footer.
- Sitemap: canonical indexable pages only. Remove the duplicate terms address (keep one, the other points to it as canonical). Keep the feedback page only if it is meant to be public.
- Add lastmod per page from a manually set "content changed" date in the page list, not the build date.
- Submit the sitemap through the connected Google Search Console after publish. Bing Webmaster Tools needs connecting first (one card for you to approve).

## 4. Checks
- Small test: every named crawler group blocks /admin, /dashboard, /member/, /api/, /auth, /pos.
- Browser check of /does-not-exist, /member/random, /service/random showing the not-found screen with noindex.
- Sitemap test: every listed address is a real page.

## Technical details
- Edit `public/robots.txt`, `src/pages/NotFound.tsx` (runtime robots/canonical meta), new pages under `src/pages/services/`, routes in `src/App.tsx`, entries + lastmod in `scripts/generate-sitemap.ts`.
- Tests use `bun:test`.
