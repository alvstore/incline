## Audit findings — HRM › Contracts + Create Contract drawer

Working from the screenshots, current code (`src/pages/HRM.tsx`, `src/components/hrm/CreateContractDrawer.tsx`, `supabase/functions/contract-signing`) and live DB (`contracts.base_salary = 0` even though `employees.salary = 25000`).

### 1. Create Contract drawer — bugs & cleanup

| Issue | Today | Fix |
|---|---|---|
| **Commission % not auto‑fetched** | Defaults to `10` for trainers. `trainers.pt_share_percentage` is ignored. | When role = trainer, fetch `pt_share_percentage` from the trainer row (for the same `user_id` if dual‑role) and seed the field. Read‑only by default with an "Override for this contract" toggle (owner/admin only). |
| **Base Salary shows ₹0 in table** | `defaultSalary = Number(employee?.salary || 0)`. For trainer‑only rows `salary` doesn't exist (only `fixed_salary`), so the field starts at 0 and a save keeps it 0. | Normalise: `defaultSalary = employee.salary ?? employee.fixed_salary ?? linkedRecord.salary ?? 0`. Block save if `0` unless explicitly confirmed. |
| **T&C giant preview** | 16‑row read‑only `<Textarea>` of the rendered template. Sheet width is `sm:max-w-md` so it overflows. | Replace with a compact "Contract Variables" collector (the canonical `CONTRACT_VARIABLES` from `src/lib/hrm/contractVariables.ts` we already built but never wired here). HR‑role fields: probation, notice period, witness names. Employee‑role fields stay on `/contract/:token/fill`. Full document is rendered server‑side at PDF time. |
| **"Unlock Legal Clauses" switch sitting at top** | Always visible. | Move inside an `Advanced` disclosure (owner/admin only) — audit log already wired, keep that. |
| **Sheet width** | `sm:max-w-md` causes the form in screenshots to wrap awkwardly. | Bump to `sm:max-w-xl` to match the project's drawer standard. |
| **Hardcoded company copy** | `'Udaipur, Rajasthan'`, proprietor name, principal place are hardcoded in `getEmploymentAgreementTemplate`. | Drop the hardcoded strings; pull from `get_employer_profile` RPC at render time (already used by `EmployerSummaryCard` + the PDF builder). The drawer should not embed employer copy at all — only collect variables. |

### 2. Contracts table — action button audit

Today every row renders **8 buttons**: Eye, Printer, Download, ExternalLink (if doc), Sign link, W1, W2, HR — plus View Signed / Stamped PDF when signed. Eye + Printer + Download all call the **same** `openContractPdf(contract)`.

```text
Before: [👁] [🖨] [⬇] [🔗] [Sign link] [W1] [W2] [HR]    ← 8 buttons, 3 do the same thing
After:  [Preview ▾] [Share ▾] [Status pill]
         │             │
         │             ├── Sign link (employee)     ← only when unsigned
         │             ├── Witness 1
         │             ├── Witness 2
         │             └── HR override
         │
         ├── Open in new tab
         ├── Download PDF
         ├── Print
         └── Open uploaded file  (only if document_url)
```

- Collapse Eye / Printer / Download into a single **Preview** primary button with a dropdown for Print / Download / Open uploaded.
- Collapse Sign link / W1 / W2 / HR into a single **Share** dropdown — signed contracts show **View Signed** primary + **Stamped PDF** in the overflow instead.
- Add a **Void / Cancel** action in the overflow (status `cancelled`) — currently impossible from UI.
- Remove the `Trainer` mini‑badge from the code column and keep it only on the avatar row (it appears twice for dual‑role today).

### 3. Edge function error toast in screenshot

The "Edge Function returned a non‑2xx status code" toast triggers on **Stamped PDF**. Two known causes already in code:

- `get_pdf` is only valid for contracts where `signature_status = 'signed'`. The button is shown only for signed rows already, but the latest row in DB is `signature_status = 'sent'` — the toast in the screenshot was reproduced by clicking another action. We will:
  - Re-check `getOrBuildPdf` returns JSON `{ error }` (never throws) and that the front-end surfaces `data.error` (it does).
  - For the Eye/Print/Download buttons on **unsigned** rows, switch from `openContractPdf` (which renders a client‑side print window from `terms`) to `contract-signing` `action: 'get_pdf'` with `copy: 'draft'` so the preview matches the eventual signed PDF (single source of truth — same template, same employer header/footer, same variable injection).
  - Add `case 'get_pdf'` branch for unsigned drafts in `supabase/functions/contract-signing/index.ts` that renders the draft PDF without the signature block.

### 4. "All Staff (5)" tab — separate quick audit

- Employees query returns both employees and trainers via `payrollStaff`; dual‑role badge logic in `hrmService` is correct.
- The "All Staff" list itself is fine; no duplicate actions found. **No changes** needed here other than ensuring `salary` always falls back to `fixed_salary` for trainer‑only rows (already done in `fetchAllPayrollStaff`).

### Files to touch

- `src/components/hrm/CreateContractDrawer.tsx` — commission auto-fetch, salary fallback, replace T&C preview with variables collector (wire existing `CONTRACT_VARIABLES`), move legal unlock into Advanced, widen sheet, drop hardcoded employer copy.
- `src/pages/HRM.tsx` — Contracts table actions consolidated into Preview/Share dropdowns, remove duplicate trainer badge, add Void action.
- `src/services/hrmService.ts` — `cancelContract(id)` helper.
- `supabase/functions/contract-signing/index.ts` — extend `get_pdf` to render `draft` copy for unsigned contracts so previews & downloads use the **same** server‑side renderer (no more client print fallback).
- No schema changes (we already have `contract_variables` JSONB + per‑role signature requests from the previous migration).

### Out of scope

- Policies / HR Settings tabs (already consolidated in earlier work).
- WhatsApp/OTP templates (already unified to `otp_verification` system event).
- Employer profile single‑source‑of‑truth (already done via `get_employer_profile`).
