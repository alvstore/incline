## 1. Lockers: area / location (male room, female room, etc.)

Confirmed: `public.lockers` has only `branch_id, locker_number, size, status, monthly_fee, notes` — there is **no** area/location/zone column, so neither Add Locker nor Bulk Create can capture it.

- Migration: add `lockers.location text` (free text) + `lockers.gender_zone text` constrained to `male | female | common` (default `common`). Backfill existing rows to `common`.
- `lockerService.createLocker` and the bulk insert accept and write both fields.
- `BulkCreateLockersDrawer`: add "Area / Location" input + "Zone" select (Male room / Female room / Common), applied to the whole batch; shown in the preview chips.
- Add Locker form on `/lockers`: same two fields, same labels and options, so both forms are identical.
- `/lockers` list: show Location/Zone column, add a Zone filter chip, and include both in the CSV export.
- `AssignLockerDrawer`: display the locker's zone next to the locker number so staff don't assign a female-room locker to a male member (advisory label; no hard block unless you want one — tell me if you want it enforced).

## 2. Edit Member Profile drawer — field parity with Add / Registration

`EditProfileDrawer` currently edits name, phone, email, DOB, gender, address, city, state, postal code, country, emergency contacts, and fitness fields — but **not** `government_id_type` / `government_id_number`, which the Add Member and public registration forms do collect. `MemberProfileDrawer`'s profile query also doesn't select `postal_code`, `country`, or the government ID columns, so the preview tab can't show them.

- Add a "Government ID" section to `EditProfileDrawer` (ID type select: Aadhaar / PAN / Passport / Driving Licence / Voter ID, matching AddMemberDrawer, + ID number input), saved to `profiles`.
- Extend the `member-details` profile select in `MemberProfileDrawer` to include `postal_code, country, government_id_type, government_id_number, government_id_verified`, and render them in the Personal Info panel (masked Aadhaar, showing last 4).
- Make the three forms share one field list so create → edit → preview stay in sync, and ensure the edit drawer pre-populates from `profiles` first, then the linked lead record (existing fallback chain kept).

## 3. Benefit Tracking — "No gifts granted yet"

The query itself is correct (`member_comps` filtered by `member_id`). The database has 7 comp rows across only 3 members — so for most members the empty state is truthful, but the panel is also a dead end: there is no way to grant, edit, or revoke a gift from this page.

- Add a "Grant Gift" button on the Gifts tab that opens the existing `CompGiftDrawer` for the selected member, then invalidates the comps query.
- Show *all* comps (currently the visible list is filtered to unconsumed ones) with used/total, granted-by, reason, expiry, and a Revoke action for owner/admin.
- Improve the empty state to say gifts can be granted from here rather than looking like a load failure.
- If you were looking at a member who *does* have comps and still saw nothing, that's an RLS read gap for your role — I'll confirm the role against the `member_comps` policies during the build and widen the SELECT policy if needed.

## 4. MIPS face parity (Gate 1 = 41 faces, Gate 2 = 31, both 62 persons)

The `mips-face-parity` function exists and re-dispatches every photo-bearing person via `/through/device/syncPerson`. It could not be tested from here (the call returned 401 — no preview session token was available this turn), so the cause is **not yet confirmed**. Likely candidates, in order: the photo-detection field guess (`photoUri || havePhoto || photoUrl`) not matching what the MIPS person list actually returns, `deviceNumType: "4"` not being the right dispatch mode for face data, or the server silently queueing but not delivering to the second device.

Step 1 of the work is verification, not a blind fix:
- Run `action: "report"` against the live MIPS server and dump one raw person row and one raw device row, so the real field names and counts are known.
- Compare `server_persons_with_photo` against each gate's face count to find whether the server itself holds 41 or 62 photos.
- Then fix the field mapping / dispatch payload accordingly, add per-person result logging into `error_logs`, and make the resync report `dispatched / failed` per device instead of a single toast.
- Add a "Face parity" panel on the Device Command Center showing server photos vs each device's face count with a per-device "Re-sync faces" action and the last resync result.

## Technical notes

- New migration adds two columns to `public.lockers`; existing RLS policy already covers them, no new grants needed.
- No schema change for items 2–4; item 2 uses existing `profiles` columns, item 3 uses existing `member_comps`.
- All new queries go through TanStack Query with branch scoping; all forms stay in right-side Sheets.
