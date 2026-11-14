# Fix crawler rules, missing-page handling and sitemap

## 1. Crawler rules (priority 1)
- Each named crawler (Googlebot, GPTBot, PerplexityBot, OAI-SearchBot, ClaudeBot, Applebot) gets the same blocked list as the general group, so private areas are blocked for every crawler.
- Add any missing private areas found in the app's page list (e.g. register-success style pages, embeds, contract signing).
- Private pages stay protected by sign-in; crawler rules are only a hint.

## 2. Unknown pages (soft 404)
- The branded "page not found" screen will tell search engines not to index it (noindex) and drop the page-specific canonical, and set a proper "Page not found" title.
- Unknown member/service-style paths (e.g. /member/random, /service/random) land on the same screen.
- Limitation: on current hosting, every address returns the app with a "success" status, so a true 404 status code is not possible without server rendering. The noindex step is what Google accepts for apps like this. A true 404 would need the upgrade to Lovable's latest template ([what it gives you](https://lovable.dev/blog/building-apps-using-tanstack-start)) — not part of this plan.

## 3. Sitemap (no new pages)
- No new service or location pages, so no new addresses that could break or dilute links.
- Sitemap keeps only real, indexable pages. The two terms addresses: keep one in the sitemap, the other points to it as the main copy. Feedback stays only if meant to be public.
- Service and Udaipur wording is strengthened inside the existing homepage sections (Personal Training, Pilates, Yoga, Group Classes incl. Zumba, Recovery, 3D Body Scan, location with address, 24/7 hours, map, contact) — same page, no new links.
- lastmod per page from a manually set "content changed" date, never the build date.
- Submit the sitemap to the connected Google Search Console after publish; Bing Webmaster Tools needs one connect card for you to approve.

## 4. Google reviews
- Show verified Google reviews on the homepage only if pulled from Google with its required attribution (needs a Google Places key you approve). Until then, keep the current "review us on Google" request flow; no copied or invented reviews.

## 5. Tracking
- Count on the website: phone taps, WhatsApp taps, registration started, registration completed — visible as a small card in Analytics.
- Organic impressions, branded searches and Core Web Vitals come from Search Console (weekly read once there is enough traffic). Local-pack visibility needs Google Business Profile data, which is not connected — listed as open.

## 6. Re-audit
- After publish: rerun the SEO review and check robots, missing-page handling, address details and sitemap live. Server rendering is not in this plan, so true 404 status stays an open item.

## 7. Checks
- Small test: every named crawler group blocks /admin, /dashboard, /member/, /api/, /auth, /pos.
- Browser check of /does-not-exist, /member/random, /service/random showing the not-found screen with noindex.
- Sitemap test: every listed address is a real page.

## Technical details
- Edit `public/robots.txt`, `src/pages/NotFound.tsx` (runtime robots/canonical meta), homepage section copy, click/registration events via the existing analytics events, entries + lastmod in `scripts/generate-sitemap.ts`.
- Tests use `bun:test`.
