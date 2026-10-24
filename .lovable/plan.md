# My Progress — remove repeated sections and reorder

## Repeated content on the page today
1. **Scan reports show up twice.** The "Body Scan Reports" card and the "Scan Reports" tab list the same scans.
2. **Weight and height show up twice.** The four top tiles (Weight, Height, Body Fat, Last Updated) repeat in the "Latest Measurements" card in the Measurements tab.
3. **Scan credits are separate from the reports.** The "Body Composition / Posture — Used up" strip sits on its own, away from the scans it describes.
4. **Tab labels are hard to read.** On the blue tab bar, inactive tabs (Photos, 3D Body, Scan Reports) use faded text with poor contrast.
5. The weight and body-fat change under the top tiles is always red or green, even when the change is tiny or no change is shown.

## New order for members
```text
Header + "Record measurements"
Hero banner
Weight | Height | Body Fat | Last Updated   (one place for headline numbers)
[ Measurements | Photos | 3D Body | Scan Reports ]   <- directly below the tiles
  Measurements : body measurements (chest/waist/hips…), BMI, history, Print
                 (weight/height not repeated as big numbers)
  Scan Reports : scan credits strip + Buy Add-On Scans + report list (View / PDF)
Workout Plan | Diet Plan links
```

## Changes
- Move the tabs directly below the four tiles.
- Remove the separate "Body Scan Reports" card and the separate credits strip from My Progress. Show both inside the Scan Reports tab only.
- In the member view of Latest Measurements, show BMI and the date, and drop the repeated big Weight/Height numbers. The staff member drawer stays as it is.
- Make inactive tab labels readable with solid foreground text and a clear active state. Tabs fit in 2 columns on phones with no sideways scrolling.
- Show the weight and body-fat change as neutral "Stable" when it is under 0.1. Add an up/down icon next to the change, so it does not rely on colour alone.
- Give the top tiles one consistent style: rounded-2xl, soft shadow, and tabular numbers.

## Technical notes
- `MyProgress.tsx`: render the tiles, then `MeasurementProgressView` with a new `variant="member"` prop. Remove `ScanQuotaStrip` and `HowbodyReportsCard` from the page.
- `MeasurementProgressView`: on the member variant, the Scan Reports tab renders `ScanQuotaStrip` + `HowbodyReportsCard` (the member versions: no resend). The staff variant keeps `MemberScanReportsTab`. The empty state (no measurements) still shows the tabs, so scans stay reachable.
- `MeasurementMetricsTab`: add a `hideHeadline` prop for the member variant.
- Tab trigger classes: inactive `text-primary-foreground/90 hover:bg-primary-foreground/10`. Every trigger keeps a focus ring and a 44px minimum height.
- Verify with Playwright as Mohit (member) at 1280px and 375px. Check for no duplicate "Body Scan Reports" heading, that the tabs come right after the tiles, and that there are no console errors.

## Out of scope
- No data changes, and no changes to the staff profile drawer layout.
