# Compact "App usage" widget, moved out of the top of Analytics

## Problem
The App usage card sits above the "Gym Analytics" banner at full width, with a tall 30-day bar strip. It pushes the page's main content down.

## Where it goes
Analytics → **Operational Insights** section. Today "Avg Session Duration" fills that whole row by itself. The new layout splits the row:

```text
Operational Insights
[ Footfall heatmap ][ Upcoming renewals ][ ... ]   (unchanged)
[ Avg Session Duration (2/3 width)  ][ App usage (1/3) ]
```
On phones and tablets the two cards stack, with App usage below. Nothing else on the page moves, and the top of the page goes back to starting with the Gym Analytics banner.

## New widget design (same style as the Task Pulse card)
- Fixed-height card (about 410px), the same style as Task Pulse: icon plus the title "App usage", the subtitle "Phone app and web, updates live", a refresh button and a small green "N online now" pill.
- A row of 4 compact figures: Online, Today, 7 days, 30 days.
- A small 30-day sparkline-style bar strip (about 48px tall instead of about 90px), with the peak shown.
- Two compact lists: "By device" (iPhone / Android / Installed web / Browser, with thin bars) and "Who" (Members / Trainers / Staff / Managers / Owners), as small rows.
- Footer: "Active members using the app 8%" with a thin progress bar.
- Loading, error-with-Retry and empty states are kept.

## Motion (same as Approvals/Tasks, GSAP)
- The card fades and rises in on first view, using the existing shared page entrance.
- The numbers count up with the existing CountUp.
- The trend bars grow up from the bottom in a stagger, and the device bars widen from 0.
- The green online dot pulses gently.
- Reduced-motion settings show the final state immediately.
- Live updates do not replay the entrance.

## Not changed
All other widgets, their order and their design; the data, permissions and the on/off switch.

## Technical
- `src/components/appUsage/AppUsageCard.tsx`: rewritten as a compact card that accepts `className`. It reuses `usePageEntrance`, `CountUp` and `prefersReducedMotion` from `src/components/motion/pageMotion.ts`, and adds a scoped `gsap.context` for the bar growth.
- `src/pages/Analytics.tsx`: remove the card from the top. Wrap Session Duration and AppUsageCard in `grid gap-6 lg:grid-cols-3`, with Session `lg:col-span-2`. When the flag is off or the user lacks access, Session keeps the full width.
