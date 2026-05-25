
## 1. Replace stale emails system-wide

Single source of truth for "where it shows up" is the brand context + a couple of stragglers:

- `src/lib/brand/useBrandContext.ts` → `DEFAULT_BRAND.supportEmail`: `hello@theincline.in` → `info@theinclinelife.com`
- `src/services/cmsService.ts` → `contactEmail`: `info@inclinefitness.com` → `info@theinclinelife.com`
- Run a repo-wide grep for `hello@theincline`, `info@incline`, `@inclinefitness`, `@theincline.in` and replace any remaining hard-coded strings (templates, seed/help text, footers). Branch-level emails stored in the `branches` table are user-editable data and are left alone (the screenshot's `info@theinclinelife.com` already comes from there).

Website string `theincline.in` stays — that's correct and the user only flagged the email.

## 2. Roster PDF redesign (professional, branded)

File: `src/utils/pdfBlob.ts`

### 2a. Bundled logo fallback
Import the project logo as a module asset:
```ts
import inclineLogoUrl from '@/assets/incline-logo.png';
```
Update `resolveBrandAsync` / `loadLogoDataUrl` flow so when no DB `logo_url` is found, we fall back to `inclineLogoUrl` instead of rendering the plain "INCLINE" wordmark. The current header's `doc.text('INCLINE', 14, 18)` branch becomes a true logo render in 100% of cases.

### 2b. New roster-specific header (replaces the generic `header()` for `buildStaffRosterPdf` only — invoices etc. stay untouched)
Layout (landscape A4, top 48mm):

```text
┌──────────────────────────────────────────────────────────────────────┐
│ [indigo→violet gradient band, 14mm tall]                             │
│ ░░ logo ░░   INCLINE                              WEEKLY ROSTER      │
│              Rise. Reflect. Repeat.               Week 22 · 2026     │
├──────────────────────────────────────────────────────────────────────┤
│ Branch · Address line                       Generated 25 May 2026    │
│ +91 8298293003 · info@theinclinelife.com    5 staff members          │
│ GSTIN 08BMRPM7424A1ZY                                                │
└──────────────────────────────────────────────────────────────────────┘
```

- Gradient simulated by stacking two thin filled rects (indigo 99,102,241 → violet 139,92,246) — jsPDF has no native gradient, this is the standard trick.
- Logo: square 22×22mm, left-aligned with 4mm padding, white background panel inside the band so the colored logo stays legible.
- Title right-aligned in white inside the band; subtitle (period meta) right-aligned below in muted white.
- Contact block sits below the band in a soft `slate-50` strip — replaces the current cramped lines under "INCLINE".
- Drops the empty period strip at y=56; period info is now in the header subtitle, freeing vertical space for the table.

### 2c. AM/PM time icons
jsPDF + helvetica can't render emoji, so draw vector icons (no extra fonts needed):

- `drawSunIcon(doc, x, y)` — filled amber circle (2mm) with 6 short rays.
- `drawMoonIcon(doc, x, y)` — indigo crescent (filled circle minus overlapping bg-color circle).

Helper `fmtShiftWithIcon(s)` returns a callback used in `autoTable`'s `didDrawCell`:
- Morning shift cell → sun icon drawn 1.5mm before the time text.
- Evening shift cell → moon icon drawn 1.5mm before the time text.
- For the **week view** where each cell may contain both shifts stacked, draw sun then text on line 1 and moon then text on line 2, computed off `cell.x`, `cell.y`, `cell.padding('top')`.
- For the **month matrix** the single-letter `A` / `P` legend stays (the cells are too small for icons); the legend text is updated to "☼ A = Morning · ☾ P = Evening · AP = Split · O = Weekly off".

### 2d. Table polish
- Header row: indigo→violet 2-tone via two `fillColor` segments isn't supported by autoTable; instead use a single indigo `[99,102,241]` head with `lineColor:[255,255,255]` and `lineWidth:0.4` for crisper separators.
- Row striping uses `[249,250,253]` (softer than current `[248,250,252]`) and row min-height bumped to 12mm so the icon+two-line time block breathes.
- "Staff" column gets a left-aligned bold name **plus** a secondary muted-grey role line (Trainer / Manager / Front Desk / Cleaning) using `didDrawCell` — currently roles aren't surfaced in the PDF at all.
- "Sun" column: if `is_weekly_off`, render a tiny blue pill "Weekly off"; if a shift exists (Sunday duty override), render normally with the moon/sun icons — visually distinguishes contracted Sunday workers.

### 2e. Footer
Existing `footer()` already pulls `b.supportEmail` + `b.website`, so once step 1 lands the footer reads:
`theincline.in  •  info@theinclinelife.com` automatically.

Add one extra line above it for the roster only: `Page X of Y` right-aligned, using `doc.getNumberOfPages()` in a post-loop pass.

## 3. Out of scope (explicit)
- Invoice / receipt / member-card PDF layouts are **not** restyled in this loop — only the header email/logo fallback flow them through. Roster is the one redesign.
- No DB migrations. Branch emails in the `branches` table remain user-editable.

## 4. Files touched
- `src/lib/brand/useBrandContext.ts` (email default)
- `src/services/cmsService.ts` (contact email)
- `src/utils/pdfBlob.ts` (logo fallback, new roster header, AM/PM icon helpers, table polish, page numbers)
- Any other file flagged by the `hello@theincline` / `@inclinefitness` grep sweep

Skills used: `/skill:ui-ux-pro-max`, `/skill:redesign`, `/skill:senior-frontend`.
