## Audit findings

Side-by-side comparison of the two drawers:

| Field | Add Trainer (Create New) | Edit Trainer |
|---|---|---|
| Avatar | ✅ | ✅ |
| Full name, email, phone | ✅ | ✅ (no email — auth-bound) |
| **Gender** | ❌ missing | ✅ Select |
| **Date of birth** | ❌ missing | ✅ |
| **Address / city / state / postal code** | ❌ missing | ✅ |
| **Emergency contact name + phone** | ❌ missing | ✅ |
| **Specializations** | ❌ free-text CSV `Input` | ✅ selectable `Badge` chips from `SPECIALIZATION_OPTIONS` |
| **Certifications** | ❌ free-text CSV `Input` | ✅ chip list with add/remove |
| Bio | ✅ | ✅ |
| Salary type | ✅ (`hourly`, `fixed` only) | ✅ (`fixed`, `hourly`, `commission`, `hybrid`) — richer |
| Hourly rate / Fixed salary / PT share | ✅ | ✅ |
| **Max clients** | ❌ missing | ✅ |
| **Government ID** | ✅ type Select + number Input | ❌ single text input only (label "Government ID") |
| Active status toggle | n/a (always active on create) | ✅ |
| Biometrics tab | n/a (post-create) | ✅ |

So Edit is richer for personal/specializations/certifications/max-clients; Add is richer for Government ID (has type selector + number, Edit only has a generic text box).

The "Link Existing" tab on Add Trainer has the same gaps as "Create New".

## Plan

Make both drawers share the same field set and widgets. Edit remains the reference for personal/specializations/certifications/max-clients/salary types; Add contributes its Government ID pattern back to Edit.

### 1. `AddTrainerDrawer.tsx` — bring up to parity with Edit

Apply to **both** the "Create New User" tab and the "Link Existing" tab:

- Add a **Personal Details** section (same layout as Edit) inside both forms, with fields: gender (Select male/female/other), date_of_birth (date), address (Textarea), city, state, postal_code, emergency_contact_name, emergency_contact_phone.
- Replace **Specializations** free-text `Input` with selectable `Badge` chips sourced from the same `SPECIALIZATION_OPTIONS` array (extract to `src/constants/trainerConstants.ts` so both drawers import from one place).
- Replace **Certifications** free-text `Input` with the add-chip + remove-X pattern from Edit (re-use `newCertification` local state).
- Add a **Max Clients** input (default 10) next to Hourly Rate.
- Expand **Salary Type** options to match Edit: `fixed`, `hourly`, `commission`, `hybrid` (with the same disabled-rule for Fixed Salary when type is `commission`).
- Keep the existing **Government ID type + number** pair as-is — this is the better pattern.
- Update `handleCreateNew` and `handleLinkExisting` payloads to send the new fields:
  - Personal fields → write to `profiles` table after trainer create (mirror Edit's profile-update block). For `create-staff-user`, pass them through in the edge function body so the function can write them when the profile is first created.
  - `max_clients`, expanded `salary_type`, `specializations` as `string[]` (no more CSV split), `certifications` as `string[]`.

### 2. `EditTrainerDrawer.tsx` — adopt Government ID type selector

- Replace the single "Government ID" text input with the same two-field layout used in Add: **Government ID Type** (`Select`) + **ID Number** (`Input`).
- Extend `formData` state with `government_id_type: string`. Hydrate from `fresh.government_id_type || fresh.profile?.government_id_type || ''`.
- On submit, write `government_id_type` alongside `government_id_number` to the `trainers` row (and mirror to `profiles.government_id_type` / `profiles.government_id_number` if Edit already mirrors there).

### 3. Shared constants

Create `src/constants/trainerConstants.ts` exporting:
- `SPECIALIZATION_OPTIONS`
- `SALARY_TYPES` (the 4-option list)
- `GOVERNMENT_ID_TYPES`

Import from this file in both drawers (and the `EmployeeDrawer` if it duplicates them — quick grep, no behavioural change).

### 4. Edge function — `create-staff-user`

Accept the new optional fields (`gender`, `dateOfBirth`, `address`, `city`, `state`, `postalCode`, `emergencyContactName`, `emergencyContactPhone`, `maxClients`, `governmentIdType`) and persist them on `profiles` / `trainers` insert. Keep all fields optional so other callers (Add Employee) don't break.

### 5. Verification

- Open Add Trainer → both tabs show Personal Details, chip specializations, chip certifications, max clients, government ID type+number.
- Create a new trainer with full data → reopen via Edit → all fields populated.
- Open existing trainer in Edit → Government ID type renders the saved type; saving persists it.
- No regression in `useCreateTrainer` / `useUpdateTrainer` typings (extend `TrainerInsert` usage where needed).

No DB migration required — `trainers.government_id_type` and the `profiles` columns already exist (Edit reads them today).
