# Photos, widgets and motion for "Members without a trainer"

## What you will see
- **Photos:** each member row shows their profile photo (falls back to initials). The suggested trainer and second option show the trainer's photo too. The trainer strip at the top becomes photo cards with today's hours and a client-load bar.
- **Widgets row** (above the table, 4 compact cards):
  1. **Unassigned members** – total, plus how many have Strong / Some / Not enough visit history.
  2. **Ready to assign** – members whose best trainer is a "Best match" or "Good", with one-tap "Select these".
  3. **When they come** – small bar chart of unassigned members by usual arrival hour (5 AM–11 PM), with trainer on-shift coverage shown as a shaded band so gaps stand out.
  4. **Trainer room left** – per-trainer bars of clients vs limit (full trainers highlighted).
- **Animations:** cards and numbers count up on open, rows slide in gently, photos fade in, chart bars grow from the bottom; selecting/assigning a row animates it out and updates the widgets. Reduced-motion users get instant changes.

## Technical details
- Migration: extend `trainer_match_data` to return `avatar_url` for members (profiles.avatar_url, fallback members.biometric_photo_url) and trainers (profile avatar, fallback trainers.biometric_photo_url). Same guards; no other behaviour change.
- Photos load via existing avatar helper (signed URL if storage path), lazy `loading="lazy"`, shared `Avatar` component with initials fallback.
- Charts: Recharts (already in project) with theme tokens; data derived with `useMemo` from the already-loaded payload (no extra queries).
- Motion via existing `pageMotion.ts` (usePageEntrance, useRowsEntrance, CountUp).
- Split panel into `UnassignedStats.tsx`, `ArrivalCoverageChart.tsx`, `TrainerLoadCards.tsx` to keep files small.
- Verify in browser signed in; no Assign clicks on real members.
