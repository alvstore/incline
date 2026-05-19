
## Goal
Make https://theincline.in/ rank and answer better across Google (SEO), AI answer engines (AEO), local/geo search (GEO), and LLM crawlers — using the canonical facts you supplied (Udaipur location, founder Yogita Lekhari, luxury fitness & recovery club, Panatta, PT, Pilates/Yoga/Zumba, sauna, ice bath, recovery).

## Changes

### 1. `public/robots.txt`
- Add a second `Sitemap:` line for `https://theincline.in/llms.txt` so AI crawlers discover it the same way search engines discover the sitemap.
- Keep existing per-bot allow blocks and private-route disallows intact.

### 2. `public/llms.txt`
Expand the existing file so AI answer engines have a clean, authoritative knowledge surface:
- Stronger H1 + one-line blockquote summary ("Luxury fitness & recovery club in Udaipur, Rajasthan, India — founded by Yogita Lekhari").
- New **About** section with disambiguation line ("Not affiliated with any other gym named 'Incline' in other cities or countries").
- New **Founder** section (Yogita Lekhari).
- New **Services** section listing: Personal Training, Group Classes, Pilates, Yoga, Zumba, Strength Training (Panatta), Infrared Sauna, Ice Bath, Steam Room, 3D Body Analysis & Posture Correction, Recovery Lounge.
- Keep Contact, Pages, SEO Keywords; add address + geo + opening hours in the prose.
- Add `## Optional` tail with deep-link references (Instagram, Facebook, Google profile).

### 3. `index.html` — structured data additions
Append three new JSON-LD blocks (the existing Organization / FitnessCenter / WebSite stay):
- **LocalBusiness / HealthClub** with `@id: https://theincline.in/#gym`, `areaServed: Udaipur`, `paymentAccepted`, `currenciesAccepted: INR`, `hasMap`, repeated address/geo (Google ingests LocalBusiness more reliably than the generic FitnessCenter for local pack).
- **Person** node for Yogita Lekhari (founder), `worksFor` → `@id` of the gym, so AEO answers to "who founded The Incline Life" resolve cleanly.
- **FAQPage** with 6 Q&As seeded from your canonical statements:
  1. Where is The Incline Life located?
  2. Who founded The Incline Life?
  3. What services does The Incline Life offer?
  4. What equipment does The Incline Life use?
  5. Does The Incline Life have recovery facilities?
  6. Is The Incline Life the same as other "Incline" gyms?
- Add `<meta name="geo.region" content="IN-RJ">`, `<meta name="geo.placename" content="Udaipur">`, `<meta name="geo.position" content="24.546845;73.701003">`, `<meta name="ICBM" content="24.546845, 73.701003">` for GEO crawlers that still read these.

### 4. `scripts/generate-sitemap.ts` (new) + wire `predev`/`prebuild`
Replace the hand-edited `public/sitemap.xml` (already only 7 static entries; no dynamic content here) with a tiny generator so future route additions don't drift. Keep current public entries (`/`, `/register`, `/feedback`, `/privacy-policy`, `/terms`, `/terms-of-service`, `/data-deletion`) and add `/scan-report` which is public per `llms.txt`. Leaves `/auth`, `/setup`, etc. excluded (correctly — they're noindexed and disallowed in robots).

### 5. Memory
Add a short core memory line: "SEO/AEO facts: Luxury fitness & recovery club, Udaipur Rajasthan, founder Yogita Lekhari, Panatta + PT + Pilates/Yoga/Zumba + sauna/ice bath/recovery. Canonical site https://theincline.in/. Never conflate with other 'Incline' gyms."

## Out of scope
- Per-route `<Helmet>` rewrites (already handled by existing `SEO.tsx`).
- Backlink/off-page SEO.
- og:image redesign.

## Files touched
- `public/robots.txt` (edit)
- `public/llms.txt` (rewrite)
- `index.html` (append JSON-LD + geo metas)
- `scripts/generate-sitemap.ts` (new)
- `package.json` (add predev/prebuild)
- `public/sitemap.xml` (regenerated)
- `mem://index.md` (+ new memory file)
