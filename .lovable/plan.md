## Goal
Consolidate staff attendance into the Staff Roster module, add daily/weekly/monthly views, branded PDF export, WhatsApp/email send, and ensure no duplicate weekly-off handling.

---

## 1. Move HRM → Attendance tab into Staff Roster
- **`src/pages/HRM.tsx`**: Remove the `<TabsTrigger value="attendance">` and the `<TabsContent value="attendance">` block (lines ~738 and ~1143). Keep the payroll attendance summary logic intact (it still feeds payroll calculations) but stop rendering the tab UI. Default tab fallback adjusted if "attendance" was the default.
- **`/staff-roster`** becomes the canonical home for everything attendance-related. Add a deep-link redirect: if user lands on `/hrm?tab=attendance`, redirect to `/staff-roster?view=attendance`.

## 2. Redesign `/staff-roster` — Daily / Weekly / Monthly + Attendance
Single page with a **view switcher** (segmented control top-right): `Day · Week · Month · Attendance`.

**Layout (Vuexy premium, ui-ux-pro-max):**
- Hero strip: gradient indigo→violet card with branch name, period label, trainer count, weekly-off count, "Export PDF" + "Send via WhatsApp" buttons.
- Sticky toolbar: view tabs, date/week/month picker, "+ New shift" CTA.
- Content card: `rounded-2xl shadow-lg shadow-slate-200/50`.

**Day view** (current behavior, polished):
- Trainer rows with morning/evening pills, status badge, edit/delete actions.

**Week view** (new):
- Grid: trainers × 7 weekday columns. Each cell shows compact morning + evening pills, weekly-off chip, click-to-edit. Sticky first column.

**Month view** (new):
- Calendar grid (rows = weeks, cols = Sun–Sat). Each day cell shows: trainer count on duty, weekly-off count, hover popover with full per-trainer breakdown. Click a day → jumps to Day view.

**Attendance view** (migrated from HRM):
- Month selector. Per-staff row: days present / working days, late count, total hours, manual-override badge, "Mark present" / "Sync MIPS" actions.
- Reuses the existing `useStaffAttendance` / payroll attendance query already in HRM.

## 3. Branded PDF export
Extend `src/utils/pdfBlob.ts` with a new builder `buildStaffRosterPdf({ scope: 'day'|'week'|'month', branch, rows, period })`:
- Reuses existing `header()` + `footer()` (global branding, branch logo, GSTIN, slogan).
- Day → simple table. Week → 7-column grid (lands in landscape A4). Month → calendar matrix in landscape A4.
- Footer: generation timestamp + legal name (already standard).
- Button on roster page: `downloadBlob(buildStaffRosterPdf(...), 'roster-<branch>-<period>.pdf')`.
- "Print" opens via `printBlob`.

## 4. Send via WhatsApp / Email
- "Send" drawer with recipient picker (managers + admins by default, plus free-form WhatsApp/email).
- Backend: call existing `dispatchCommunication()` with the generated PDF uploaded to storage (`comm-attachments/roster/<period>.pdf`) and a short caption ("Staff roster · <branch> · <period>").
- No new edge function needed — uses universal dispatcher.

## 5. Weekly-off duplication safeguard
- `staff_shifts` already has unique `(user_id, weekday)` (used by `upsert onConflict`). Add explicit DB check: trigger `tg_staff_shifts_one_off_per_week` that prevents the same user_id having `is_weekly_off=true` on more than one weekday simultaneously **only if the org rule is "1 weekly-off per week"**.
- UI: when toggling weekly-off, show inline warning if another weekday already has `is_weekly_off=true` for that trainer, with a "Replace existing off-day" confirmation. Existing day automatically cleared on save.
- No additional schema/columns needed — uses existing `is_weekly_off` boolean.

## 6. Menu hygiene
- Confirm `Staff Roster` stays under Admin & HR (already done previous turn). No change.

---

## Files touched
- `src/pages/StaffRoster.tsx` — major redesign (Day/Week/Month/Attendance + PDF/Send)
- `src/pages/HRM.tsx` — remove attendance tab, add redirect
- `src/hooks/useStaffSchedules.ts` — add month/week aggregators + attendance fetch helper
- `src/utils/pdfBlob.ts` — add `buildStaffRosterPdf`
- `src/components/roster/RosterSendDrawer.tsx` *(new, only if approved — single component for send flow)*
- `src/components/roster/MonthGrid.tsx` *(new, single component)*
- Migration: `tg_staff_shifts_one_off_per_week` trigger

## Out of scope
- Rotation auto-planner (Sunday 1–6 rotation in your reference image) — capture-only, manual entry for now. We can follow up with a "Generate rotation" wizard in the next sprint.
- MIPS auto clock-in for managers — already noted as post-July work.

## Skills used
- `/skill:redesign` for the view-switcher reshape
- `/skill:ui-ux-pro-max` for the Vuexy-premium hero + month calendar density