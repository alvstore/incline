# Plan: Fix phone field prefix on Trainer/Staff edit drawers

## Audit findings

Project standard (per memory): all phone inputs use `<PhoneInput>` from `@/components/ui/PhoneInput`, which locks the `+91` country prefix and strips invalid leading zeros. Several drawers still use a plain `<Input>` for phone fields, so the saved value is whatever the user types (e.g. `9876543210` with no prefix, or `09876…` with a stray leading zero). That breaks WhatsApp dispatch, SMS, and identity lookups.

| File | Field | Component used | Status |
|---|---|---|---|
| `src/components/trainers/AddTrainerDrawer.tsx:277` | `phone` | `PhoneInput` | OK |
| `src/components/trainers/AddTrainerDrawer.tsx:326` | `emergency_contact_phone` | plain `Input` | **Bug** |
| `src/components/trainers/EditTrainerDrawer.tsx:244` | `phone` | plain `Input` | **Bug** |
| `src/components/trainers/EditTrainerDrawer.tsx:311` | `emergency_contact_phone` | plain `Input` | **Bug** |
| `src/components/employees/AddEmployeeDrawer.tsx:402` | `phone` | `PhoneInput` | OK |
| `src/components/employees/EditEmployeeDrawer.tsx:213` | `phone` | plain `Input` | **Bug** |
| `src/components/employees/EditEmployeeDrawer.tsx:313` | `emergency_contact_phone` | plain `Input` | **Bug** |
| `src/components/members/AddMemberDrawer.tsx:254, 380` | `phone`, `emergency_phone` | `PhoneInput` | OK |

Net effect for the user's report: when a manager edits a trainer (or a staff member), the phone field is a raw text box — so saved numbers like `9876543210` lose the `+91`. Add-trainer's emergency contact has the same issue.

## Fix

Swap the offending plain `<Input>` controls for `<PhoneInput>` — same value/onChange contract — in:

1. `AddTrainerDrawer.tsx` → emergency contact phone (line 326).
2. `EditTrainerDrawer.tsx` → primary phone (line 244) and emergency contact phone (line 311).
3. `EditEmployeeDrawer.tsx` → primary phone (line 213) and emergency contact phone (line 313).

`PhoneInput` already returns a normalized `+91XXXXXXXXXX` string via its `onChange`, so the existing `setProfileData({...phone: value})` / `setF({...emergency_contact_phone: value})` wiring works unchanged. On load, `PhoneInput` displays the local 10-digit portion regardless of stored format (with/without prefix, leading zero), so existing rows continue to render correctly and re-save in the canonical `+91` form.

No DB migration, no backfill in this pass. Optional follow-up (not in scope here): a one-time SQL backfill that prefixes existing `profiles.phone` / `profiles.emergency_contact_phone` rows that don't start with `+`. Flag this to the user but do not run automatically.

## Verification

- Open Trainers → Edit a trainer → phone field shows existing number without prefix, prefix `+91` chip visible, save → `profiles.phone` stored as `+91XXXXXXXXXX`.
- Same for Add Trainer (emergency contact), Edit Employee (both phones).
- No regression on Add Trainer / Add Employee / Add Member primary phone (already `PhoneInput`).

## Out of scope

- Member edit drawer (no separate file — Members use AddMemberDrawer in both modes, already `PhoneInput`).
- Backfill of historical rows.
- Any change to `PhoneInput` itself.
