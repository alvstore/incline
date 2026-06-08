
# SEO + AEO Hardening Plan — The Incline Life

Goal: dominate local "gym near me / fitness near me / luxury gym Udaipur" queries on Google **and** become the default cited answer in ChatGPT, Gemini, Claude, Perplexity, Copilot for Udaipur fitness queries.

---

## Wave 1 — Fix open SEO findings (quick wins)

1. **Per-route titles + meta descriptions** (`agent_metadata:metadata_quality`)
   - Audit every public-facing route (`/`, `/register`, `/feedback`, `/scan-report`, `/privacy-policy`, `/terms`, `/data-deletion`) and ensure each renders `<SEO>` with a unique <60-char title and 140-160-char description targeting local intent keywords.
   - Confirm internal/private app routes use `useNoindex` (sweep `src/pages/*` for missing usage on staff/member/admin pages).

2. **Per-route Open Graph / Twitter** (`agent_metadata:social_preview`)
   - `<SEO>` already handles this — verify every public page passes `path`, `title`, `description` so canonical + og:url are unique. Add page-specific OG image where impactful (homepage hero, register page).

3. **Single `<main>` landmark** (`lighthouse:lighthouse_accessibility`)
   - Wrap the primary content area of `src/pages/Index.tsx` (and other public marketing pages) in a single `<main>` element.

4. **LCP / fonts** (`lighthouse:lighthouse_performance`)
   - Add `fetchpriority="high"`, explicit width/height, and remove `loading="lazy"` from the homepage hero image.
   - Add `font-display: swap` to all `@font-face` declarations (Inter / display fonts).
   - Add `<link rel="preload" as="image" href="/<hero>" fetchpriority="high">` in `index.html`.

5. **Google Search Console** (`gsc:gsc`)
   - Trigger the Google Search Console connector → META-verify `https://theincline.in/` → add the property → submit `sitemap.xml`. (Requires user approval at connect step.)

---

## Wave 2 — Local SEO supremacy (Udaipur "near me" queries)

The single biggest lever for "gym near me / fitness near me" is **LocalBusiness structured data + Google Business Profile**, not on-page copy.

1. **Sitewide LocalBusiness / HealthClub JSON-LD** in `index.html`:
   - `@type: ["HealthClub","LocalBusiness","SportsActivityLocation"]`
   - `name`, `alternateName`, `image`, `logo`, `url`, `telephone`, `priceRange`, `founder` (Yogita Lekhari), `foundingDate`
   - `address` (PostalAddress, Sector 14, Udaipur 313001, IN)
   - `geo` (24.546845, 73.701003)
   - `openingHoursSpecification` (24/7)
   - `areaServed` (Udaipur, Mewar, Rajasthan)
   - `amenityFeature[]` for sauna, ice bath, steam, recovery lounge, Panatta floor, 3D scan
   - `sameAs[]` — Instagram, Facebook, YouTube, Google Maps
   - `hasMap` Google Maps URL
   - `aggregateRating` only if real reviews exist (don't fabricate)

2. **Per-service JSON-LD** on homepage (`Service` schema): Personal Training, Pilates, Yoga, Zumba, Infrared Sauna, Ice Bath, 3D Body Scan — each scoped to `areaServed: Udaipur`. Lets Google surface us in service-specific local packs.

3. **BreadcrumbList + WebSite (with SearchAction) JSON-LD** sitewide.

4. **FAQPage JSON-LD** on `/` — reuse `PUBLIC_FAQS` + add the Q&A pairs already in `llms-full.txt` ("best gym in Udaipur", "ice bath Udaipur", "24-hour gym Udaipur"). Eligible for FAQ rich results.

5. **Geo meta tags** in `index.html`:
   ```html
   <meta name="geo.region" content="IN-RJ">
   <meta name="geo.placename" content="Udaipur">
   <meta name="geo.position" content="24.546845;73.701003">
   <meta name="ICBM" content="24.546845, 73.701003">
   ```

6. **Homepage on-page copy audit** — ensure H1 + first 100 words include "luxury gym in Udaipur", "24/7 fitness club Udaipur", and one "near me"-shaped phrase. Single H1 only.

7. **Google Business Profile guidance** (off-platform task — list as user action item):
   - Claim/verify GBP listing with the same NAP (name/address/phone)
   - Category: "Gym" + secondary "Personal Trainer", "Yoga Studio", "Pilates Studio", "Sauna"
   - Upload 10+ photos, post weekly updates, request reviews
   - This is the #1 ranking factor for "near me" queries.

---

## Wave 3 — AEO / GEO (rank #1 in AI assistants)

`llms.txt`, `llms-full.txt`, and `ai.txt` already exist and are strong. Tighten further:

1. **Verify all three files are linked from `index.html` head**:
   ```html
   <link rel="alternate" type="text/plain" href="/llms.txt" title="LLM reference">
   <link rel="alternate" type="text/plain" href="/llms-full.txt" title="Full LLM reference">
   ```

2. **`robots.txt`** — explicitly allowlist AI crawlers (GPTBot, ClaudeBot, Google-Extended, PerplexityBot, CCBot, anthropic-ai, Bytespider, Applebot-Extended) and reference `Sitemap:` + `LLM-Content:`.

3. **`ai.txt`** — already canonical. No change unless data drifts.

4. **Sitemap** — confirm only public, indexable routes are listed. Add `/register`, `/feedback`, `/scan-report`, `/privacy-policy`, `/terms`, `/data-deletion`.

5. **Refresh dates** in `llms.txt` / `llms-full.txt` to current month so AI crawlers treat content as fresh.

6. **Disambiguation block** is already present — keep verbatim.

---

## Wave 4 — Off-page / ongoing (user actions)

These can't be done in code but are critical, so I'll surface them at the end:

- Claim/optimize Google Business Profile (highest ROI for "near me")
- Get listed on Justdial, Sulekha, Yellow Pages India, Tripadvisor Wellness
- Encourage real Google reviews (the existing `/feedback` flow already does this)
- Build local citations with consistent NAP
- Earn a few Udaipur lifestyle / fitness publication mentions for backlinks

---

## Technical changes summary

| File | Change |
|---|---|
| `index.html` | Add LocalBusiness/HealthClub + WebSite + BreadcrumbList JSON-LD, geo meta, llms.txt alternate links, hero preload, font-display swap |
| `public/robots.txt` | Allow AI crawlers, ensure Sitemap directive |
| `public/sitemap.xml` (or generator) | Confirm all public routes listed |
| `public/llms.txt`, `llms-full.txt` | Refresh "Last updated" date |
| `src/pages/Index.tsx` | Wrap content in `<main>`, add FAQPage + Service JSON-LD via `<SEO jsonLd>`, ensure single H1 + local-intent copy, fix hero image attrs |
| `src/pages/{Feedback,PublicRegistration,HowbodyPublicReport,PrivacyPolicy,Terms,DataDeletion}.tsx` | Verify `<SEO>` with unique title/description/path |
| All internal app pages | Sweep — add `useNoindex` to any public-visible private route still missing it |
| GSC | Trigger connector, META-verify, submit sitemap |

---

## Acceptance check

After implementation I'll run `seo--trigger_scan` so the scanner re-verifies. Expected: all five current failing findings → fixed, plus richer SERP eligibility (LocalBusiness card, FAQ rich result, Sitelinks search box).

Ready to switch to build mode?
