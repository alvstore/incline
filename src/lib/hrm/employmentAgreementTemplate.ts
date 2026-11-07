// Single source of the Incline employment agreement text. Kept outside the
// drawer so it can be unit-tested and reused (role-only duties, notice days,
// code of conduct). Legal phrasing follows Indian law (Contract Act, Code on
// Wages 2019, Code on Social Security 2020, POSH 2013, DPDP 2023).

export type AgreementRole = 'trainer' | 'staff' | 'manager';

export type EmployeePrefill = {
  employeeCode?: string;
  email?: string;
  phone?: string;
  position?: string;
  department?: string;
};

export const DEFAULT_NOTICE_DAYS: Record<AgreementRole, number> = { staff: 30, trainer: 60, manager: 90 };

const ONES = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const TENS = ['', '', 'twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
export function numberToWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n);
  n = Math.floor(n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + numberToWords(n % 100) : '');
  return String(n);
}
export function noticePhrase(days: number): string {
  const d = Number.isFinite(days) && days > 0 ? Math.round(days) : 30;
  return `${d} (${numberToWords(d)}) days`;
}

const ROLE_TITLE: Record<AgreementRole, string> = {
  trainer: 'Fitness Trainer',
  staff: 'Sales Executive',
  manager: 'Manager',
};

const ROLE_RESPONSIBILITIES: Record<AgreementRole, string> = {
  trainer: `### FITNESS TRAINER

* Conduct personal training and floor sessions safely and on time
* Design and update client workout programs
* Log every PT session and client progress in the Incline app
* Ensure safety, hygiene and correct equipment use on the floor
* Promote Incline personal training packages through official billing only`,
  staff: `### SALES EXECUTIVE

* Handle walk-ins, tours, conversions, and follow-ups
* Achieve monthly sales targets
* Maintain CRM / lead data accurately and confidentially
* Collect payments only through Incline's official billing`,
  manager: `### MANAGER

* Oversee operations, staff, and revenue
* Ensure discipline and service quality
* Ensure all payments are billed and deposited through official channels
* Report directly to Proprietor`,
};

const CODE_OF_CONDUCT: Record<AgreementRole, string> = {
  trainer: `* **No private / under-the-table PT:** The Employee shall not provide personal training, diet plans or coaching to any member, ex-member or prospect of Incline outside Incline's billed packages, whether inside or outside the premises. Any money received directly from a client shall be treated as Incline's money and is recoverable in full.
* **No outside supplements:** The Employee shall not sell, supply, or recommend buying protein, pre-workout or any other supplement, drug or substance bought from the market. Only products sold through Incline's own store may be suggested. Supplying banned or unsafe substances will lead to immediate termination and may be reported to the authorities.
* **No money borrowing or lending:** The Employee shall not borrow money from, lend money to, or have any personal financial dealings with members, leads, vendors or co-workers. Salary advances are available only through Incline's official advance process.`,
  staff: `* **No private / under-the-table dealings:** The Employee shall not arrange or collect money for personal training, memberships or any service outside Incline's official billing. Any money received directly shall be treated as Incline's money and is recoverable in full.
* **No outside supplements:** The Employee shall not sell, supply, or recommend buying protein or any other supplement, drug or substance bought from the market. Only products sold through Incline's own store may be offered.
* **No money borrowing or lending:** The Employee shall not borrow money from, lend money to, or have any personal financial dealings with members, leads, vendors or co-workers. Salary advances are available only through Incline's official advance process.`,
  manager: `* **No private / under-the-table dealings:** The Employee shall not permit, arrange or collect money for personal training or any service outside Incline's official billing, and shall report any such activity by staff immediately.
* **No outside supplements:** The Employee shall not sell, supply or recommend buying supplements, drugs or substances bought from the market, and shall stop staff from doing so.
* **No money borrowing or lending:** The Employee shall not borrow money from, lend money to, or have any personal financial dealings with members, leads, vendors or staff. Salary advances are available only through Incline's official advance process.`,
};

export function formatExecutionDate(dateValue: string): string {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return dateValue;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
}

export function getEmploymentAgreementTemplate(
  role: AgreementRole,
  employeeName: string,
  salary: number,
  startDate: string,
  prefill?: EmployeePrefill,
  commissionPercentage: number = 0,
  noticeDays: number = DEFAULT_NOTICE_DAYS[role],
) {
  const notice = noticePhrase(noticeDays);
  const isTrainer = role === 'trainer';
  const fixedSalary = Number.isFinite(salary) && salary > 0 ? Math.round(salary).toLocaleString('en-IN') : '________';
  const commissionLine = Number.isFinite(commissionPercentage) && commissionPercentage > 0
    ? `${commissionPercentage}%`
    : '[to be agreed in Annexure A]';
  const ptCommissionBlock = isTrainer
    ? `\n### PERSONAL TRAINING (PT) COMMISSION - APPLICABLE TO TRAINERS\n\n* Commission shall be paid on Personal Training revenue (pre-GST amount only)\n* Commission %: ${commissionLine}\n* Paid only after full payment is received from client\n`
    : '';
  const executionDate = formatExecutionDate(startDate);
  const companyAddress = 'Udaipur, Rajasthan';
  const employeeCode = prefill?.employeeCode;
  const email = prefill?.email;
  const phone = prefill?.phone;
  const position = prefill?.position || (role === 'trainer' ? 'Trainer' : role === 'manager' ? 'Manager' : 'Staff');
  const department = prefill?.department || (role === 'trainer' ? 'Training' : role === 'manager' ? 'Management' : 'Operations');

  // Build the "AND" (employee) block conditionally — missing fields show a
  // clear "[Pending — to be filled by employee]" marker instead of underscores
  // so the document never looks like a stamp-paper template with blanks.
  const PENDING = '[Pending — to be filled by employee before signing]';
  const employeeLines: string[] = [];
  employeeLines.push(`Mr./Ms. ${employeeName && !employeeName.startsWith('___') ? employeeName : PENDING}`);
  if (employeeCode) employeeLines.push(`Employee Code: ${employeeCode}`);
  if (email)        employeeLines.push(`Email: ${email}`);
  if (phone)        employeeLines.push(`Phone: ${phone}`);
  employeeLines.push(`Position: ${position}`);
  employeeLines.push(`Department: ${department}`);
  // S/o / D/o + Residing at come from the Contract Fill page (contract_variables).
  // The PDF builder renders them in the "Personal Details (provided by employee)"
  // section appended below — point to it cleanly without the "Filled details" stub
  // or any underscore placeholders.
  employeeLines.push(`Personal details (parentage, residential address, emergency contact, ID) — provided by the Employee via the secure fill link and listed in the "Personal Details" section of this Agreement.`);
  employeeLines.push(`(hereinafter referred to as the "Employee")`);

  return `# EMPLOYMENT AGREEMENT

This Employment Agreement ("Agreement") is executed on ${executionDate} at Udaipur, Rajasthan.

## BETWEEN

Incline (Proprietorship Firm)
Owned and operated by Ms. Yogita Lekhari,
Having its principal place of business at: ${companyAddress}
(hereinafter referred to as the "Employer" or "Company")

## AND

${employeeLines.join('\n')}

---

## 1. APPOINTMENT

The Employee is hereby appointed as:

**${ROLE_TITLE[role]}**

The Employee agrees to faithfully perform duties assigned by the Employer.

---

## 2. COMMENCEMENT & NATURE OF EMPLOYMENT

* Employment start date: ${startDate || '**/**/20__'}
* This is a private employment contract governed by mutually agreed terms.
* This does not create permanent employment unless specified.

---

## 3. JOB RESPONSIBILITIES

${ROLE_RESPONSIBILITIES[role]}

---

## 4. WORKING HOURS

* As per shift assigned by Employer
* Employer reserves full right to change shifts and weekly offs

---

## 5. SALARY & COMPENSATION

* Fixed Salary: Rs. ${fixedSalary} per month
* Payment cycle: Monthly
${ptCommissionBlock}

---

## 6. LEAVE & ABSENTEEISM

* Leaves must be pre-approved
* Any unapproved leave shall result in full salary deduction (pro-rata basis)
* Excess leaves beyond allowed limits shall be unpaid
* Continuous absence of 3 days without notice may be treated as abandonment

---

## 7. NOTICE PERIOD (EXIT BY EITHER PARTY)

* Either party may end this employment by giving ${notice} written notice
* The Employer may pay salary in lieu of the notice period (or the unserved part of it)
* If the Employee leaves without serving the full notice, salary for the unserved notice days may be adjusted from the final settlement, as permitted under the Code on Wages, 2019

---

## 8. TERMINATION BY EMPLOYER

* Employer reserves absolute right to terminate employment at any time, with or without reason
* Termination may be:
  * Immediate, or
  * With notice/pay (at Employer's discretion)

---

## 9. CONFIDENTIALITY

Employee shall not disclose:

* Client database and member personal data (to be handled only as permitted under the Digital Personal Data Protection Act, 2023)
* Pricing, offers, or strategy
* Business operations or internal matters

This clause survives termination.

---

## 10. NON-SOLICITATION (CRITICAL CLAUSE)

Employee agrees that during employment and for 12 months after leaving, they shall not:

* Contact or solicit any client of Incline
* Offer training/services to existing or past clients of Incline
* Induce any staff to leave

---

## 11. PENALTY CLAUSE (CLIENT POACHING & BREACH)

In case of breach of Clause 9 or 10:

* Employee shall be liable to pay reasonable compensation for the loss actually caused to the Employer (Section 74, Indian Contract Act, 1872), which the parties pre-estimate at Rs. 50,000 or 3x the value of client business lost, whichever is higher
* Employer reserves right to initiate legal recovery

---

## 11A. CODE OF CONDUCT (BINDING)

${CODE_OF_CONDUCT[role]}

Any breach of this clause is misconduct under Clause 12 and may lead to termination after a fair opportunity to explain, along with recovery under Clause 13.

---

## 12. MISCONDUCT

Termination without notice, after a fair opportunity to explain, in case of:

* Misbehavior with clients
* Theft, fraud, or dishonesty
* Sleeping on duty / negligence
* Sexual harassment (as defined under the POSH Act, 2013), any harassment or indiscipline
* Unauthorized absence
* Working with competitors

---

## 13. DEDUCTIONS & RECOVERY

Only deductions permitted under the Code on Wages, 2019 shall be made, after written intimation to the Employee, and never so as to reduce wages below the statutory minimum:

* Unserved notice period (Clause 7)
* Proven loss or damage caused by the Employee's negligence or default
* Uniform / equipment not returned
* Money collected from clients and not deposited with the Employer
* Outstanding salary advances

---

## 14. PF / ESI COMPLIANCE

* As per current salary structure (Rs. 10,000-Rs. 15,000 range):
  * PF applicability may not be mandatory unless opted
  * ESI applicability depends on eligibility thresholds
* Coverage is governed by the Code on Social Security, 2020
* If Employee becomes eligible under law:
  * PF/ESI shall be deducted as per statutory norms
  * Employer shall comply accordingly

---

## 15. NO COMPETITION DURING EMPLOYMENT

Employee shall not:

* Work in any other gym/fitness center
* Run personal training business independently
  Without written permission. This restriction applies only during employment (Section 27, Indian Contract Act, 1872); post-exit obligations are limited to Clauses 9 and 10.

---

## 16. GOVERNING LAW & JURISDICTION

* This Agreement is governed by laws of India
* Jurisdiction: Courts of Udaipur, Rajasthan

---

## 17. FINAL SETTLEMENT CONDITION

* Full & final settlement will be processed only after:
  * Clearance of dues
  * Return of company property
  * Completion of notice obligations

---

## 18. ACCEPTANCE

Employee confirms:

* They have read and understood all terms
* They agree voluntarily without coercion

---

## ANNEXURE A (ROLE-SPECIFIC DETAILS)

(To be attached separately if needed)

* Salary Breakdown
* Commission Structure
* Incentive Plans
* Leave Policy Details

---`;
}

