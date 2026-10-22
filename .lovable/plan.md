# Fix: members can't tap the menu (three lines) on phones

## What we found
- The app tells phones to draw edge-to-edge (under the notch/status bar), but the phone top bar has **no notch spacing**. In the Incline app (and iPhone home-screen web app) the menu button sits under the clock/battery area, so taps hit the phone's status bar instead.
- The phone top bar is **not pinned**: it scrolls away with the page, so on long screens (My Requests, Benefits) there is no menu button visible at all.
- The menu button is a 40px target (below the 44px minimum) with no label for screen readers.
- The same phone top bar is copy-pasted in three layout modes, so each has the same bug.
- The menu drawer itself ignores notch/home-bar spacing, so the logo and Sign out can be clipped; its list height uses `100vh`, which is wrong on mobile browsers.

## What we'll change
1. One shared phone top bar used by all three layout modes: pinned to the top, with notch spacing, solid background.
2. Menu button: 44x44 tap area, clear "Open menu" label, visible focus ring.
3. Menu drawer: notch + home-bar spacing, correct mobile height so the bottom items and Sign out are always reachable; closes after choosing a page.
4. Member bottom bar: confirm it keeps home-bar spacing and doesn't cover content; add a "More" entry that opens the same menu as a second way in.
5. Analytics: `mobile_menu_opened` (with source: top_button / bottom_more) fired when the drawer opens — no personal data.

## Verification
- Playwright at your viewport (394x764) and a 360px Android size, signed in as a member: menu button visible at top after scrolling /my-requests, tapping opens the drawer, every item including Sign out reachable, no console errors. Screenshots before/after.
- Simulated notch (safe-area inset) check for the app build.

## Technical details
- New `MobileTopBar` in `src/components/layout/`, used by the hybrid, horizontal-stacked and vertical branches of `AppLayout.tsx`: `sticky top-0 z-40 pt-[env(safe-area-inset-top)]`, `min-h-14`, `bg-card border-b border-border`.
- `MobileNav` trigger: `h-11 w-11 aria-label="Open menu"`; `SheetContent` gets `pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]`, flex column with `ScrollArea flex-1` replacing `h-[calc(100vh-180px)]`; controlled `open` exported so `MemberMobileNav` "More" can open it.
- `track()` via existing analytics helper (fire from open handler, not mount).
- Design tokens only; no business logic or data changes. No native config change unless the status bar overlay check shows the app needs `StatusBar` overlay disabled.
