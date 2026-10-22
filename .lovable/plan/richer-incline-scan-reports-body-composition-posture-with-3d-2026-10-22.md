# Richer Incline scan reports (Body Composition + Posture) with 3D visuals and deep AI analysis

## What the audit found (Yogesh Dahima, posture scan 11 Oct)
- The report is 2 pages of plain number rows. Page 2 is almost empty.
- **No pictures at all**, even though the scanner sends 4 body photos (front, left, right, back) and a full 3D body model for every posture scan. We store them but never put them in the PDF.
- **Values have no units or meaning**: "Pelvis forward 168.3", "Knee 172.56203 / 174.1988" — raw decimals, no degrees/cm, no "normal range", no explanation of what the term means.
- "Posture type" and "Body shape profile" show "-".
- Body-composition scans also send **segment data** (fat and muscle for each arm, each leg and the trunk) that we never show.
- The AI note is one short, generic paragraph that names only 2-3 values.

## What members will get

### Posture report (3-4 pages)
1. **Cover**: name, date, posture score gauge, one-line verdict.
2. **3D body views**: the scanner's front / left / right / back images in a 4-panel strip, with alignment lines and markers drawn over them (head tilt, shoulder level, pelvis tilt, body lean), each labelled with the measured angle and a coloured status.
3. **Alignment table**: every value with unit (° / cm), healthy range, a coloured range bar, status badge, and a plain-language "what this means" line (e.g. "Head forward 0.11 — your ear sits almost directly over your shoulder; ideal").
4. **Body circumferences**: bust, waist, hip, thighs, calves, upper arms, rounded to 1 decimal with left/right difference highlighted when imbalance is over a threshold.
5. **AI analysis** (see below).
6. **"View your 3D body" button + QR code** that opens the member's interactive 3D model (existing viewer page) — a PDF can't spin a 3D model, so the PDF shows the 4 rendered views and links to the live one.

### Body Composition / BMI report (3-4 pages)
1. **Cover**: health score gauge, weight, BMI, body fat % as big KPI tiles.
2. **3D segment body map**: a front-facing body figure split into 5 zones (left arm, right arm, trunk, left leg, right leg), each zone shaded by muscle level and labelled with fat kg and muscle kg — the "3D BMI assessment" look.
3. **BMI scale**: horizontal Underweight / Normal / Overweight / Obese bar with the member's marker.
4. **Grouped metrics with range bars**: obesity, muscle & water (ICF/ECF, TBW), metabolism (BMR, metabolic age, visceral fat), each with unit, range, status and a one-line meaning.
5. **Targets**: target weight, fat to lose / muscle to gain, shown as arrows.
6. **Progress vs last scan** when a previous scan exists (weight, fat %, muscle).
7. **AI analysis** + "View in 3D" link/QR.

### Advanced AI analysis (both reports)
- Runs automatically when the scan arrives; saved with the report so it is not regenerated on every download or resend.
- Structured, not one paragraph:
  - **Summary** (3-4 lines).
  - **Value-by-value explanation**: every out-of-range or notable value — what the term means, what the member's number says, why it matters.
  - **Strengths** and **focus areas**.
  - **4-week action plan**: training, mobility/corrective drills (for posture), nutrition and recovery habits.
  - **Ask your trainer** questions.
- Safety rules kept: no diagnosis, no medical claims, no prices; uses only the scan's numbers. Falls back to the current short note if AI is unavailable, so delivery never fails.
- The same analysis also shows in the scan detail drawer in the app (member and staff), not only in the PDF.

### Controls
- Branch setting `scan_report_v2` (on by default) switches between the new and old layout instantly.
- Staff "Send again" picks up the new layout; already-sent reports can be regenerated from the Scan Reports tab.

## Technical details
- `supabase/functions/_shared/scan-report-pdf.ts` → v2 renderer: pdf-lib pages for cover, image strip (fetch the 4 HOWBODY PNGs server-side, embed, draw overlay lines from angle values), range bars, segment body map drawn as vector shapes, BMI scale, QR code (small pure-TS QR encoder) linking to the existing public report page with 3D viewer.
- Healthy-range + term-glossary table in a new `_shared/scan-glossary.ts` (units, ranges, plain meaning per field), shared with the app drawer via a mirrored `src/lib/scans/glossary.ts`; unit tests for range/status classification.
- Parse body `jdzf` / `jrjh` segment arrays from `full_payload` (fallback: hide segment map if absent); fill posture type/body shape from payload when present.
- `deliver-scan-report`: AI call returns strict JSON (summary, items[], strengths, focus, plan, questions) via the AI gateway with tool-calling schema; stored in a new `scan_report_ai_analysis` table (report_id, kind, input_hash, analysis jsonb), reused unless scan values change. RLS mirrors `howbody_*_reports` visibility.
- `HowbodyReportDrawer`: new "AI analysis" section and glossary tooltips, with loading/empty/error states and keyboard-accessible accordions.
- Images fail-safe: if a HOWBODY image URL is unreachable, the panel shows a neutral placeholder and the rest of the report still renders.
- Original vendor PDFs, if uploaded, still take priority (no change to that rule).
- Verify by regenerating Yogesh's posture and body reports and reviewing the rendered pages.
