# One QR link for BMI + Posture (single bind)

## What we found
- The scanner runs BMI first, then posture, on the same bind. The BMI result carries the member's link ID, so it saves correctly (Balveer's BMI saved).
- The posture result arrives later **without** that link ID. It carries a device-made number (e.g. `81171114064158`) and no scan session ID. Today the app can't match it to anyone, so it rejects it as "member not found". This has happened on 4 Nov and 14 Nov (photos and 3D model were in those results but got thrown away).
- For Balveer, no posture result has come in yet. The scanner usually retries every 10 minutes. With the fix, the next retry will save.

## What changes

1. **One bind covers both scans**
   - The QR screen stops asking you to choose Body or Posture. It shows "BMI + Posture" as one combined scan.
   - The session records both. No second bind is needed.

2. **Posture is matched to the member who just did BMI**
   - When a posture result has no known link ID, the app finds the scan session that was bound or completed on **the same scanner within the last 30 minutes** and assigns it to that member.
   - If two people used that scanner in that window, the app picks none and flags the scan for staff instead of guessing.
   - The 3D model, the four photos and the posture score then appear in My Progress, the staff Scans tab and WhatsApp/email delivery as usual.

3. **Recover posture scans that were rejected**
   - Posture results that were rejected earlier are still stored in the log with their photos. Staff get a "Unmatched posture scans" list (Settings → Body Scanner) to link each one to the right member in one tap (audited), using the existing unmatched-scan linking.

4. **/scan-login screen redesign with motion**
   - Step indicator: Sign in → Link → BMI → Posture → Report ready.
   - A live status card shows "BMI received" and then "Posture received" as each result arrives (real-time), with a short check animation and a soft scanning pulse while waiting. It respects the reduced-motion setting.
   - Height picker and the device badge stay. The design follows the existing app colours and rounded cards.
   - After both results arrive, it moves to the report automatically. If posture doesn't arrive within 15 minutes, it shows a "Posture still processing" note instead.

## Technical details
- `howbody-posture-webhook`: after the UID and phone lookups fail, run an equipment fallback against `howbody_scan_sessions` (`equipment_no` = payload, `created_at` > now − 30 min, status bound/completed). Accept it only if exactly one distinct member matches. Persist `howbody_third_uid` aliasing is not needed. Log the match method in `howbody_webhook_log.message`.
- `howbody_scan_sessions`: add a nullable `kinds text[]` column with default `{body,posture}` (additive). `howbody-bind-user` checks both quotas and sends one bind. Posture consumption stays idempotent via `howbody_consume_scan(dataKey)`.
- Add an index on `howbody_scan_sessions (equipment_no, created_at desc)`.
- Reprocess: a staff-only drawer lists `howbody_webhook_log` rows (endpoint=posture, 404) and calls the existing audited `howbody_link_unmatched_scan`.
- UI: `HowbodyLogin.tsx` adds a realtime subscription on body and posture report inserts for the member, plus a GSAP/CSS step timeline. Tokens only.
- Add a unit test for the fallback rule: one matching member gets the scan, while zero or several matching members are rejected.
