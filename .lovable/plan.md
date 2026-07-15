## Root causes (verified with DB + code inspection)

**1. Only one device shows in CRM (Gate 2), Gate 1 hidden**
`MIPSDevicesTab.tsx` filters MIPS devices by matching `deviceKey` against rows in `access_devices`. Only `F06D92740D0062CF` is registered locally, so `D1146D682A96B1C2` (Gate 1) is stripped out even though MIPS returns it. Requiring manual "Add Device" for hardware already visible on the MIPS server is redundant.

**2. Love Kumar Paliwal syncs as "Unknown" with no email/gender/DOB and wrong dates**
Member `INC-26-0004` has `user_id = NULL`, `biometric_photo_url = NULL`, and no `active` membership yet. The sync-to-mips function only joins `profiles:user_id` and only loads `memberships` where `status='active'`. Result: name="Unknown", email/phone empty, dates default to today→2099-12-31. The lead row already holds `full_name`, `email`, `phone` — we're just not reading them.

**3. Trainers/employees missing department, birthday, gender, email, mobile on MIPS**
`sync-to-mips` sends a fixed payload: hardcoded `gender:"M"`, no `birthday`, no `deptName`, and `mobile/email` only come from `profiles`. Employees.department, employees.date_of_birth, employees.gender, trainer specialization etc. are never sent. MIPS Employee Management screen therefore shows blanks.

**4. Converted-from-lead members have no profile / login ID**
`convert_lead_to_member` RPC creates a `members` row but does NOT create an `auth.users` + `profiles` row, so the member has no `user_id`, cannot log in, and cascades into the "Unknown" MIPS problem.

---

## Plan

### A. Auto-import devices from MIPS (removes "add in CRM" friction)
- **MIPSDevicesTab**: stop hiding MIPS-server devices that aren't in `access_devices`. Show every device the MIPS server returns for the branch; overlay `branchName / publicIp / doorRole` only when a local mapping exists. If a device has no local mapping, show an inline "Register in CRM" button that creates the `access_devices` row (SN + branch pre-filled) with one click.
- New edge function `mips-import-devices` (service-role): pulls `/through/device/list`, upserts into `access_devices` by `serial_number` (never overwriting `branch_id` / `door_role` / `public_ip` if already set), stamps `mips_device_id`, `is_online`, `last_seen_at`. Wire it to the existing `mips_reconcile_devices` cron so new hardware auto-appears without any manual step.

### B. Fix personnel data sent to MIPS (`sync-to-mips` v1.5.0)
Before calling `/personInfo/person`, build a merged profile from every available source, in priority order:

1. **Members** — `profiles(user_id)` → `leads(lead_id)` → member row fallback. Extract `name, email, phone, gender, date_of_birth, avatar_url`. If `biometric_photo_url` is null, fall back to `avatar_url`.
2. **Employees** — merge `profiles + employees` (department, position, date_of_birth, gender, personal_email, personal_phone).
3. **Trainers** — merge `profiles + trainers` (specialization → deptName, DOB, gender, personal contacts).

Enrich the outbound payload with the fields the RuoYi API actually accepts:
- `name`, `mobile`, `email` (never send empty string; omit when unknown so MIPS keeps prior value)
- `gender`: `"M"` / `"F"` / `"U"` from CRM data — not hardcoded
- `birthday`: `YYYY-MM-DD` from DOB
- `deptId` + `deptName`: `100/"Members"`, `101/"Staff"`, `102/"Trainer"` (add a dept lookup helper)
- `remark`: department + position for staff, plan name for members

**Validity dates for members** — load the newest membership regardless of status (active + frozen + future + expired) and pick:
- Active → `start_date` → `end_date`
- Frozen → `start_date` → `end_date` (paused, but MIPS still needs a window)
- Future → future `start_date` → `end_date` (so access opens only on start day)
- Expired → `validTimeEnd = REVOKED_DATE` (blocks access)
- No membership → 24h probation window, not 2099

Log the final payload so future field additions are traceable.

### C. Ensure converted leads get a real profile/login
Extend `convert_lead_to_member` RPC:
1. If lead has a phone or email and no matching `auth.users`, mint a member auth user via a small edge function `provision-member-login` (service-role, uses `admin.createUser`, random password, `email_confirm=true`).
2. Insert into `profiles` (id, full_name, email, phone, avatar_url) copied from the lead.
3. Set `members.user_id`.
4. Fire the existing `member_welcome` communication trigger so the member gets a set-password link.

Existing broken row (`INC-26-0004`) is backfilled by running the same edge function once, then re-syncing to MIPS.

### D. CURL verification harness
Add `supabase/functions/mips-field-probe/index.ts` (service-role, one-shot): calls `/personInfo/person/list?pageSize=1`, `/through/device/list`, `/system/dept/list`, and returns the raw JSON keys so we can lock the payload contract in code + docs. Run it once from the "Debug" tab and paste result into `.lovable/mips-api-reference.md`.

### E. UI polish
- **Personnel Sync** cards show DOB, gender, department, email, phone chips when present, and a red "Missing fields" pill when any are empty — so operators can fix data in CRM before re-syncing.
- Device Command Center: online/offline count now reflects raw MIPS list (not filtered), with a "Register X unmapped devices" prompt.

---

## Files touched

- `supabase/functions/sync-to-mips/index.ts` — merged profile loader, membership-aware validity, dept lookup, enriched payload, gender/DOB/deptName
- `supabase/functions/mips-import-devices/index.ts` — NEW, auto-upsert
- `supabase/functions/provision-member-login/index.ts` — NEW, mint auth user + profile
- `supabase/functions/mips-field-probe/index.ts` — NEW, diagnostic
- Migration: extend `convert_lead_to_member` RPC to call provisioning + copy lead → profile; add `automation_rules` row for `mips_import_devices` (every 15 min)
- `src/components/devices/MIPSDevicesTab.tsx` — show all, unmapped inline register button
- `src/components/devices/PersonnelSyncTab.tsx` — data-quality chips
- `src/services/mipsService.ts` — `importDevicesFromMips()` helper

No changes to member-facing checkout, billing, or RLS beyond the RPC extension.
