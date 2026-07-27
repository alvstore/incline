## Root cause audit

**Issue 1 — Only one device receives syncs**
`access_devices` currently has 2 rows:
- `Gate 1` (SN `D114…B1C2`) → `mips_device_id = 13`, online ✓
- `Entry 2` (SN `F06D…62CF`) → `mips_device_id = NULL`, offline

`sync-to-mips` → `dispatchToDevices()` builds `deviceIds` from `access_devices` filtered by `mips_device_id IS NOT NULL`. `Entry 2` is silently dropped, so every personSync goes to Gate 1 only. The MIPS fallback path (querying `/through/device/list`) never fires because at least one row exists. Even `mips-reconcile-devices` skips this branch because it requires `≥ 2` mapped devices.

**Issue 2 — Gender syncs as "U" (Unknown)**
`sync-to-mips` reads gender from:
- Members: `leads.gender` only (members table has no gender column, `profiles.gender` is ignored).
- Employees / Trainers: `employees.gender` / not read at all for trainer, `profiles.gender` never consulted.

`profiles` DOES have `gender` and `date_of_birth` columns. Result: any member converted without lead metadata, and every trainer, syncs as `gender=U`, and MIPS device UI shows "Unknown" avatar with no gender chip.

## Fix plan (2 focused patches, no business-logic changes)

### 1. Auto-map missing MIPS devices before every dispatch
Edit `supabase/functions/sync-to-mips/index.ts` → `dispatchToDevices()`:

1. Fetch `access_devices` for the branch (as today) → local set.
2. Always call `GET /through/device/list` once, build `serial → mipsDeviceId` map.
3. For every local device where `mips_device_id IS NULL` **but** `serial_number` matches a server row, `UPDATE access_devices SET mips_device_id = …, is_online = …, last_reconcile_at = now()`.
4. Recompute `deviceIds` from the (now enriched) local set.
5. Dispatch `syncPerson` with the full array.

This makes both devices auto-heal on the next sync attempt without a manual "Import all" click, and it stays branch-scoped.

### 2. Enrich gender / DOB fallback chain
In `sync-to-mips` person-resolution block:

- **Member**: change join to also select `profiles(gender, date_of_birth)`; set
  `gender = normGender(profile?.gender ?? lead?.gender)` and
  `birthday = fmtDob(profile?.date_of_birth ?? lead?.date_of_birth)`.
- **Employee**: `gender = normGender(emp.gender ?? profile?.gender)`, `birthday = fmtDob(emp.date_of_birth ?? profile?.date_of_birth)`.
- **Trainer**: extend the `profiles` select to include `gender, date_of_birth` and use the same fallback (currently trainer gender is never sent → always `U`).

Also include `deptName` fallback for trainers: keep current logic but never send empty string.

### Verification after build

1. Backfill run: invoke `sync-to-mips` for Muskan Joshi, Love Kumar Paliwal (INC-26-0004), and one trainer → confirm:
   - `access_devices` now has `mips_device_id` populated for `Entry 2`.
   - Edge log shows `Dispatching personId=… to devices: [13, <entry2_id>]`.
   - MIPS `/personInfo/person` GET returns `gender ∈ {M,F}` when profile has it.
2. Check `MIPSDevicesTab` UI shows both devices online with recent `last_reconcile_at`.

### Out of scope (deliberate)
- No schema changes (no new column on `members`; `profiles.gender` is the source of truth).
- No changes to enrollment, RLS, or the reconcile cron cadence.
- No UI copy changes.
