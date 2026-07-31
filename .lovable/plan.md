## What I found in the audit

**The APIs in code are current, not legacy** — but the connect flow is split across the wrong surfaces.

- `google-reviews-brain` already calls the right endpoints: Account Management v1, Business Information v1 (with `readMask`), My Business v4 for review list/reply, plus a **Places API (New)** fallback (`places:searchText` + place details).
- The blocker is not code: your Google Cloud project has the Business Profile APIs disabled/unapproved (the "rate limit" you saw is a mislabelled 403), and — per your screenshots — the **Places API has no API key created at all** ("No API keys to display"), so the fallback lane is also dead. The edge function reads a `GOOGLE_MAPS_API_KEY` secret that does not exist yet.
- The Configure drawer is generic schema-driven (`providerSchemas.ts` → `Integrations.tsx`). It exposes Account ID / Location ID / Client ID / Secret / API Key as flat text boxes, with **no field for `place_id`** even though the brain looks for `cfg.place_id`. There is no status, no step ordering, no error surfacing inside the drawer.
- Minor code debt: `friendlyGoogleError` is declared twice in the edge function; the drawer's "Test connection" only probes the v4 reviews endpoint, so it always fails while quota is pending even when the Places lane would work.

## Plan

### 1. Two clearly separated lanes in the UI
- **Lane A — Reviews Lite (works today, zero GCP approval):** Places API (New). Read-only, up to 5 recent reviews + rating + total count. Good enough to populate the dashboard and Feedback tab immediately.
- **Lane B — Full Business Profile (needs Google approval):** OAuth + v4 reviews list and **reply posting**. Kept as-is, unlocked once Google grants the Business Profile API quota.

### 2. Get a working Places key without you touching Google Cloud
Preferred: link the **Google Maps Platform connector** (Lovable-managed key, Places API New already enabled — no GCP project, no billing, no key creation). Fallback stays: paste your own key into the drawer if you'd rather use your own GCP project.

### 3. Rebuild the Google Business drawer (2026, purpose-built)
New `GoogleBusinessDrawer.tsx`, replacing the generic schema drawer for this provider only:
- Sticky header + scrollable body + sticky footer (Cancel/Save), `sm:max-w-xl`.
- **Status strip** at top: chips for `Places key`, `OAuth`, `Account/Location`, `Last fetch` — each green/amber/red with a one-line reason.
- **Step 1 · Quick connect (Places):** Place ID field with a **"Find my listing"** search (business name + city → `places:searchText` → pick from results), plus a live preview of the rating/review count once resolved.
- **Step 2 · Full access (optional):** OAuth Client ID/Secret → Connect Google → Auto-discover Account & Location (existing `GoogleBusinessDiscovery` sheet, embedded inline).
- **Diagnostics** section: runs the existing `diagnose` action and renders each check as a pass/fail row with the exact remediation (which API to enable, which quota to request), replacing today's wall of yellow help text.
- Auto-fetch toggle + "Fetch now" moved here.

### 4. Backend adjustments (`google-reviews-brain`)
- Add `place_id` to persisted config and a `search_places` action for the "Find my listing" picker.
- Read the Places key from the connector env var when present, else the manual key from `integration_settings.credentials`, else the `GOOGLE_MAPS_API_KEY` secret.
- `test_connection` becomes lane-aware: reports Places OK / GBP pending separately instead of one hard failure.
- Persist `rating` + `user_rating_count` on fetch so the dashboard widget shows the real average, not the average of 5 rows.
- Remove the duplicate `friendlyGoogleError`.

### 5. Schema/data
- `google_reviews_inbound`: mark Places-sourced rows as read-only (no reply button, tooltip explains reply needs Lane B). No new table.
- `integration_settings.config` gains `place_id`, `place_name`, `review_source_pref`.

## Technical notes
- Places API (New) returns **max 5 reviews** and cannot post replies — that is a Google limit, not something code can widen. Reply-to-review will stay disabled until the Business Profile API quota is approved.
- Files touched: `src/components/settings/GoogleBusinessDrawer.tsx` (new), `src/pages/Integrations.tsx` (route this provider to the new drawer), `src/config/providerSchemas.ts` (trim now-unused Google fields), `src/components/settings/GoogleBusinessDiscovery.tsx` (embeddable mode), `src/components/feedback/ExternalReviewsTab.tsx` (source badge + reply gating), `src/components/dashboard/GoogleReviewsWidget.tsx` (real aggregate rating), `supabase/functions/google-reviews-brain/index.ts` (v1.3.0).

## One decision from you
For the Places key: link the **Lovable-managed Google Maps connector** (one click, nothing to do in Google Cloud), or create your own key in the GCP project from your screenshots and paste it in? I'll build the drawer to accept both either way — this just decides which one we switch on first.
