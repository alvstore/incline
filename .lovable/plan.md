## 1. Audit findings — current public site (`/` → `InclineAscent.tsx`)

**What's working**
- Static SEO hero paints instantly (good LCP), Three.js `Scene3D` lazy-loads on idle/intersection, low-end mobiles defer further. Honors `prefers-reduced-motion`.
- Crawlable `<sr-only>` branches + FAQ JSON-LD, `SEO` component, scroll progress bar, scroll sound FX.
- Modal infra already in place: `RegisterModal`, `LegalModal`, custom-event open pattern.

**Gaps to fix**
1. **Wrong socials.** Footer + JSON-LD point to `instagram.com/theinclinelife`. No YouTube anywhere.
   - `src/components/ui/ScrollOverlay.tsx` line 190 — Instagram link
   - `index.html` lines 91, 109, 203 — `sameAs` arrays in 3 JSON-LD blocks
   - `public/llms.txt` line 48
2. **No launch date / countdown.** "Launching July 2026" is nowhere on the page; the CTA just says "Join Waitlist" with no urgency anchor.
3. **3D scene is single-act.** `Scene3D` = one dumbbell + floating words. No section-to-section cinematic story, no parallax depth stack, no scroll-scrubbed reveals on the overlay panels, no inter-section transitions. Feels static after the first 2 scrolls.
4. **Overlay panels (`ScrollOverlay`)** use plain fades — no split-text, no clip-path birth, no depth layering, no companion accents to the hero.
5. **No "Founding Member" social proof rail** (Instagram reel strip / YouTube teaser) — wasted opportunity given active IG + YT channels.

---

## 2. Quick wins (apply directly, no preview needed)

- Replace **all** Instagram URLs → `https://www.instagram.com/inclineudaipur/` (handle `@inclineudaipur`) in: `ScrollOverlay.tsx`, `index.html` (×3 JSON-LD `sameAs`), `public/llms.txt`.
- Add **YouTube** → `https://www.youtube.com/channel/UCwwhk8SiyEJQPSKVyxzA7xg` to the same locations + add a YouTube icon next to the IG icon in the footer.
- Add a `LAUNCH_DATE` constant (`2026-07-01T00:00:00+05:30`) in `src/config/publicSite.ts` so it's the single source of truth.

---

## 3. Launch countdown — what + where

A new `<LaunchCountdown />` component (days · hours · minutes · seconds, IST) appears in **two places**:

- **Hero overlay (top-right, under headline)** — slim glass pill: "Doors open · 1 Jul 2026 · 34d 12h 08m". Quietly always-on so it's the first thing eyes catch.
- **Waitlist panel (final scroll section)** — large cinematic version inside the existing glass card, above "JOIN THE WAITLIST". Numbers animate with a slot-machine tick. Adds urgency to the only CTA.

Also append "Launching July 2026 · Founding Memberships Open" to the SEO meta description and to the hero `<h1>` subline.

---

## 4. 3D immersive enhancement — 3 directions to preview

Per request ("we need to see the preview before applying"), I'll use the design-directions flow to render 3 cinematic concepts you can pick from. All three keep the existing `Scene3D` lazy-load + reduced-motion guards. Concept seeds:

- **A. "Vault Opening"** — pinned hero, scroll-scrubbed camera dolly through a Panatta strength floor → ice bath → recovery lounge. Headline splits and converges word-by-word. Countdown lives inside a brushed-metal vault dial that ticks.
- **B. "Ascent Layers"** — 6-depth parallax stack (mountain silhouette, fog, dumbbell hero, particle dust, glass UI). Sections drop in via top-down clip-path birth. Floating accent reels (IG thumbnails) orbit the hero.
- **C. "Mirror Club"** — dark mirrored marble scene, hero dumbbell reflects on wet floor, sections transition via curtain panel roll-up. Countdown is a thin gold serif ticker across the bottom edge; YouTube teaser embedded as a magnetic-hover card in the closing section.

Flow: after this plan is approved, I'll capture the current `/` screenshot, run `design--create_directions` with the three concepts, then ask you to pick one via the prototype question. Only the chosen one gets built.

---

## 5. Build order (after you approve)

1. Quick wins (sec. 2) + `LaunchCountdown` component (sec. 3) — apply immediately, you see them on preview.
2. Capture screenshot of `/` + generate the 3 cinematic prototypes (sec. 4).
3. Ask you to pick a direction.
4. Implement the selected direction inside `Scene3D` + `ScrollOverlay` (and a new `SocialRail` for IG/YT proof).
5. Re-run accessibility check (`prefers-reduced-motion`, GPU-only animations, `aria-hidden` on decorative layers).

### Technical details

- Countdown: pure React `useEffect` interval (1s), pauses when `document.hidden`, snaps to "We're open" state after launch.
- Socials moved into `src/config/publicSite.ts` as `PUBLIC_SOCIALS = { instagram, youtube }` — no more hardcoded URLs scattered across files.
- 3D enhancements stay inside the existing `lazy(() => import('@/components/3d/Scene3D'))` boundary — no first-paint regression.
- Mobile: companion accent assets + magnetic hover disabled via `window.matchMedia('(pointer: coarse)')`.
- No backend changes. No new routes. SEO `sameAs` arrays get the new IG + YouTube URLs so Google links the channels to the brand.

Used the **epic-design** and **ui-ux-pro-max** skills to shape the cinematic directions and depth/composition rules.