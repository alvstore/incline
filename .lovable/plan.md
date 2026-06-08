# Fix: Lead Source Shows "Website" Instead of True Origin (Instagram, etc.)

## Problem
When a visitor lands from Instagram → browses → submits a form, the lead is saved as `source: 'website'` because:
1. `document.referrer` at form-submit time is empty or same-origin (the user is already on our site).
2. UTM params from the original landing URL are lost after the visitor navigates around.
3. `deriveLeadSource()` falls back to `'website'`.

We never persist the **first touch** (the URL/referrer/UTMs that brought them here), so every form attributes to "website".

## Solution: First-Touch Attribution Layer

Capture original referrer + UTMs once on first page load and persist them for the whole session. Every lead-capture surface reads from that store instead of `document.referrer`.

### 1. New helper: `src/lib/leads/firstTouch.ts`
Persists first-touch attribution in `localStorage` (key: `incline_first_touch`) with 30-day TTL:
```ts
{
  source: 'instagram',          // derived once via deriveLeadSource
  referrer_url: 'https://instagram.com/...',
  landing_page: 'https://theincline.in/?utm_source=ig',
  utm_source, utm_medium, utm_campaign, utm_content, utm_term,
  captured_at: ISO,
}
```
Rules:
- Set ONCE per visitor (don't overwrite if already present and < 30 days old).
- If new visit has UTMs OR an external referrer, refresh (last non-direct wins — standard GA model).
- Ignore same-origin referrers (theincline.in, lovable.app preview hosts).
- Exposes `getFirstTouch()` and `captureFirstTouch()`.

### 2. Bootstrap on app start: `src/main.tsx`
Call `captureFirstTouch()` once before React mounts so it runs on the very first navigation, before any SPA route change wipes `document.referrer`.

### 3. Harden `src/lib/leads/sourceFromReferrer.ts`
- Add `SAME_ORIGIN_HOSTS` (theincline.in, www.theincline.in, *.lovable.app, localhost) — referrers from these are treated as "no referrer" so they never resolve to `website` incorrectly.
- Keep existing HOST_MAP (instagram, facebook, google, etc.).

### 4. Update lead-capture surfaces to use first-touch
Files that currently read live `document.referrer` / URL params:
- `src/pages/EmbedLeadForm.tsx`
- `src/components/ui/RegisterModal.tsx`
- `src/components/leads/AddLeadDrawer.tsx` (manual entry — leave as-is, staff picks source)
- `src/pages/Auth.tsx` (signup path that creates a lead)

Each switches to:
```ts
const ft = getFirstTouch();
source: ft.source,              // already derived
utm_source: ft.utm_source,
referrer_url: ft.referrer_url,
landing_page: ft.landing_page,
```
Fallback to live values if first-touch is missing (older sessions).

### 5. Server defense-in-depth: `supabase/functions/capture-lead/index.ts`
- If `body.source === 'website'` AND `body.referrer_url` matches an external host pattern (instagram/fb/google/etc.), re-derive on the server using the same `HOST_MAP` (copy to `_shared/leadSource.ts`).
- Prevents stale/older clients from clobbering the attribution.

### 6. (No DB changes)
`leads` table already has `source`, `utm_*`, `referrer_url`, `landing_page` columns — we're only fixing what we write into them.

## UX / Visual
No UI changes. `LeadSourceBadge` already renders Instagram/Facebook/etc. icons correctly once `source` is right. Verify badge renders pink Instagram icon on a test lead after fix.

## QA Steps
1. Open incognito → `https://instagram.com` link → land on site with `?utm_source=instagram` → navigate to a different page → submit lead form → lead saved with `source='instagram'`, pink IG badge in CRM.
2. Direct visit (no referrer, no UTM) → lead saved with `source='website'`.
3. Google search → click result → submit → `source='google'`.
4. Existing leads unaffected (no backfill).

## Files Touched
- **New:** `src/lib/leads/firstTouch.ts`, `supabase/functions/_shared/leadSource.ts`
- **Edited:** `src/main.tsx`, `src/lib/leads/sourceFromReferrer.ts`, `src/pages/EmbedLeadForm.tsx`, `src/components/ui/RegisterModal.tsx`, `src/pages/Auth.tsx`, `supabase/functions/capture-lead/index.ts`

## Skills Used
- **senior-architect** — chose first-touch (last-non-direct) attribution pattern over session-storage-only; aligns with GA/marketing-standard model and survives SPA route changes.
- **code-reviewer** — server-side re-derivation prevents client bypass; same-origin host filter prevents false `website` attribution on internal redirects.
- **ui-ux-pro-max** — confirmed no UI changes needed; existing `LeadSourceBadge` (Vuexy pill, pink IG icon) already covers the visual.
