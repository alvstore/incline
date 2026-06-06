
## Goal
Mirror the existing Instagram handle treatment for **Facebook**, **YouTube**, and **Google location** on the public landing footer and in structured-data (`sameAs`) so they appear in the UI and feed AEO/LLM answers.

## URLs to wire in
- Instagram → `https://www.instagram.com/theinclinelife/` (already live)
- Facebook → `https://www.facebook.com/profile.php?id=61585677985406` (Facebook scrape returned 403, so no vanity handle — use raw profile URL)
- YouTube → `https://www.youtube.com/channel/UCwwhk8SiyEJQPSKVyxzA7xg` (studio URL is admin-only; public channel URL derived from channel ID)
- Google Maps (place) → `https://www.google.com/maps/place/?q=place_id:ChIJq7uKbjXvZzkRnYxCp0uL3uo` 
  → Simpler/equivalent: keep the user-friendly share form `https://maps.app.goo.gl/...` if available, otherwise use the deep link the user shared. I'll use the canonical place URL: `https://www.google.com/maps/place/Incline+-+Rise.Reflect.Repeat./@24.546845,73.701003,18z`

## Changes

### 1. `src/components/ui/ScrollOverlay.tsx` — public footer on `/`
Replace the single Instagram link with a horizontal social row of 4 icon-links — Instagram, Facebook, YouTube, MapPin (Google location) — using `lucide-react` icons (`Instagram`, `Facebook`, `Youtube`, `MapPin`).

UI pattern:
- 44×44 round touch targets, `rounded-full glass border border-primary/20`, `text-muted-foreground hover:text-primary hover:scale-110`, 200ms transition.
- Each link: `target="_blank" rel="noopener noreferrer"` + descriptive `aria-label` ("Instagram @theinclinelife", "Facebook page", "YouTube channel", "View on Google Maps").
- Keep the `@theinclinelife` handle text under the icon row (small, tracked) so the handle is still discoverable.
- Order: Instagram · Facebook · YouTube · Google Maps.

### 2. `index.html` — JSON-LD `sameAs` arrays (3 blocks)
Update all three `sameAs` arrays to:
```json
"sameAs": [
  "https://www.instagram.com/theinclinelife/",
  "https://www.facebook.com/profile.php?id=61585677985406",
  "https://www.youtube.com/channel/UCwwhk8SiyEJQPSKVyxzA7xg",
  "https://www.google.com/maps/place/Incline+-+Rise.Reflect.Repeat./@24.546845,73.701003,18z"
]
```
Leave the existing `hasMap` field on the LocalBusiness block — already correct.

### 3. `public/llms.txt` and `public/llms-full.txt`
If they list Instagram, append Facebook / YouTube / Google Maps URLs in the same "Socials" section so LLM crawlers pick them up. No-op if not present.

## Out of scope
- No backend / DB changes.
- No changes to internal IG / WhatsApp / Meta automation settings (those are messaging APIs, not public marketing handles).
- No new dependencies — all icons already ship with `lucide-react`.
