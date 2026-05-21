/**
 * Contract Template v2 — India 2026 compliant
 *
 * Centralised, versioned generator for trainer / sales staff / manager
 * employment agreements. Keeps every clause from the original 18-clause draft
 * (preserved verbatim where legally sound) and rewords the ones that risked
 * unenforceability under Indian law (Section 27 + 74 ICA, Code on Wages 2019,
 * Payment of Wages Act, Specific Relief Act). Adds 7 new mandatory clauses
 * (POSH, DPDPA, anti-discrimination, background check, IP assignment,
 * gratuity, equipment return).
 *
 * The output is canonical (deterministic for given inputs) so the SHA-256
 * hash stored on `contracts.terms_hash` can be re-derived and matched against
 * `contract_signatures.terms_hash_at_sign` to prove tamper-evidence.
 */

export const CONTRACT_TEMPLATE_VERSION = 2;

export type AgreementRole = 'trainer' | 'staff' | 'manager';

export interface EmployerBlock {
  legalName: string;
  proprietorName: string;
  registeredAddress: string;
  gstin?: string | null;
  pan?: string | null;
  firmRegistrationNo?: string | null;
}

export interface EmployeeBlock {
  fullName: string;
  fatherOrSpouse?: string | null;
  dob?: string | null;
  gender?: string | null;
  pan?: string | null;
  aadhaarLast4?: string | null;
  email?: string | null;
  phone?: string | null;
  employeeCode?: string | null;
  position?: string | null;
  department?: string | null;
  currentAddress?: string | null;
  branchName?: string | null;
}

export interface CompensationBlock {
  ctcMonthly: number;
  basicMonthly?: number | null;     // ≥ 50% of CTC per Code on Wages 2019
  hraMonthly?: number | null;
  specialMonthly?: number | null;
  commissionPct?: number | null;    // trainers
}

export interface PolicyBlock {
  noticePeriodDays: number;
  arbitrationSeat: string;
  governingJurisdiction: string;
  weeklyHourCap: number;
  dailyHourCap: number;
  otMultiplier: number;
  ptCommissionClawback: boolean;
  poshIc?: {
    presiding_officer?: string;
    members?: string[];
    external_member?: string;
    grievance_email?: string;
  } | null;
}

export interface GenerateInput {
  role: AgreementRole;
  startDate: string;       // YYYY-MM-DD
  endDate?: string | null;
  employer: EmployerBlock;
  employee: EmployeeBlock;
  comp: CompensationBlock;
  policy: PolicyBlock;
}

function fmtINR(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '________';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '__/__/____';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
}

function tick(role: AgreementRole, target: AgreementRole): string {
  return role === target ? '☑' : '☐';
}

function poshBlock(ic: PolicyBlock['poshIc']): string {
  if (!ic || (!ic.presiding_officer && !ic.grievance_email)) {
    return 'The Internal Committee (IC) composition is published in the POSH Policy (Annexure C). Grievances may be raised to the IC at the email notified in the workplace POSH notice.';
  }
  const members = (ic.members || []).filter(Boolean).join(', ');
  return [
    ic.presiding_officer ? `Presiding Officer: ${ic.presiding_officer}` : null,
    members ? `Members: ${members}` : null,
    ic.external_member ? `External Member: ${ic.external_member}` : null,
    ic.grievance_email ? `Grievance Email: ${ic.grievance_email}` : null,
  ].filter(Boolean).join('\n');
}

export function generateContractV2(input: GenerateInput): string {
  const { role, startDate, endDate, employer, employee, comp, policy } = input;

  const basic = comp.basicMonthly ?? Math.round(comp.ctcMonthly * 0.5);
  const positionLabel = employee.position || (role === 'trainer' ? 'Fitness Trainer' : role === 'manager' ? 'Manager' : 'Sales Executive');

  return `# EMPLOYMENT AGREEMENT
Template version ${CONTRACT_TEMPLATE_VERSION} · India 2026 compliant

This Employment Agreement ("Agreement") is executed on ${fmtDate(startDate)} at ${employer.registeredAddress || 'Udaipur, Rajasthan'}.

## BETWEEN

${employer.legalName}
Owned and operated by Ms. ${employer.proprietorName}
Registered office: ${employer.registeredAddress || '__________________'}
${employer.gstin ? `GSTIN: ${employer.gstin}` : ''}
${employer.pan ? `PAN: ${employer.pan}` : ''}
${employer.firmRegistrationNo ? `Firm Registration No.: ${employer.firmRegistrationNo}` : ''}
(hereinafter referred to as the "Employer" or "Company")

## AND

Mr./Ms. ${employee.fullName}
S/o / D/o ${employee.fatherOrSpouse || '__________________'}
Date of Birth: ${employee.dob ? fmtDate(employee.dob) : '__/__/____'}
Gender: ${employee.gender || '____'}
PAN: ${employee.pan || '__________'}
Aadhaar (last 4): ${employee.aadhaarLast4 ? 'XXXX-XXXX-' + employee.aadhaarLast4 : 'XXXX-XXXX-____'}
Phone: ${employee.phone || '__________'}
Email: ${employee.email || '__________'}
Residential address: ${employee.currentAddress || '__________________'}
Employee Code: ${employee.employeeCode || '____'}
Position: ${positionLabel}
Department: ${employee.department || '____'}
(hereinafter referred to as the "Employee")

---

## 1. APPOINTMENT

The Employee is hereby appointed as:

[${tick(role, 'trainer')}] Fitness Trainer
[${tick(role, 'staff')}] Sales Executive
[${tick(role, 'manager')}] Manager

Place of work: ${employee.branchName || 'Incline, Udaipur'}. The Employer reserves the right, on reasonable notice, to transfer the Employee to any other branch of Incline.

The Employee agrees to faithfully perform duties assigned by the Employer.

---

## 2. COMMENCEMENT, PROBATION & NATURE OF EMPLOYMENT

* Employment start date: ${fmtDate(startDate)}${endDate ? `\n* Fixed term ending: ${fmtDate(endDate)}` : ''}
* Probation: 3 (three) months from the start date, extendable once by up to 3 months at the Employer's discretion. Confirmation in writing.
* This is a private employment contract governed by mutually agreed terms.
* This does not create permanent employment unless expressly confirmed in writing.

---

## 3. JOB RESPONSIBILITIES

### A. FITNESS TRAINER
* Conduct personal training sessions in line with the certifications declared.
* Maintain client progress records and respect the trainer scope-of-practice (no medical diagnosis or prescription; CPR/AED readiness required).
* Ensure safety and hygiene on the floor and during PT sessions.
* Promote personal training packages.

### B. SALES STAFF
* Handle walk-ins, conversions, and follow-ups.
* Achieve monthly sales targets communicated in writing.
* Maintain CRM / lead data confidentiality at all times.

### C. MANAGER
* Oversee operations, staff, and revenue at the assigned branch.
* Ensure discipline and service quality.
* Report directly to the Proprietor or her nominee.

---

## 4. WORKING HOURS & WEEKLY OFF

* As per the shift roster published by the Employer.
* Maximum ${policy.dailyHourCap} hours per day and ${policy.weeklyHourCap} hours per week, in line with the Rajasthan Shops & Commercial Establishments Act and the Code on Wages 2019.
* Overtime, when authorised in writing, is payable at ${policy.otMultiplier.toFixed(1)}× the ordinary wage rate per the Code on Wages 2019.
* One paid weekly off per week. The Employer may rotate the day of weekly off on reasonable notice.

---

## 5. SALARY & COMPENSATION

* Cost to Company (CTC): ${fmtINR(comp.ctcMonthly)} per month.
* Statutory wage structure (Code on Wages 2019 — Basic ≥ 50% of CTC):
  - Basic: ${fmtINR(basic)}
  - HRA: ${fmtINR(comp.hraMonthly ?? Math.round(basic * 0.4))}
  - Special allowance: ${fmtINR(comp.specialMonthly ?? Math.round(comp.ctcMonthly - basic - (comp.hraMonthly ?? basic * 0.4)))}
* Salary is payable on or before the 7th of the following month (statutory).
* All statutory deductions (PF, ESI, Professional Tax, TDS) are applied as per applicable law and the prevailing Social Security Code 2020 thresholds.
* Annexure A contains the detailed salary breakup and incentive plan.

### PERSONAL TRAINING (PT) COMMISSION — APPLICABLE TO TRAINERS
* Commission is paid on Personal Training revenue (pre-GST amount only).
* Commission percentage: ${comp.commissionPct != null ? comp.commissionPct + '%' : '____%'}
* Paid only after full payment is received and realised from the client.
${policy.ptCommissionClawback ? '* Claw-back: if a client is refunded, or a chargeback succeeds, the corresponding commission stands reversed in the next payroll cycle.' : ''}

---

## 6. LEAVE & ABSENTEEISM

* Leave entitlement is as per the Rajasthan Shops & Establishments Act (Casual, Sick and Earned Leave) and the Company Leave Policy (Annexure C — Policy List). All leaves must be pre-approved through the HR system.
* Maternity leave: 26 weeks for eligible employees per the Maternity Benefit Act, 1961 (as amended).
* Paternity / bereavement leave as per the Leave Policy.
* Unapproved absence will be treated as Loss of Pay on a pro-rata basis.
* Continuous unauthorised absence of 3 (three) working days may be treated as voluntary abandonment after written notice.

---

## 7. NOTICE PERIOD ON RESIGNATION

* The Employee shall serve ${policy.noticePeriodDays} (${policy.noticePeriodDays === 30 ? 'thirty' : policy.noticePeriodDays === 60 ? 'sixty' : policy.noticePeriodDays === 90 ? 'ninety' : ''}) days written notice on resignation, or pay salary in lieu of the un-served portion at the Employer's option.
* The Employer may, at its sole discretion, waive part or whole of the notice period.

---

## 8. TERMINATION BY EMPLOYER

* Termination without cause: on payment of notice period salary or by giving the equivalent written notice.
* Termination for cause (misconduct under Clause 12 below): after a written show-cause notice, opportunity to respond within 7 (seven) days, and a written termination order based on the inquiry findings. This procedure is followed in line with principles of natural justice and Indian labour jurisprudence.

---

## 9. CONFIDENTIALITY

The Employee shall not, during employment or thereafter, disclose, use or commercialise:
* Client database, contact details, or member health information;
* Pricing, offers, marketing strategy, supplier terms;
* Business operations, financials, or any internal matter.

This clause survives termination indefinitely.

---

## 10. NON-SOLICITATION

During employment and for 12 (twelve) months after the date of leaving, the Employee shall not, directly or indirectly:
* Contact or solicit any client of Incline for competing services;
* Offer training / fitness / recovery services to existing or past clients of Incline;
* Induce, persuade or attempt to persuade any staff or trainer of Incline to leave.

---

## 11. REMEDIES FOR BREACH (Section 74 ICA-compliant)

In the event of breach of Clause 9 (Confidentiality) or Clause 10 (Non-Solicitation), or short-service of notice under Clause 7:

* The Employer is entitled to recover **actual damages proved**, together with reasonable legal costs, in accordance with Section 74 of the Indian Contract Act, 1872.
* The parties agree, by way of pre-estimate of minimum loss for short-service of notice, an amount equal to **one (1) month's CTC**, without prejudice to the Employer's right to claim higher actual damages.
* The Employer reserves the right to seek injunctive relief from the competent courts.

---

## 12. MISCONDUCT

The following may constitute grounds for termination for cause under Clause 8:
* Verbal or physical misbehaviour with clients, colleagues or vendors;
* Theft, fraud, falsification of records, or dishonesty;
* Sleeping on duty, gross negligence, or endangering member safety;
* Sexual harassment or any indiscipline (see Clause 14 — POSH);
* Unauthorised absence under Clause 6;
* Working with a competing gym / fitness business during employment (Clause 15);
* Breach of confidentiality (Clause 9) or non-solicit (Clause 10).

---

## 13. DEDUCTIONS & RECOVERY

The Employer may deduct from salary or full-and-final settlement only those amounts permitted by the Payment of Wages Act, 1936 and the Code on Wages 2019, including:
* Statutory deductions (PF, ESI, PT, TDS);
* Notice-period shortfall under Clause 7;
* Loss directly attributable to the Employee's wilful default or negligence, after due inquiry;
* Recovery of advances and unreturned company property or uniform.

Total deductions in any wage period shall not exceed the statutory cap of 50% of wages.

---

## 14. PREVENTION OF SEXUAL HARASSMENT (POSH)

Incline maintains a zero-tolerance policy on sexual harassment in line with the Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013.

${poshBlock(policy.poshIc)}

Detailed procedure is set out in the POSH Policy (Annexure C).

---

## 15. DATA PROTECTION & PRIVACY (DPDPA 2023)

The Employee consents to the Employer processing the Employee's personal data — including identity proof details, salary information, biometric face data, CCTV footage, attendance logs and contact information — for purposes connected with employment, payroll, statutory compliance and access control, in line with the Digital Personal Data Protection Act, 2023. Retention, withdrawal of consent and grievance redressal are described in the Privacy & Data Handling Policy (Annexure C).

---

## 16. EQUAL OPPORTUNITY & NON-DISCRIMINATION

The Employer is an equal opportunity employer. There shall be no discrimination on grounds of gender, caste, religion, disability, gender identity or sexual orientation, in line with the Equal Remuneration Act, 1976, the Rights of Persons with Disabilities Act, 2016, and the Transgender Persons (Protection of Rights) Act, 2019.

---

## 17. BACKGROUND CHECK & MEDICAL FITNESS

The Employee consents to:
* Verification of educational, certification, address and prior employment records;
* A self-declaration of medical fitness to perform the duties of the role; trainers additionally undertake to maintain valid first-aid / CPR certification at all times.

---

## 18. INTELLECTUAL PROPERTY

All work product created by the Employee in the course of employment — including workout plans, content, photographs, videos, member-data analytics and process documentation — vests exclusively in the Employer. The Employee assigns all such rights to the Employer.

---

## 19. NO COMPETITION DURING EMPLOYMENT

During the subsistence of this Agreement the Employee shall not, without the prior written permission of the Employer:
* Take up employment or engagement with any other gym, studio, fitness or recovery centre;
* Run an independent personal-training, coaching or fitness business.

The parties record that any **post-termination** non-compete restraint is void under Section 27 of the Indian Contract Act, 1872. Only the confidentiality (Clause 9) and non-solicitation (Clause 10) restraints survive termination.

---

## 20. PROVIDENT FUND, ESI & GRATUITY

* Provident Fund (EPF Act / Social Security Code 2020) is deducted and contributed where the establishment crosses the statutory threshold of 20 covered employees, or earlier if the Employee voluntarily opts in.
* Employees' State Insurance (ESI) is deducted where gross wages are within the statutory ceiling (currently ₹21,000) and the establishment is covered.
* Gratuity under the Payment of Gratuity Act, 1972 (as amended by the Social Security Code 2020) is payable on completion of the qualifying service of five years (subject to the reduced threshold introduced under the SS Code where applicable).

---

## 21. FULL & FINAL SETTLEMENT

Full and final settlement will be processed within 2 (two) working days of the last working day in line with Section 17 of the Code on Wages 2019, subject to:
* Clearance of all dues by the Employee;
* Return of company property (Annexure D — Asset Return Form);
* Completion of notice-period obligations under Clause 7.

---

## 22. DISPUTE RESOLUTION

Step 1 — Good-faith negotiation between the parties for 30 days.
Step 2 — Mediation under the Mediation Act, 2023.
Step 3 — Arbitration by a sole arbitrator under the Arbitration and Conciliation Act, 1996 (as amended in 2021). Seat of arbitration: ${policy.arbitrationSeat}. Language: English.
Step 4 — Subject to the above, the courts at ${policy.governingJurisdiction} have exclusive supervisory jurisdiction.

This Agreement is governed by the laws of India.

---

## 23. ELECTRONIC EXECUTION

The parties consent to executing this Agreement electronically. The electronic signature applied by the Employee through the Incline Document Vault, together with the audit trail captured (OTP verification, drawn signature image, IP address, geo-location and SHA-256 hash of the signed terms), is a valid and enforceable electronic signature under Section 10A read with Section 3A of the Information Technology Act, 2000 and the rules thereunder.

---

## 24. ENTIRE AGREEMENT, SEVERABILITY, AMENDMENT

This Agreement, together with all Annexures and the Policies listed in Annexure C, constitutes the entire understanding between the parties. Any unenforceable provision shall be severed without affecting the remainder. Amendments are valid only when in writing and signed by both parties (electronically or otherwise).

---

## 25. ACCEPTANCE

The Employee confirms:
* They have read and understood every term of this Agreement;
* They have had a fair opportunity to clarify any clause before signing;
* They agree to be bound voluntarily, without coercion.

---

## SIGNATURES

For ${employer.legalName} (Proprietor: ${employer.proprietorName})

Signature: ____________________
Name: ${employer.proprietorName}
Date: ${fmtDate(startDate)}

---

Employee

Signature: (electronic — captured at signing)
Name: ${employee.fullName}
Date: (captured at signing)

---

## WITNESSES

Witness 1
Name: ____________________
Phone: ____________________
Signature: ____________________

Witness 2
Name: ____________________
Phone: ____________________
Signature: ____________________

---

## ANNEXURES

* Annexure A — Salary Breakup & Incentive Plan
* Annexure B — Detailed Job Description
* Annexure C — Policies acknowledged with version and hash
* Annexure D — Company Property / Asset Return Form

---`;
}

/**
 * Canonicalise the terms before hashing so that whitespace / line-ending
 * differences do not change the hash. Same algorithm runs server-side.
 */
export function canonicaliseTerms(terms: string): string {
  return terms.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim() + '\n';
}

/** Browser-side SHA-256 (hex). */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
