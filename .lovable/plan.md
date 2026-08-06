# Restore diet plans + fix blank PDFs + protect the document

## What I found

**1. All six diet templates are soft-deleted.** Every row in the diet template library has `is_active = false` (deactivated between 04:17 yesterday and 03:53 today). There is only one code path that does this — the "Delete" action on the Templates page — and the content of all six is fully intact, so nothing was lost, only hidden.

Affected templates: 1600 FAT LOSS - VEGETARIAN INDIAN PLAN, Priyanka Lohar - High Protein Lactation Support & Weight Loss, Vegetarian Indian Fat Loss Plan, (1600)FAT LOSS DIET PLAN, Body Recomposition Indian Vegetarian Plan, FAT LOSS DIET PROGRAM.

**2. The blank PDF is a real bug, confirmed against the uploaded file.** The diet plans are stored in the weekly shape — `meals` is an array of *days* (`{ day: "Monday", breakfast: {...}, lunch: {...}, snack1, snack2, dinner, totals }`). The PDF generator assumes `meals` is a flat list of *meals* and reads `m.meal`, `m.time`, `m.calories` off each day object. Those fields don't exist on a day, so it prints seven rows of dashes and a 0 kcal total — exactly what the uploaded PDF shows.

**3. The watermark sits on top of the table.** In the uploaded PDF, "RISE. REFLECT. REPEAT." cuts through the meal rows and header instead of sitting quietly behind them.

## What I'll do

### Restore the templates
Reactivate all six diet templates so they reappear in the library and in the assign flow. No content changes.

### Make the diet PDF render properly
Rewrite the diet section of the generator to use the same canonical reader the builder already uses, so both stored shapes work:

- **Weekly plans** (7-day `meals`): one clean section per day — Monday through Sunday — each with its own meal table (Meal / Time / Item + quantity / Calories / Protein / Carbs / Fats) and a day-total row. Days break onto a new page rather than splitting mid-table.
- **Single-day plans** (legacy `slots`): unchanged behaviour, one table.
- A **weekly summary card** at the top: average daily calories and macros, dietary type, cuisine, target calories.
- Meal items pull food name + quantity, so "Moong Dal Chilla (2 pcs) — 2 chillas" reads as intended.
- Same fix applied to the workout side where the equivalent day-shape mismatch exists, so workout PDFs stay consistent.

### Protect and brand the document
- **Watermark behind content**: drawn first on each page at low opacity, so it brands the page without obscuring the tables.
- **Locked PDF**: the file is generated with owner-level encryption and permissions that disallow modification, content copying, annotation and assembly. Printing stays allowed. There is no user password, so members open it normally — but they can't edit or extract it in standard readers.
- **Tamper-evident footer** on every page: member name, issue date, a short unique document ID, page x of y, and "Issued by The Incline Life by Incline — not for resale or redistribution."
- **Branded cover band** keeps the existing gradient header, gym logo and tagline.

## Technical notes

- Data restore: single update setting `is_active = true` on the six diet template rows.
- `src/utils/pdfBlob.ts` — replace the diet body block (currently `input.data?.meals || input.data?.days?.[0]?.meals`) with `normalizeDietContent()` from `src/lib/fitness/dietContent.ts`, loop days, one `autoTable` per day; move the watermark call to the start of each page and drop it under the tables via a low-alpha graphics state.
- jsPDF is constructed with an `encryption` option (`userPermissions: ['print']`) so modify/copy are denied; verified against jsPDF's supported permission set.
- QA: regenerate the 1600 FAT LOSS plan through the same generator, rasterise every page and confirm all seven days show real meals, totals are non-zero, watermark sits behind text, and the file reports as restricted.
