# Fix: Filled details not saving + "Copy link" edge function error

## What's actually broken

**Bug 1 — "3 pending" never clears even after HR fills the fields**

`CreateContractDrawer` collects HR-entered variables (S/o name, address, emergency contact, witnesses, etc.) into local state, then on submit packs them into `terms.contract_variables` inside the `terms` JSONB column. But every other piece of the system reads from the dedicated `contracts.contract_variables` column:

- `contractFillState()` in `src/pages/HRM.tsx` (line 562) → reads `contract.contract_variables`
- Edge fn `contract-signing` → `missingRequired()` reads `contract_variables`
- PDF builder → interpolates from `contract_variables`
- `/contract-fill` page → reads `contract_variables`

DB confirmation for the current contract `38869d37…`:
```
contract_variables: {}                 ← empty
terms.contract_variables: { father_or_husband_name: "DINESH SHARMA", ... }  ← all data here
```

So HR data is being written to the wrong place. That's why the chip still says "3 pending" and the PDF still shows `[Pending — to be filled by employee]`.

**Bug 2 — "Edge Function returned a non-2xx status code" when copying link**

The HRM page action menu calls `contract-signing` → `create_link`. The most recent contract has only an open->expired link history, so the function path itself works. The non-2xx is almost certainly thrown by `createSignLink` returning 500 from a downstream insert/update, but the client toast currently shows a generic Supabase functions error instead of the server's actual message because `supabase.functions.invoke` only surfaces `error.message = "non-2xx"` and we never read `data.error` on the throw path.

Two fixes needed:
1. Edge fn currently returns 500 with a JSON body for downstream failures, but the body isn't surfaced. We'll read it client-side and show the real reason.
2. Add `log_error_event` inside `createSignLink` catch path so future failures show up in System Health.

## Plan

### 1. Persist variables into the correct column (root cause of Bug 1)

**`src/services/hrmService.ts` → `createContract`**
- Accept a new optional `contractVariables: Record<string, string>` parameter.
- Insert it into the top-level `contract_variables` column (default `{}`).
- Keep writing the legal text into `terms.conditions` and the compliance metadata into `terms.compliance_meta`, but **remove** `contract_variables` from inside `terms`.

**`src/components/hrm/CreateContractDrawer.tsx` → `handleSubmit`**
- Pass `cleanedVariables` as the new top-level `contractVariables` field instead of nesting it inside `terms`.

### 2. One-time backfill migration

New migration: for every contract where `contract_variables = '{}'::jsonb` AND `terms ? 'contract_variables'`, copy `terms->'contract_variables'` into `contract_variables` and then drop the nested key from `terms` to keep a single source of truth. This unblocks Ritesh's existing draft contract (`38869d37…`) immediately.

### 3. Better error surfacing for create_link (Bug 2)

**`src/pages/HRM.tsx` → `createContractSignLink`**
- After `supabase.functions.invoke`, when `error` is set, attempt `await error.context?.json()` (Supabase v2 attaches the response on `FunctionsHttpError`). Show the real `data.error` string in the toast instead of "non-2xx".

**`supabase/functions/contract-signing/index.ts` → `createSignLink`**
- Wrap the `contract_signature_requests` insert/update in try/catch; on failure, call `log_error_event` via service-role RPC with the contract id and a fingerprint of `contract_signing.create_link`, and return the underlying Postgres message in the JSON response so the client toast is actionable.
- Bump version comment to `v5.2.1`.

### 4. Verification

1. After deploy, open the existing draft contract → status chip should flip from "Awaiting employee details" to "Ready to sign" (because backfill moved the values).
2. Open Create Contract for any staff → fill the fields → submit → query DB: `contract_variables` column should be populated, `terms->'contract_variables'` should not exist.
3. From the contract row menu → "Copy employee fill / sign link" → should copy the URL and show success toast. If it ever fails again, the toast now shows the real reason.

## Out of scope

- Changing the PDF layout, branding, or template wording (already done in v5.2.0).
- Touching the Void / terminal status logic (already fixed in the previous turn).
- Adding new fields to the fill form.

## Technical notes

- The `terms` column will keep `{ conditions, compliance_meta }`. The PDF builder currently reads `contract_variables` directly (top-level), so no PDF code change is required after the backfill.
- The migration is data-only (no schema change). `contract_variables` column already exists with `jsonb default '{}'`.
- `log_error_event` is already available as an RPC; the edge fn calls it via the existing service-role client.
