# Google Maps "Gym Near Me" Visibility Audit — The Incline Life

**Prepared:** July 2026 · **Owner action doc** (no code fixes will change this — this is Google Business Profile + local SEO operator work)

---

## TL;DR

Your **website** is not the reason Incline doesn't appear for "gym near me in Udaipur". Google's map/local-pack results come from **Google Business Profile (GBP)**, ranked on three factors Google names publicly: **Relevance, Distance, Prominence.** The 3 most likely blockers, in order:

1. **GBP is unverified** — or verification is stuck. Unverified profiles never appear in the local pack.
2. **Opening date is in the future (26 July 2026)** — Google actively suppresses "Opening soon" listings from *"near me"* results until ~2 weeks before opening.
3. **Zero Google reviews + <10 photos + no GBP posts** — the #1 predictor of local-pack rank is review count and freshness. New profiles with none rank behind every established Udaipur gym.

Everything below is a checklist. Fix top-down; each item includes **How to check** and **How to fix**.

---

## A. GBP account state (fixes 80% of "not showing" cases)

### 1. Verification status
- **Check:** Sign in at business.google.com → your Incline location. If you see a "Verify now" banner or a "Pending verification" tag, you're invisible on Maps.
- **Fix:** Complete video verification (Google now prefers video over postcard in India). Walk the phone camera from your signage → interior → the desk where the phone number rings. Approval: 3–5 business days. If postcard was chosen and hasn't arrived in 14 days, request re-send.

### 2. "Opening soon" / future opening date
- **Check:** In GBP → Business information → "Opening date" field.
- **Fix:** If the field is set to 26 July 2026, Maps will hide you from "near me" results until ~12 July 2026. Options: (a) leave as-is and accept invisibility until then, or (b) if you already accept walk-in tours / founding-member visits, mark the business as **open now** and set business hours accordingly — Google needs "open" status to rank you.

### 3. Primary category
- **Check:** GBP → Business information → Category. Must read exactly **"Gym"**.
- **Fix:** Set primary = **Gym**. Set secondary categories = **Personal trainer, Physical fitness program, Sauna, Yoga studio, Pilates studio, Fitness center**. Wrong primary = zero visibility for "gym near me" (categories are the single biggest relevance signal).

### 4. Business type — storefront vs service area
- **Check:** GBP → Info → "Do you serve customers at your business address?" must be **Yes**.
- **Fix:** Set to storefront. Service-area businesses (SAB) are hidden from map pins by design.

### 5. Duplicate / suspended listings
- **Check:** Search Google Maps for these exact strings:
  - `Incline Udaipur`
  - `Incline Rise Reflect Repeat`
  - `The Incline Life`
  - Your street address
- **Fix:** If two pins exist, request merge via GBP support (splits authority — Google will show neither). If the listing shows "Temporarily closed" or "Permanently closed", appeal via support.

---

## B. Relevance signals

### 6. Business name (do NOT keyword-stuff)
- **Check:** GBP name = "The Incline Life". Contains no "Gym" keyword — legitimate but weak for relevance.
- **Fix:** *Don't* rename to "The Incline Life Gym" (violates guidelines → suspension). Instead:
  - Write the GBP **"From the business"** description opening with a natural sentence containing the target keywords: *"The Incline Life is a luxury 24/7 gym and recovery club in Sector 14, Udaipur, with Panatta strength equipment, infrared sauna, ice bath and 3D body analysis…"* (750 chars).
  - Ensure your website's `<title>` contains "gym in Udaipur" — done in this release.

### 7. Photos, videos, posts
- **Check:** GBP → Photos count.
- **Fix, minimum viable:**
  - **25+ photos:** exterior (day + night), signage, front desk, strength floor, cardio, sauna, ice bath, steam, recovery lounge, classes, trainers, member scans. Upload from an Udaipur IP over 2–3 sessions (bulk-upload from a Mumbai VPN looks fake).
  - **3–5 videos** (15–30 sec each): equipment tour, a class in session, recovery walkthrough.
  - **1 GBP post per week** from now on — offers, tips, events. Posts are the freshness signal.

### 8. Google reviews (the #1 rank factor)
- **Check:** Review count in GBP.
- **Fix (post-opening flywheel):**
  - Target **50+ reviews in the first 90 days**.
  - Use the existing `google-reviews-brain` edge function + `request_member_review` action — auto-send a review invite via WhatsApp to any member who scores 4-5★ on internal feedback. The scaffolding is already in the codebase; needs `account_id` + `location_id` populated in `integration_settings` after GBP verification.
  - Never buy or incentivize reviews (Google detects and de-ranks).
  - Reply to **every** review within 24 hours — reply rate itself is a ranking factor.

### 9. Q&A section
- **Check:** GBP → Q&A tab.
- **Fix:** Seed 8–10 questions yourself (from a non-owner Google account is fine) and answer from the owner account. Suggested: hours, parking, day pass availability, trial class, ladies-only hours, corporate memberships, personal trainer certifications, cancellation policy.

---

## C. Distance signals (least controllable)

### 10. Physical distance to searcher
- **Reality:** "Near me" is scored against the searcher's GPS. A user in Hiran Magri (3.5 km away) will always see the 2–3 gyms closer to them first unless those competitors have significantly weaker Relevance + Prominence signals.
- **Fix:** You cannot move the club. You compete by dominating Relevance (categories, reviews, photos) and Prominence (citations, backlinks) so hard that Google widens the radius for your listing.

---

## D. Prominence signals

### 11. NAP citation consistency
- **Check:** Search these directories for your business — do the Name / Address / Phone match **byte-for-byte** with GBP?
  - JustDial, Sulekha, IndiaMart, Facebook Page, Instagram bio, TripAdvisor, Yelp, MagicPin, UrbanPro, Yellow Pages India, Foursquare, Zomato (if food is served)
- **Fix:** Create/claim listings on all of the above using the *exact* GBP name, address ("Sector 14, Udaipur, Rajasthan 313001"), and phone ("+91-8298293003"). Even "Sector 14" vs "Sector-14" vs "Sec 14" breaks the citation graph.
- **Free tool to audit:** BrightLocal Local Citation Audit (free tier), Whitespark Local Citation Finder.

### 12. Local backlinks
- **Check:** `site:*.udaipur.* incline` on Google — probably zero results.
- **Fix targets** (contact for a story + backlink):
  - Udaipur Times, Rajasthan Patrika (Udaipur ed.), Mewar Sandesh, Udaipur Kiran
  - Local wellness/lifestyle Instagram accounts with 10k+ followers
  - Udaipur Chamber of Commerce member listing
  - Wedding / hospitality partner blogs (many Udaipur hotels host destination weddings — pitch a "recovery for wedding party" story)
  - Local college / corporate wellness partnerships (get a listing on their sites)

### 13. Website ↔ GBP link parity
- **Check:** GBP "Website" field → must be `https://theincline.in`. Website footer → must link to your exact GBP URL.
- **Fix:** After GBP is verified, copy the exact `maps.app.goo.gl/…` short link Google gives you, and put it in the website footer + all social bios. Currently you use `https://www.google.com/maps/place/Incline+-+Rise.Reflect.Repeat./@24.546845,73.701003,18z` — this works but a short link is preferred (proves you own the listing).

---

## E. Website / technical (rule-outs — mostly already fine)

| # | Check | Status | Action |
|---|-------|--------|--------|
| 14 | `robots.txt` doesn't block Googlebot | ✅ Clean | None |
| 15 | `sitemap.xml` submitted to Search Console | ⚠️ Verify | Search Console → Sitemaps → submit `https://theincline.in/sitemap.xml` |
| 16 | Mobile Core Web Vitals (LCP, CLS, INP) all green | ⚠️ Verify | Run PageSpeed Insights on `theincline.in`; fix any red metric |
| 17 | Canonical URL consistency | ⚠️ **Risk** | You have 3 live URLs: `theincline.in`, `www.theincline.in`, `incline.lovable.app`. **All 3 must 301-redirect to one canonical.** Split-brain confuses Google. |
| 18 | Structured data valid | ✅ Rich (LocalBusiness, FAQPage, Event, Organization, Brand, Place all present) | None — enhanced in this release |
| 19 | HTTPS + valid SSL | ✅ | None |

---

## F. Prioritized 30-day action plan

### Week 1 — Unblock
- [ ] Complete GBP video verification
- [ ] Set primary category = "Gym"; add 5 secondary categories
- [ ] Decide: keep "Opening 26 July 2026" or flip to "Open now" for founding-member tours
- [ ] Fix any duplicate listing
- [ ] Consolidate to one canonical domain (301 the other two)
- [ ] Submit `sitemap.xml` in Search Console

### Week 2 — Populate
- [ ] Upload 25+ photos + 3 videos (from Udaipur IP, staggered over 3 days)
- [ ] Write the 750-char "From the business" GBP description with target keywords
- [ ] Seed 8–10 Q&A entries
- [ ] Publish first GBP post

### Week 3 — Citations
- [ ] Claim/create listings on JustDial, Sulekha, IndiaMart, MagicPin, TripAdvisor, Foursquare, Facebook Page, Instagram bio (all with byte-identical NAP)
- [ ] Reach out to 3 Udaipur media outlets with pre-opening press kit

### Week 4 — Flywheel
- [ ] Wire `google-reviews-brain` account_id + location_id after verification lands
- [ ] Launch review invite automation to founding members
- [ ] Weekly GBP post cadence starts
- [ ] Book Search Console — start tracking impressions/clicks for "gym near me Udaipur" and 10 sibling queries

---

## G. Pre-opening vs post-opening

**Fixable now (pre-26-July-2026):**
Items 1, 3–7, 9–18, and all website work. Prep the review flywheel so it fires on day 1.

**Only after opening:**
Item 8 (Google reviews — you can't ethically collect them until members have used the facility). But every other slot in the local-pack scorecard should already be full when the first "open" signal fires — competitors have had years to build their profile; you need to compress 12 months of GBP work into your first 60 days.

---

## H. Two Search Console queries to run this week

1. **URL Inspection Tool** on `https://theincline.in/` — confirm "URL is on Google" status. If "Discovered — currently not indexed", request indexing.
2. **Performance report** filtered to *Query contains "udaipur"* — see which local queries you already rank for and where.

---

## Adjacent code hook already in this project

`supabase/functions/google-reviews-brain/index.ts` supports the full lifecycle: `test_connection`, `list_accounts`, `list_locations`, `fetch_reviews`, `classify`, `reply`, `request_member_review`. Post-verification, populate `integration_settings.config.account_id` + `location_id` via **Settings → Integrations → Google Business Profile → Auto-discover IDs** and the review flywheel is ready to fire.
