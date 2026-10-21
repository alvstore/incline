# Sign-in page redesign — "framed card" style for Incline

Reference: dark rounded card floating on a soft backdrop; form on the left, a large hero image on the right inside its own inset rounded panel; strong headline, social buttons in a row, divider, single input + bold orange Continue.

## What you will see
- Whole sign-in screen becomes one large dark rounded card (rounded-[2rem]) centred on a soft warm backdrop (subtle orange glow, theme tokens only). Always dark in both themes, so the white logo never disappears and nothing flickers between colours on load.
- **Left half (form):**
  - Incline logo top-left, "New here? Join Incline" link top-right (goes to /register).
  - Big headline "Welcome back." with a small "Rise. Reflect. Repeat." line under it.
  - Existing sign-in form kept exactly as it works today (phone/email + password, forgot password, any Google button already configured) — restyled: dark inputs with icon, full-width orange "Sign in" button, quiet divider.
  - Small footer: Privacy · Terms · Data Deletion, and "© The Incline Life by Incline".
- **Right half (visual):** an inset rounded panel with a new generated hero image — an athlete mid-lift in a dark, moody luxury gym with warm orange rim light (matches the brand orange the way the robot matches the reference's orange). Three small glass chips over the photo: Rise · Reflect · Repeat, plus "Sector 14, Udaipur".
- Gentle entrance: card fades/lifts in 250 ms; image slowly zooms 1.00→1.03 on hover. No looping animation.
- **Phone (375–768 px):** card fills the screen, image panel becomes a short banner on top (about 180 px) with logo over it, form below. No horizontal scroll, 44 px touch targets, safe-area padding.

## Review pass (design critic)
After building: screenshots at 1440, 1075 (your current size), 768 and 375 px, score hierarchy, spacing, contrast (≥4.5:1 on photo chips), typography, loading/error states of the form, motion and touch; fix findings and re-shoot.

## Technical details
- Files: `src/pages/Auth.tsx` (frame layout), `src/components/auth/AuthVisualPanel.tsx` (inset image panel + chips), remove `GlassFolderCards` usage from auth and its unused `.auth-folder-*` CSS in `src/index.css`.
- `LoginForm` logic untouched; only wrapper classes / an optional `variant="dark"` styling prop.
- New image `src/assets/auth-hero-athlete.jpg` (imagegen, standard quality, 1024x1280).
- Dark surface via sidebar tokens (`bg-sidebar`, `text-sidebar-foreground`, `bg-sidebar-accent`, `border-sidebar-border`); CTA uses `bg-sidebar-primary`. No hex or static Tailwind colours.
- No sign-in behaviour, routes or backend changes.
