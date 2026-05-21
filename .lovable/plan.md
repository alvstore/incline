
# HRM Contracts + Policies — 2026 India Compliance Plan (v2)

Scope: Re-audit and harden Trainer / Sales Staff / Manager employment agreements, the signature flow, the printed PDF artifact, and add a new unified Policy module. Skills: senior-architect, senior-backend, ui-ux-pro-max.

The reference draft you shared is **identical to what's already wired into `CreateContractDrawer.tsx`** (18 clauses + witnesses + Annexure A). Good news — nothing is lost; this plan **keeps every existing clause** and layers 2026 compliance + evidentiary-grade signing + branded print-ready PDF on top. Each existing clause is mapped below to "Keep / Reword / Augment".

---

## A. Clause-by-clause audit of your reference vs Indian law 2026

| # | Clause | Action | Why |
|---|---|---|---|
| Preamble | Parties block | **Augment** | Add Employer GSTIN, PAN, firm registration no., registered address. Add Employee: Father/Spouse, DOB, Gender, PAN, Aadhaar last-4, address, phone, email, employee code. |
| 1 | Appointment (Trainer/Sales/Manager) | **Keep** | Auto-tick based on role; add "Place of Work: <Branch>" + branch-transfer clause. |
| 2 | Commencement & nature | **Keep + Augment** | Add probation period (3–6 months) + confirmation language. |
| 3 | Job responsibilities A/B/C | **Keep + Augment** | Add trainer **scope-of-practice** disclaimer (no medical diagnosis, CPR/AED readiness) for liability under Consumer Protection Act. |
| 4 | Working hours | **Augment** | Add hard caps per **Rajasthan Shops & Commercial Establishments Act**: ≤9 h/day, ≤48 h/week, OT @ 2× per **Code on Wages 2019**; weekly off entitlement. |
| 5 | Salary & Commission | **Reword** | Add: "Basic ≥ 50% of CTC" mandate from **Code on Wages 2019**; minimum-wage floor per RJ notification; payment by 7th of next month (statutory); PT commission claw-back on refund / chargeback. Annexure A becomes mandatory salary breakup (Basic/HRA/Special). |
| 6 | Leave & absenteeism | **Augment** | Add explicit leave types from RJ Shops Act (CL/SL/EL), **Maternity 26 weeks** (Maternity Benefit Act 1961), bereavement, paternity (policy). |
| 7 | Notice period — 90 days for all | **Reword** | A uniform 90-day notice for entry-level staff is **often struck down** by Indian courts (Specific Relief Act §14, Madras/Delhi HC precedents). Tier it: **Staff 30 / Trainer 60 / Manager 90**. Notice payable in lieu permitted. |
| 8 | Termination by Employer | **Reword** | "Absolute right to terminate at any time with or without reason" needs the natural-justice safeguard for misconduct (show-cause + hearing) — otherwise unenforceable. Keep at-will for non-cause; add cause procedure. |
| 9 | Confidentiality | **Keep** | Already correct; survives termination is enforceable. |
| 10 | Non-solicitation 12 months | **Keep** | Enforceable in India when reasonable (12 months is acceptable). |
| 11 | Penalty ₹50,000 OR 3× client loss | **Reword** | Liquidated damages — under **Section 74 Indian Contract Act**, only "reasonable compensation" is recoverable; courts will not enforce a fixed penalty. Reword as: "actual damages provable, with one month's CTC as agreed pre-estimate of minimum loss for notice-period breach; confidentiality breach → actual + legal costs." Removes risk of the entire clause being struck down. |
| 12 | Misconduct → immediate termination | **Augment** | Add procedural fairness: written show-cause within X days, opportunity to respond, written termination order. |
| 13 | Deductions & recovery | **Reword** | Under **Payment of Wages Act 1936** + Code on Wages 2019, deductions are **capped at 50% of wages** and only for listed heads. Limit clause to statutory allowed heads. |
| 14 | PF / ESI compliance | **Reword** | PF: applies if establishment has ≥20 employees (EPF Act); ESI: applies if gross wages ≤ ₹21,000 and establishment ≥10. State actual applicability based on Incline's headcount/wage band; reference **Social Security Code 2020**. |
| 15 | No competition during employment | **Keep + Clarify** | Add explicit line: "Post-termination non-compete is void per **§27 Indian Contract Act**; only non-solicit and confidentiality apply after exit." Prevents the whole restraint package from being attacked. |
| 16 | Governing law / jurisdiction | **Augment** | Add dispute-resolution ladder: good-faith negotiation → mediation (Mediation Act 2023) → arbitration (sole arbitrator, seat Udaipur, Arbitration Act 1996 as amended 2021) → courts of Udaipur as supervisory. |
| 17 | Final settlement | **Keep + Augment** | Add statutory cap: F&F must be cleared within 2 working days of last working day per **Code on Wages 2019 §17**. |
| 18 | Acceptance | **Keep** | |
| Signatures | Employer + Employee | **Augment** | Add electronic-signature validity recital per **IT Act 2000 §10A + §3A & Schedule II**. |
| Witnesses | 2 witnesses | **Keep** | Capture name + phone + signature digitally. |
| Annexure A | Role-specific | **Augment** | Make mandatory: Salary Breakup, JD, Leave Policy, Commission table, **list of Policies acknowledged** with version + hash. |
| **NEW** | POSH clause | **Add** | **Sexual Harassment of Women at Workplace Act 2013** — mandatory; print IC composition + grievance email. |
| **NEW** | DPDPA 2023 | **Add** | Consent for processing personal data incl. biometric photos, MIPS face IDs, CCTV, Aadhaar last-4; purpose limitation, retention, grievance officer. |
| **NEW** | Anti-discrimination | **Add** | Equal Remuneration Act + **Transgender Persons (Protection of Rights) Act 2019**. |
| **NEW** | Background-check & medical fitness consent | **Add** | Required for trainers handling members physically. |
| **NEW** | IP assignment | **Add** | Anything created in course of employment (workout plans, content, member data work) vests in Company. |
| **NEW** | Gratuity | **Add** | Payment of Gratuity Act / SS Code — 5-year qualifying service, formula stated. |
| **NEW** | Equipment & data return on exit | **Add** | Schedule of company property; clearance form. |

Outcome: existing 18 clauses preserved, 7 new clauses added → 25-clause v2 template. All wording revised for enforceability.

---

## B. Missing employee information (one new drawer step + backfill)

Currently captured in `employees`: code, branch, dept, position, salary, salary_type, hire_date, bank name/account, is_active.

**Add and backfill:**
- Identity: father_or_spouse_name, date_of_birth, gender, blood_group, marital_status, nationality.
- Government IDs: PAN, Aadhaar last-4 (+ hash; never store full), UAN (PF), ESIC IP, driving licence (optional, trainers).
- Address: current_address (jsonb), permanent_address (jsonb), city/state/pincode.
- Contact: personal email, alt phone, emergency_contact {name, relation, phone}.
- Statutory: nominee {name, relation, share %, dob}, bank_ifsc, pf_opt_in.
- Trainer-only: certifications [{name, issuer, valid_until}], medical_fitness_declared_at.
- Captured at signing: Witness 1 & 2 (name + phone, optional OTP).

These feed the Parties block, Annexure A, and the printed PDF.

---

## C. Unified Role Policy Library (new module)

Move recurring company rules **out** of the contract body into a separate, versioned Policy Library every role acknowledges:

1. Code of Conduct
2. POSH Policy (with IC + grievance email)
3. DPDPA 2023 / Privacy & Data Handling
4. IT & Acceptable Use (CCTV, devices, member data, social posting)
5. Leave & Attendance Policy
6. Anti-Discrimination & Equal Opportunity
7. Anti-Bribery / Gifts
8. Health, Safety & Emergency (trainer scope-of-practice)
9. Confidentiality & Non-Solicitation (mirrors contract)
10. Social Media & Brand Representation

Each policy has: version, effective_date, applicable_roles, markdown body, optional PDF override. Employees re-acknowledge on version bump. Acknowledgement = typed name + checkbox + IP/UA + timestamp + SHA-256 of body version → same evidentiary stack as the contract.

---

## D. Signature flow upgrade (evidentiary-grade)

Current: typed text only, IP + UA. Weak.

**Upgrade:**
1. **Pre-flight OTP** to employee's phone (WhatsApp first, SMS fallback) via `dispatchCommunication`.
2. Scroll-to-bottom gate on terms before signing button enables.
3. **Drawn signature** on a canvas (`react-signature-canvas`) → PNG to private storage.
4. Typed name + consent checkbox (existing).
5. Optional **selfie** + **geolocation** (with consent).
6. **Witness 1 & 2** captured digitally (name + phone, optional OTP).
7. **Terms hash** — SHA-256 of the canonicalised terms is stored on `contracts.terms_hash` at issue time; `contract_signatures.terms_hash_at_sign` must match — proves the signed content is the content shown.
8. **Electronic signature recital** per IT Act §10A printed on the PDF.

---

## E. Print-ready branded PDF (server-generated, 3 copies)

Replace `window.print()` with a server-rendered PDF (`pdf-lib` in an edge function — no Chromium):

- **A4, 18 mm margins, Inter font.**
- **Header**: Incline logo + "The Incline Life by Incline" + registered address + GSTIN.
- **Footer**: page X / Y · contract id · QR code → `/verify/contract/:id` · watermark per copy: **ORIGINAL / EMPLOYEE COPY / EMPLOYER COPY**.
- Parties block uses full statutory details.
- All 25 clauses with numbered sections.
- Signature block embeds the drawn-signature PNG + typed name + signed-at IST + IP + geo.
- Witness block.
- Annexure A: Salary breakup, JD, Commission table.
- Annexure B: List of policies acknowledged with version + hash.
- Final-page "Signature & Audit Trail" panel with OTP channel, body hash, request id.

Three PDFs are stored under `contract-pdfs/{contract_id}/{copy}.pdf`; viewer downloads via signed URLs (60 s TTL via `signMemberDocument`-style helper).

A `/verify/contract/:id` public page lets anyone scan the QR and see only "this contract was signed on X by Y, hash Z" (no terms).

---

## F. Database migrations

```sql
-- Employees: statutory + identity columns
ALTER TABLE employees
  ADD COLUMN father_or_spouse_name text,
  ADD COLUMN date_of_birth date,
  ADD COLUMN gender text,
  ADD COLUMN blood_group text,
  ADD COLUMN marital_status text,
  ADD COLUMN pan_number text,
  ADD COLUMN aadhaar_last4 text,
  ADD COLUMN aadhaar_hash text,
  ADD COLUMN uan_number text,
  ADD COLUMN esic_ip_number text,
  ADD COLUMN current_address jsonb,
  ADD COLUMN permanent_address jsonb,
  ADD COLUMN emergency_contact jsonb,
  ADD COLUMN nominee jsonb,
  ADD COLUMN bank_ifsc text,
  ADD COLUMN pf_opt_in boolean DEFAULT false,
  ADD COLUMN medical_fitness_declared_at timestamptz,
  ADD COLUMN certifications jsonb;

-- Contracts: tamper-evidence + stamped artifact
ALTER TABLE contracts
  ADD COLUMN terms_version int NOT NULL DEFAULT 2,
  ADD COLUMN terms_hash text,
  ADD COLUMN stamped_pdf_path text,
  ADD COLUMN signed_pdf_hash text,
  ADD COLUMN witness_1 jsonb,
  ADD COLUMN witness_2 jsonb,
  ADD COLUMN governing_jurisdiction text DEFAULT 'Udaipur, Rajasthan',
  ADD COLUMN arbitration_seat text DEFAULT 'Udaipur',
  ADD COLUMN notice_period_days int DEFAULT 30;

-- Signatures: richer evidence
ALTER TABLE contract_signatures
  ADD COLUMN signature_image_path text,
  ADD COLUMN selfie_path text,
  ADD COLUMN geolocation jsonb,
  ADD COLUMN otp_verified boolean DEFAULT false,
  ADD COLUMN otp_channel text,
  ADD COLUMN terms_hash_at_sign text;

-- Policy module
CREATE TABLE policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  title text NOT NULL,
  version int NOT NULL DEFAULT 1,
  effective_from date NOT NULL,
  applicable_roles text[] NOT NULL,
  body_markdown text NOT NULL,
  pdf_path text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE policy_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid REFERENCES policies(id) ON DELETE CASCADE,
  policy_version int NOT NULL,
  user_id uuid NOT NULL,
  employee_id uuid REFERENCES employees(id),
  trainer_id uuid REFERENCES trainers(id),
  signed_name text NOT NULL,
  signature_image_path text,
  body_hash text NOT NULL,
  ip_address text, user_agent text, geolocation jsonb,
  acknowledged_at timestamptz DEFAULT now(),
  UNIQUE(policy_id, policy_version, user_id)
);

-- Storage buckets (all private)
INSERT INTO storage.buckets(id,name,public) VALUES
  ('contract-pdfs','contract-pdfs',false),
  ('signature-assets','signature-assets',false),
  ('policy-pdfs','policy-pdfs',false)
ON CONFLICT (id) DO NOTHING;
```

RLS: signed PDFs and signature assets are accessed only via short-TTL signed URLs through `contract-document` edge fn (re-verifies role); `policies` readable by all authenticated, write owner/admin; `policy_acknowledgements` insert/select by the user themself, full read by owner/admin/manager.

---

## G. Edge functions

1. `contract-signing` v2 (extend existing) — adds `request_otp`, validates OTP + terms_hash on `sign_contract`, uploads signature/selfie, then calls #2.
2. `generate-stamped-pdf` (new) — `pdf-lib`, renders 3 watermarked copies, stores under `contract-pdfs/`, writes `signed_pdf_hash`.
3. `policy-ack` (new) — same evidentiary stack for policy acknowledgements; optional PDF receipt.
4. `verify-contract/:id` (public read-only) — minimal verification page.

All follow project standards: CORS via `npm:@supabase/supabase-js@2/cors`, Zod validation, `// v1.0.0`, capture-edge-error wrapper, `dispatchCommunication` for OTP, never `getPublicUrl` for sensitive files.

---

## H. UI (Vuexy / shadcn — right-side Sheets only)

1. **CreateContractDrawer v2** — multi-step Sheet: Role & dates → Compensation (Basic/HRA/Special auto-split) → Policies to attach → Preview (v2 template) → Send for signature (channel + OTP toggle + expiry).
2. **Employee Statutory Details Drawer** (new) — captures Section B fields; row banner blocks contract send until complete.
3. **ContractSignPage v2** (public `/contract-sign/:token`) — OTP gate → scrollable terms → drawn-signature canvas → typed name → optional selfie + geo → witnesses → success with PDF download.
4. **SignedContractViewer v2** — replaces `window.print()` with download buttons for Original / Employee / Employer copies; signature image + evidence chips; body-hash chip.
5. **Policy Library page** (under HRM) — list, version, % coverage, "send acknowledgement campaign" action.
6. **My Documents** (in member/staff portal) — list of signed contract + acknowledged policies with download.

Visual: rounded-2xl cards, soft slate shadow, indigo/violet primary, lucide icons, sticky footer Save/Cancel, skeleton loaders, status badges.

---

## I. Roll-out order (independent, deployable per step)

1. Migrations (Section F) + storage buckets.
2. Employee Statutory Drawer + backfill banner.
3. Contract template v2 generator + `terms_hash` storage. Old contracts untouched.
4. `contract-signing` v2 + drawn-signature UI on public page.
5. `generate-stamped-pdf` + viewer download buttons.
6. `/verify/contract/:id` page.
7. Policy Library + acknowledgement flow + portal "My Documents".
8. Seed canonical Policies (POSH, DPDPA, CoC, IT, Leave, Safety) and run one-time mandatory acknowledgement campaign.

---

## J. Open questions — need answers before I write migrations

1. **Lawyer sign-off** — should a local labour-law advocate review the v2 clauses before they become default? Lawyer name + email for the "Reviewed by" line on the PDF?
2. **Employer block facts** — exact registered address, GSTIN, PAN, firm-registration number for the PDF header. (Currently only "Udaipur, Rajasthan" is hard-coded.)
3. **POSH Internal Committee** — names, designations, the external member, grievance email — legally required to print on the policy.
4. **Notice period** — confirm tiered split **Staff 30 / Trainer 60 / Manager 90** vs. current uniform 90.
5. **Penalty clause** — confirm we replace "₹50,000 or 3× client loss" with "actual damages, one-month CTC pre-estimate for notice breach" (safer & enforceable). Or keep current wording knowing it likely won't survive in court?
6. **Aadhaar** — last-4 only (recommended) vs. NSDL/UIDAI eSign integration (regulated, monthly cost)?
7. **OTP channel** — WhatsApp primary + SMS fallback? Email-only for those without phones?
8. **Witnesses** — capture digitally at signing time or keep as physical signatures on printed copy?
9. **High-res logo** — confirm storage path for the Incline logo file to embed in the PDF header.
10. **Existing signed contracts** — leave as-is or generate stamped PDFs retroactively?
11. **Languages** — English only, or also Hindi version for housekeeping/maintenance staff?
12. **PT commission** — confirm "claw-back on refund/chargeback" clause is desired.

Once you answer these (or say "use your defaults"), I'll execute the migrations first, then ship the modules in the order in Section I.
