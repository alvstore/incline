# Member reports in the Member Profile drawer

Today the staff-side member profile shows only a small "Body" tab with the latest measurements, photos and a 3D view. Body-scan reports (HOWBODY body composition + posture) are visible **only to the member** on their own progress page. Staff have no way to open, print, download or re-send a member's report, and the measurement history is limited to the last few rows.

## What staff will get

Inside **Member Profile → Body**, four sub-tabs:

1. **Measurements** — latest metrics plus a full, scrollable history (not just 4 rows), each row showing who recorded it, weight, body fat and the change vs the previous entry.
2. **Photos** — unchanged.
3. **3D Body** — unchanged.
4. **Scan Reports** (new) — every body-composition and posture scan for that member.

### Scan Reports tab

- Timeline list, newest first: scan type, date, headline numbers (weight / body fat / health score, or posture score / slope), and a coloured badge for report readiness.
- Delivery status per channel (WhatsApp · Email · In-app) with the real reason when a send failed.
- Row actions: **View** (opens the existing detail drawer), **Download PDF**, **Print**, **Send again** (WhatsApp / Email pick-list).
- Scan credit strip showing remaining body/posture scans on the member's plan.
- Empty state when the member has never scanned, with a short line telling staff how a scan gets recorded.

### Print

- Report PDFs print the real HOWBODY document (already stored) via the browser print dialog.
- A **Print measurement sheet** action on the Measurements tab renders a clean, branded one-page summary (member name, code, branch, date, latest metrics, last 6 history rows) for the front desk.

## Technical notes

- New `src/components/members/MemberScanReportsTab.tsx`: staff-facing version of `HowbodyReportsCard` with print + resend actions; reuses `useHowbodyReports`, `useScanQuota` and `HowbodyReportDrawer`. No new data layer.
- `MeasurementProgressView.tsx`: grid becomes 4 columns, new tab wired in, `history` slice raised from 4 to full list with its own scroll area; add `memberName`/`memberCode` props for the print sheet.
- `MeasurementMetricsTab.tsx`: history card gains per-entry delta and a print button.
- New `src/components/members/MeasurementPrintSheet.tsx`: print-only markup (`hidden print:block`) plus a `@media print` rule in `index.css` so only the sheet prints.
- Re-send: `deliver-scan-report` currently skips channels already marked sent. Add an optional `channels: ['whatsapp'|'email']` + `resend: true` body param that forces a fresh dispatch through `dispatch-communication` (same dedupe-key pattern with an attempt suffix). No change to the automatic first-delivery path.
- RLS already allows owner/admin everywhere and manager/staff/trainer within their visible branches for `howbody_body_reports`, `howbody_posture_reports` and `scan_report_deliveries` — no policy changes needed.
- Send-again button is gated by the existing capability helper so trainers can view but not re-send.
- Styling stays on the project tokens: `rounded-2xl` cards, soft shadows, lucide icons, colour-coded status badges, skeletons while loading.

## Out of scope

- No change to how scans are captured, credited, or first delivered.
- No change to the member-facing progress page beyond shared components staying compatible.
