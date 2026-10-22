# Realistic male/female body figure in the Body Composition report

## Problem
The "3D segment body map" on page 1 is drawn from flat boxes, so it looks like a robot. It also looks the same for every member.

## What changes
- Replace the boxes with a realistic, studio-style 3D anatomical body figure: neutral pose, front view, light grey skin tone, no face details, tasteful (athletic shorts / sports top for female).
- Two figures: **male** and **female**. The member's sex from the scan (falling back to the member profile) picks the figure. Unknown sex uses the male figure.
- Keep the segment information, but present it on the realistic body:
  - Soft coloured glow zones over left arm, right arm, trunk, left leg, right leg (green = balanced, indigo = strong, amber = below standard), drawn as translucent ellipses aligned to each figure.
  - Thin leader lines from each zone to small callout labels ("Left arm 4.5 kg muscle · 0.4 kg fat").
  - The existing segment table and left/right balance line stay beside the figure.
- Fix the earlier spacing so the figure never overlaps the BMI section.
- The same figures appear in the app's scan details panel, so the PDF and the app match.

## QA
- Regenerate Yogesh's body report (male), plus one female member's report if a female scan exists. If none exists, test with a sample render.
- Render every page to images and check for overlaps, clipping and alignment between glow zones and limbs. Fix and re-check until clean.

## Technical notes
- Generate two transparent PNG figures (fixed size, identical framing and pose) with the image tool. Store them as base64 modules in `supabase/functions/_shared/scan-body-figures.ts` so the edge function can embed them in pdf-lib without file reads, with a copy in `src/assets/` for the app.
- Per-figure zone coordinates (normalised 0–1) live in the same module, so the overlays line up with each figure.
- `scan-report-pdf-v2.ts`: replace the vector body drawing with `embedPng` plus overlay ellipses (opacity) and callouts. Raise the block height and push the BMI section down.
- `deliver-scan-report`: pass `sex` into the V2 body payload. Redeploy.
- No database or data changes. Older reports update when rebuilt.
