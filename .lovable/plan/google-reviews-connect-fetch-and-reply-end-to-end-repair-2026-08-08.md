# Google Reviews: connect, fetch, and reply — end-to-end repair

## What I verified (live, this session)

- The **Google Maps connection exists in the workspace but is NOT linked to this project**, so the backend has no `GOOGLE_MAPS_API_KEY`. The reviews function therefore falls back to the API key pasted per branch, and that key is blocked → the `403 ... Places.GetPlace are blocked` error you see.
- I called the Google listing through the workspace connection and it returned **HTTP 200**: `Incline - Rise.Reflect.Repeat.`, rating **4.9**, **23 ratings**, and the 5 most recent reviews (chirag soni, Karneet Kaur, Aryan Jha, Sahil Sachdev, kuldeep salvi). So the read lane works the moment the connection is linked — no Google Cloud work needed for it.
- The "rate-limited" message on **Discover accounts** comes from the Business Profile (My Business) APIs, which are still disabled/zero-quota on your Google Cloud project. That lane is the only thing that can post replies, and it cannot be fixed from code — it needs Google's approval.

## What this plan does

### 1. Link the Google Maps connection (fixes fetching)
Link the existing workspace connection to this project so the backend gets the managed key and routes Places calls through the Lovable gateway. Then remove the per-branch pasted-key path as the *primary* route: connector first, branch key only as an explicit fallback.

Result: reviews, true star average and review count sync automatically every 4h and on "Fetch now" — no more 403.

### 2. Honest connection states + working diagnostics
- Rewrite the diagnose checks so each lane reports the real cause, not a generic "rate limit": distinguish *connection not linked*, *listing not picked*, *Places blocked (bad key)*, *Business Profile API disabled*, and *Business Profile quota not granted*.
- Fix the misleading copy "Reviews will retry automatically" when nothing will retry.
- Add exponential backoff + a cooldown so repeated Business Profile failures stop hammering Google and stop spamming error logs.
- Every failing check gets a one-line "what to do next" with a copy-ready link.

### 3. Replies that actually work today (and upgrade cleanly later)
Because API replying is gated by Google approval, ship a two-tier reply flow:
- **Assisted reply (works now):** AI drafts the reply in the app, staff edits it, then one click copies the text and opens that exact review on Google Maps (we now capture each review's direct Google link), and the row is marked replied with the text stored for the record.
- **Direct reply (auto-enables):** when the Business Profile lane becomes reachable, the same button posts straight to Google — no UI change, the app detects the capability.

### 4. Google review data quality
- Store the review's Google permalink, author photo, and relative time; de-duplicate against rows already pulled by the older lane.
- Persist the true aggregate (4.9 / 23) so the dashboard widget stops averaging only the last five rows.
- Re-run AI triage (member match, fake detection, draft reply) on the newly fetched reviews.

### 5. UI/UX pass on the reviews workspace
- Connection banner becomes a compact 3-step tracker (Listing → Reading reviews → Replying) instead of a wall of warnings.
- Review cards: rating, author, relative time, verdict badge, member match, and a single primary action; secondary actions collapse into a menu.
- Proper skeletons, empty state ("no new reviews since <time>"), and a visible "last synced" stamp.
- Same treatment for the Google Business drawer: Step 1 becomes "Connected via Lovable" (no key pasting) with the manual key kept behind "Advanced".

### 6. AI SEO / AEO / Google indexing
- Add `LocalBusiness` JSON-LD with `aggregateRating` (fed by the real synced 4.9 / 23) plus opening hours, geo, services and `sameAs` on the public site.
- Refresh `llms.txt`, `llms-full.txt` and `ai.txt` with the current rating, review count and service list so AI answer engines quote correct facts.
- Verify title/description/canonical on public routes, confirm `sitemap.xml` and `robots.txt` are consistent, and run a Search Console indexing check on the homepage to report real status (no changes to Search Console without asking).

### 7. Test and prove it
- Fetch live through the linked connection, confirm the 5 reviews land in the CRM with correct authors and dates.
- Run diagnose and confirm each check returns the correct state.
- Exercise assisted reply end-to-end on one review.
- Check the dashboard widget shows 4.9 (23).

## Technical notes

- `supabase/functions/google-reviews-brain/index.ts`: connector-first key resolution, gateway routing for all Places calls, new error taxonomy in `friendlyGoogleError`, backoff/cooldown state in `integration_settings.config`, capture `googleMapsUri` + author photo, capability flag (`can_reply`) returned by `diagnose`.
- Migration: add review permalink / author photo / relative-time columns to `google_reviews_inbound` (with GRANTs), plus a cooldown key.
- Frontend: `ExternalReviewsTab.tsx`, `GoogleConnectionBanner.tsx`, `GoogleBusinessDrawer.tsx`, `GoogleBusinessDiscovery.tsx`, `GoogleReviewsWidget.tsx`.
- SEO: `src/components/seo/SEO.tsx`, `index.html`, `public/llms*.txt`, `public/ai.txt`.

## What still needs you (Google side, cannot be coded)

To post replies through the API, in Google Cloud enable **My Business Account Management API**, **My Business Business Information API** and **Google My Business API**, then submit the Business Profile API quota request form. Until that is approved, the assisted-reply flow above covers you.
