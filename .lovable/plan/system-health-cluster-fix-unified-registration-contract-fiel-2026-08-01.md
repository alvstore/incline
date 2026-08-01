# System Health cluster fix + unified registration → contract fields

## Cluster-by-cluster audit

### Clusters 1 & 6 — same root cause: `sync-to-mips` runs out of memory
Both are "Function failed due to not having enough compute resources" on `sync-to-mips`.
Confirmed cause: the function downloads the raw member/staff photo and decodes it fully in memory with `imagescript` (`normalizePhotoBytes`), then holds the decoded bitmap, the resized copy, the re-encoded JPEG and the multipart body at once. Large phone photos (several MB) blow the edge worker memory limit.

Fix in `supabase/functions/sync-to-mips/index.ts`:
- Skip decoding entirely when the fetched photo is already small enough for MIPS (under ~200 KB) — upload as-is.
- Hard-reject sources over ~6 MB (log and mark the sync attempt failed with a clear reason instead of crashing the worker).
- Do a single-pass resize/encode, release intermediate references before building the multipart body, and wrap normalization so a decode failure falls back to the original bytes rather than killing the invocation.

### Cluster 4 — `Missing person_id or person_type` (400 on sync-to-mips)
`src/components/devices/DeviceFleetTab.tsx` "Fleet sync" invokes `sync-to-mips` with `{ sync_type: "fleet", branch_id }`, but that function only accepts a single person. Fleet-wide healing is `mips-reconcile-devices`.

Fix: point the fleet button at `mips-reconcile-devices` (branch-scoped) and keep the toast wording. No backend change needed.

### Cluster 3 — 403 inserting into `tasks` from `/my-requests`
`src/pages/MemberRequests.tsx` inserts a task row so a trainer picks up a plan request. Current policies on `tasks` are only "Staff manage tasks" (owner/admin/manager/staff) and a SELECT policy — a member has no INSERT path, so PostgREST returns 403.

Fix (migration): add a narrow member INSERT policy — `assigned_by = auth.uid()`, `linked_entity_type = 'member'`, and `linked_entity_id` must be the caller's own member row — plus the matching `GRANT INSERT ... TO authenticated` check. Members still cannot read or edit other tasks.

### Cluster 5 — `howbody_posture_reports.posture_type does not exist`
The table genuinely has no `posture_type` / `body_shape_profile` columns (verified against the live schema); those columns live on `member_measurements`. Current source in `useHowbodyReports.ts`, `useLatestHowbodyScan.ts` and `MyScanReport.tsx` no longer selects them, so the failing request is coming from an older published bundle still running on the member's phone.

Fix: no query change needed. Add the two nullable text columns to `howbody_posture_reports` so cached clients stop 400-ing, and publish so the member app picks up the corrected bundle.

### Cluster 2 — `Script error.` on `/member-dashboard` (iOS Safari)
Opaque cross-origin script error with no file/line — it carries no actionable stack. The reporter already has a `Script error` ignore pattern but only drops it when `filename`, `lineno` and `colno` are all empty; this one slipped through.

Fix in `src/lib/errorReporter.ts`: treat any message matching `/^Script error\.?$/i` as noise regardless of the other fields, and add `crossorigin="anonymous"` to the app script tag in `index.html` so future cross-origin errors report real stacks.

---

## Part 2 — Unified registration fields on the printed contract

Audit result:
- Public `/register` (`PublicRegistration.tsx` → `register-member`) collects goal, health conditions, government ID, emergency contact, address, PAR-Q and consents, and stores them on `members` / `profiles` / `member_onboarding_signatures`.
- But the PDF that `register-member` generates is a minimal waiver: name, code, phone, email, branch, release text, PAR-Q, consents, signature. Government ID, address, gender/DOB, emergency contact, fitness goal, health conditions and custom terms are **not** printed.
- The staff-side PDF (`buildRegistrationFormPdf` in `src/utils/pdfBlob.ts`) already prints all of those sections. So self-registered members get a poorer document than staff-registered ones.
- The staff drawer re-asks Health & Fitness because it seeds from `data.fitnessGoals` / `data.medicalConditions` passed by `MemberProfileDrawer`; when those are populated from `/register` the chips do prefill — the gap is that goal/health/gov-ID are not visible on the self-register PDF, so it looks unsynced.

Fix:
1. Extend the PDF builder in `supabase/functions/register-member/index.ts` to print the same section set as the staff PDF: Member Information (incl. gender, DOB, address, city/state), Government ID, Emergency Contact, Health & Fitness (goal + conditions), PAR-Q, Terms/custom terms, Declaration, Signature.
2. Pass the full registration payload into that builder (currently only name/code/phone/email/branch are forwarded).
3. Persist `custom_terms` from the public flow into `member_onboarding_signatures` so the staff drawer and any reprint show identical text.
4. In `MemberProfileDrawer.tsx`, ensure `governmentIdType`, `governmentIdNumber`, `fitnessGoals`, `medicalConditions`, address and emergency contact are always sourced from `members` + `profiles` before opening the registration drawer, so staff see read-only prefilled values instead of blank chips.
5. Keep `src/lib/registration/healthQuestions.ts` as the single source for goals, health chips and PAR-Q — both flows already import it; no forking.

## Files to change
- `supabase/functions/sync-to-mips/index.ts` — photo memory guards
- `supabase/functions/register-member/index.ts` — full registration PDF
- `src/components/devices/DeviceFleetTab.tsx` — fleet sync target
- `src/components/members/MemberProfileDrawer.tsx` — prefill parity
- `src/lib/errorReporter.ts`, `index.html` — opaque script-error noise
- One migration: member INSERT policy on `tasks`; nullable `posture_type` / `body_shape_profile` on `howbody_posture_reports`
