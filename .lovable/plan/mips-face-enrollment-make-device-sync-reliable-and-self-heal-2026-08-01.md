# MIPS Face Enrollment — Make Device Sync Reliable and Self-Healing

## What the live audit found (verified just now against the MIPS server)

- Both gates are online, app/firmware `1.42.0.2`, and **identical**: Gate 1 and Gate 2 each report `personCount 61`, `photoCount 41`. So this is not a Gate-1-vs-Gate-2 parity problem any more — both gates are missing the same faces.
- MIPS server holds **69 persons, 57 with a `photoUri`**, 12 with none (e.g. INC260008, INC260014, INC260024, INC260033, INC260044, INC260048, INC260049, INC260052, INC260053, INC260055, INC260056, INC260057).
- CRM holds 50 biometric photos (44 members, 1 employee, 5 trainers) and 63 people with a MIPS person id.
- So there are two distinct gaps:
  1. **Server gap**: ~12 persons exist on MIPS with no photo attached.
  2. **Device gap**: 57 photos on the server, only **41 enrolled as faces on the gates** — 16 photos the server accepted but the terminals never turned into a face template.
- `biometric_sync_queue` is **100% "succeeded" (53 rows)** — the queue believes everything worked. Meanwhile `mips_sync_attempts` for the last 3 days shows 6,316 `device_accepted` dispatches and **260 failures all with the same MIPS message `请选择在线设备` ("please select an online device")**. There is no `photo_upload` stage recorded at all — photo success/failure is never audited per person, only device dispatch is.
- The MIPS API exposes **no endpoint to read a device's person/face roster** (probed `through/device/personList`, `devicePerson`, `issueRecord`, `syncRecord` — all 500/No endpoint). The only device-side truth available is `personCount` / `photoCount` on `GET /through/device/list`.

Root cause is therefore not yet provable from logs alone, and the plan treats it as the first step. The two credible causes, both consistent with the evidence: (a) `syncPerson` returns success while the terminal silently discards the face because the image is over-compressed — our pipeline downsizes twice (client 640px/200KB, then edge re-encode down to quality 30) which can drop below the terminal's face-detection threshold; and (b) dispatches issued in the `请选择在线设备` window are lost with no re-queue, since the queue row is already marked succeeded.

## Plan

### 1. Prove the cause before changing the pipeline
Add a diagnostic action to `mips-face-parity` that, for a chosen person: re-uploads the photo at full quality, dispatches to one gate, waits, then re-reads `photoCount` from `GET /through/device/list`. A photoCount that does not increase proves the terminal is rejecting the image; one that does increase proves the loss was a dispatch/offline problem. Run it against 3 of the 16 missing people before rolling anything out.

### 2. Face-safe photo normalization (stop over-compressing)
In `sync-to-mips`, change `normalizePhotoBytes` so it never destroys face detail:
- Never resize below **720px on the long edge** (currently 640 and can halve again to 320).
- Quality floor **60** (currently steps down to 30).
- If 400KB cannot be met at those floors, mark the photo as `needs_better_source` instead of silently shipping an unusable image.
- Keep the existing 6MB source guard (it prevents the worker OOM).
Also raise the client-side compressor in `src/utils/imageCompression.ts` for the biometric path only: 720px max edge, ~350KB target, so the edge function receives a clean source instead of a twice-degraded one.

### 3. Audit every stage, not just the dispatch
Write `mips_sync_attempts` rows for `photo_upload` and `photo_assign` (the full-object PUT) with `response_code`, `latency_ms` and the MIPS message, mirroring what `device_dispatch` already does. Without this, photo failures are invisible — which is exactly why the queue reads 100% success.

### 4. Stop marking work "succeeded" when the face never landed
- Treat the MIPS `请选择在线设备` response as **retryable, not fatal**: re-queue the person with backoff rather than counting the attempt as delivered.
- A `biometric_sync_queue` row may only reach `succeeded` when photo upload, photo assign and every requested device dispatch all succeeded; otherwise it goes back to `pending` with the reason. (`process-biometric-sync-queue` already checks dispatch+photo — the gap is that the photo result is not truthfully reported by `sync-to-mips`.)

### 5. Continuous self-healing enrollment worker
Add a new automation rule `mips_face_enrollment_sweep`, run by the existing Automation Brain every **5 minutes** (1-minute ticks are wasteful and risk MIPS rate limits; 5 minutes closes a 16-person backlog in well under an hour):
- Compute the expected face population (CRM people with a photo, active, mapped to MIPS).
- Compare against each gate's live `photoCount`.
- While there is a shortfall, take the next 3 people from a rotating cursor whose last verified enrollment is stale, re-upload the photo and re-dispatch per device with a bounded 45s budget.
- Stamp progress so consecutive runs continue where the last left off, and record a per-run delta (`photoCount before → after`) so we can see the number climbing 41 → 57.
This reuses the existing bounded-window design in `mips-reconcile-devices` rather than adding a competing cron.

### 6. Backfill the 12 server persons with no photo
One-off pass: for each of those `personSn` codes, resolve the CRM person, and if a biometric photo exists, run the full upload + assign + dispatch. If no CRM photo exists, surface them in the Personnel Sync tab under a new **"No photo on file"** group so staff know to capture one — they can never enroll otherwise.

### 7. Operator visibility
On the Device Command Center's Personnel Sync tab, show a single truth strip: `CRM photos · MIPS photos · Gate 1 faces · Gate 2 faces`, the current shortfall, when the sweep last ran, and the last error per person. Failures currently vanish, which is why this has been hard to chase.

## Technical notes

- Files to change: `supabase/functions/sync-to-mips/index.ts` (normalization floors, photo-stage audit, truthful photo result), `supabase/functions/process-biometric-sync-queue/index.ts` (retryable offline error), `supabase/functions/mips-face-parity/index.ts` (diagnostic + photoCount verification), a new sweep function or an extension of `mips-reconcile-devices`, `src/utils/imageCompression.ts` (biometric preset), `src/components/devices/PersonnelSyncTab.tsx` (truth strip).
- Migration: one `automation_rules` row for the sweep, plus a small cursor/verification column if the sweep needs its own state.
- Success detection stays `json.code === 200 || json.code === 0`, never `response.ok`, per the API reference.
- The only device-side verification signal available is `photoCount` from `GET /through/device/list`; the plan builds verification around it because no per-device roster endpoint exists on this server version.
