# Plan: PDF watermark, brand naming, manual WhatsApp templates, Indian meal library

## 1. Watermark on workout & diet plan PDFs

Add a diagonal watermark reading **"INCLINE — RISE. REFLECT. REPEAT."** to every page of the generated plan PDF.

- Applied in the existing per-page footer loop in `buildPlanPdf` (so it covers all pages, including added ones).
- Light grey, very low opacity, rotated ~45 degrees, centred, drawn behind nothing critical — it sits under the footer rule and never overlaps readability of exercise/meal tables.
- Uses the resolved brand tagline when a branch overrides it, defaulting to "Rise. Reflect. Repeat."

## 2. Brand naming in Terms & Conditions

The signed terms currently say "Incline 24/7" as if it were the business name. Correct to **Incline**, keeping the 24-hour access meaning intact.

- Title becomes "Incline — Facility Terms & Conditions".
- Clause 1 stays "24/7 Access Consent & Unstaffed Hours" but body reads "Incline operates on a 24x7 basis…".
- Liability, trainer, locker and parking clauses replace "Incline 24/7" with "Incline".
- Same edits mirrored in the server-side copy used for waiver PDF generation, and in the public registration page checkbox label.
- The terms **version string is not bumped** — this is a naming correction, not a substantive change, so existing members are not forced to re-sign.

## 3. Manual WhatsApp template creation + task templates

Root cause found: the full template editor exists, but the Templates Hub renders the manager with the header hidden, and the "Add Template" / "Quick Presets" buttons live inside that hidden header — so from `Settings → Communication Templates` there is no way to create one manually.

- Add a compact action bar (Add Template + Quick Presets) that renders when the header is hidden, so every channel tab (WhatsApp / SMS / Email) has a visible Create button.
- The existing editor sheet (name, category, trigger event, body, variables, Meta submission) is reused unchanged.
- Seed the missing **task templates**: a WhatsApp template and an SMS template for `task_assigned`, matching the email one that already exists, so staff task alerts have a template on every channel.

## 4. Indian meal library for the swap modal

The catalog currently holds only ~27 meals, so "Swap meal" shows almost nothing per meal type. Seed a substantial Indian meal library (~140 rows) covering:

- **Breakfast**: poha, upma, idli/sambar, dosa variants, paratha (aloo/paneer/methi), besan chilla, moong dal chilla, thepla, uttapam, dalia, oats upma, sprouts salad, egg bhurji, boiled eggs, omelette, chicken keema paratha.
- **Lunch / Dinner**: dal (tadka/moong/masoor), rajma, chole, paneer bhurji/tikka, soya curry, mixed veg sabzi, bhindi, lauki chana, palak paneer, curd rice, khichdi, roti/brown rice/millet combos, grilled chicken, chicken curry, egg curry, fish curry, tandoori fish, prawn masala.
- **Snacks**: roasted chana, makhana, sprout chaat, fruit bowl, buttermilk, curd, peanut chikki (portioned), boiled corn, dhokla, paneer cubes, protein shake.
- **Pre / post workout**: banana + peanut butter, dates + almonds, black coffee + toast, whey + banana, egg whites + toast, paneer + roti, chocolate milk.

Each row carries dietary type (vegetarian / vegan / non-vegetarian / pescatarian), cuisine, meal type, a realistic default quantity, and calories/protein/carbs/fats/fibre so the swap modal can rank by calorie proximity. Seeded as global rows (no branch), skipping any name already present.

## Technical notes

- `src/utils/pdfBlob.ts` — watermark inside the page-footer loop of `buildPlanPdf`.
- `src/lib/registration/terms.ts` and `supabase/functions/_shared/terms.ts` — wording only; version constant unchanged.
- `src/pages/PublicRegistration.tsx` — heading and checkbox label copy.
- `src/components/settings/TemplateManager.tsx` — compact action bar when `hideHeader` is set.
- One database migration: idempotent inserts into `templates` (task_assigned whatsapp/sms) and `meal_catalog` (Indian library).
