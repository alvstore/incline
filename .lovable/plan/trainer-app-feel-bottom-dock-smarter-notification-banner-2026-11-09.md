# Trainer app feel: bottom dock + smarter notification banner

## What I found
- The member app has a bottom dock (Home, Classes, Workout, Store, Profile, More). It only shows for accounts that are **only** members. Trainers get no dock on phones, just the side menu.
- The installed app icon always opens the member dashboard, so a trainer who installs Incline lands on the wrong home screen.
- The notification card on the trainer dashboard still takes up space when notifications are already on. It shrinks to a "Notifications on · Turn off" chip, but it doesn't go away. The same card appears on the member dashboard.

## What changes

**1. Trainer bottom dock (phones and tablets, hidden on desktop)**
- Five tabs plus More, the same look as the member dock:
  **Home** (trainer dashboard) · **Clients** · **Schedule** · **Earnings** · **Profile/Preferences** · **More** (opens the full menu)
- The active tab is highlighted and announced to screen readers. Each tap area is at least 44px. It sits above the iPhone home bar, and page content gets bottom padding so nothing is hidden behind the dock.
- Shows for trainer-only accounts. Owner, admin, manager and staff screens are unchanged.

**2. Install like an app**
- The installed icon opens each person's own home screen: trainers go to the trainer dashboard, members to the member dashboard, staff to theirs.
- The app's identity stays the same, so members who already installed it don't need to reinstall.
- Same icon, name and colours. Offline mode isn't part of this change.

**3. Notification banner shows only when needed**
- Notifications already on for this device: nothing shows on the trainer or member dashboard.
- Not opted in yet: the "Enable notifications" card shows as today, and it can still be hidden with the X.
- Blocked in browser settings, or on an iPhone that hasn't added Incline to the Home Screen: the card shows the help message.
- Turning notifications off stays available in Preferences / Profile → Communication, which keep the full on/off control.

## Technical details
- New `src/components/trainer/TrainerMobileNav.tsx`, modelled on `MemberMobileNav` and reusing `openMobileMenu('bottom_more')`.
- `AppLayout.tsx`: add `showTrainerMobileNav` (has the trainer role and no owner, admin, manager or staff role). Apply the same `pb-28 lg:pb-6` main padding, and render the nav in all three layout branches.
- `public/manifest.webmanifest`: keep `id: "/member-dashboard"`. Change `start_url` to `/` so the existing role redirect (`getHomePath`) sends each role home. Confirm `/` redirects signed-in users before changing it.
- `BrowserNotifications.tsx`: add a prop `variant: 'prompt' | 'settings'` (default `'prompt'`). In prompt mode, return `null` when enabled. Settings mode (TrainerPreferences, CommunicationPreferences) keeps the chip and Turn off.
- Analytics: `bottom_nav_tapped` with `{ role: 'trainer', tab }`.
- No database or feature-switch changes. The dock is a pure layout change, so a flag adds no safety.

## Verify
- Screenshots at 375px and 768px as a trainer: dock visible, no content hidden, no sideways scroll. At 1280px: no dock.
- With notifications on, no banner on the dashboard. With them off, the banner shows.
