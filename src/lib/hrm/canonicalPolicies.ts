/**
 * Canonical Policy Library — seed bodies for the unified-role policies.
 * Each policy has a stable `code` so versions can supersede each other.
 * Bodies are markdown; admin can edit per-branch via Settings → Policies.
 */

export type PolicyRole = 'owner' | 'admin' | 'manager' | 'staff' | 'trainer';

export interface PolicySeed {
  code: string;
  title: string;
  applicable_roles: PolicyRole[];
  body_markdown: string;
}

export const CANONICAL_POLICIES: PolicySeed[] = [
  {
    code: 'code_of_conduct',
    title: 'Code of Conduct',
    applicable_roles: ['owner', 'admin', 'manager', 'staff', 'trainer'],
    body_markdown: `# Code of Conduct

Incline expects every team member to:
1. Treat members, colleagues and vendors with respect and dignity.
2. Be punctual, in uniform, and prepared for every shift.
3. Maintain a professional appearance on the floor and on member-facing communication.
4. Avoid conflicts of interest. Disclose any side engagement in writing.
5. Never accept gifts or kickbacks beyond a nominal value (₹500) from members or vendors.
6. Use member data only for the purpose for which it was collected.
7. Report any breach of this code to the Manager or Proprietor immediately.

Violations may result in counselling, written warning, or termination for cause under Clause 8 of the Employment Agreement.
`,
  },
  {
    code: 'posh',
    title: 'POSH — Prevention of Sexual Harassment Policy',
    applicable_roles: ['owner', 'admin', 'manager', 'staff', 'trainer'],
    body_markdown: `# POSH Policy

Incline has zero tolerance for sexual harassment at the workplace, in line with the Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013.

## What constitutes sexual harassment
- Unwelcome physical contact or advances.
- Demand or request for sexual favours.
- Sexually coloured remarks, showing pornography, any other unwelcome physical, verbal or non-verbal conduct of a sexual nature.

## How to raise a complaint
1. A written complaint may be filed with any member of the Internal Committee (IC) within 3 months of the incident.
2. The IC composition is published at the workplace and on the intranet. The grievance email is notified separately.
3. The IC will complete the inquiry within 90 days. Confidentiality is maintained throughout.
4. Retaliation against a complainant is itself a disciplinary offence.

## Awareness
Annual training is mandatory for every employee. Posters are displayed at every branch reception.
`,
  },
  {
    code: 'dpdpa_privacy',
    title: 'Privacy & Data Handling Policy (DPDPA 2023)',
    applicable_roles: ['owner', 'admin', 'manager', 'staff', 'trainer'],
    body_markdown: `# Privacy & Data Handling Policy

Incline processes personal data of members, employees and prospects in line with the Digital Personal Data Protection Act, 2023.

## What we collect
- Identity & contact: name, photo, phone, email, address.
- Government IDs: PAN, Aadhaar last 4 digits (full Aadhaar is never stored).
- Biometric: face data used only for turnstile access via the MIPS access system.
- Health & fitness: scan reports, measurements, attendance.
- CCTV footage for safety and dispute resolution.

## How we use it
- Service delivery, billing, communication, statutory compliance, fraud prevention.
- Data is never sold to third parties.
- Marketing communication only with explicit consent and a one-click opt-out.

## Employee obligations
- Access member data only on a need-to-know basis.
- Never share, screenshot, or export member data outside official systems.
- Report any suspected breach to the Data Protection Officer within 24 hours.

## Rights & retention
- Members and employees may withdraw consent, request a copy, or seek deletion (subject to statutory retention).
- Grievance redressal contact: published in the in-app help centre.
`,
  },
  {
    code: 'it_acceptable_use',
    title: 'IT & Acceptable Use Policy',
    applicable_roles: ['owner', 'admin', 'manager', 'staff', 'trainer'],
    body_markdown: `# IT & Acceptable Use Policy

1. Company devices, WiFi and SaaS accounts may be used only for work.
2. Never share login credentials. Use only the assigned user account.
3. Member chats, photos, and reports must not be downloaded to personal devices.
4. CCTV footage is restricted to the Manager and above for investigation.
5. Posting member photos on social media requires the member's written consent.
6. Loss or theft of any company device must be reported immediately.
`,
  },
  {
    code: 'leave_attendance',
    title: 'Leave & Attendance Policy',
    applicable_roles: ['owner', 'admin', 'manager', 'staff', 'trainer'],
    body_markdown: `# Leave & Attendance Policy

## Leave types (per Rajasthan Shops & Establishments Act + Company)
- Casual Leave (CL): 7 days per year, accrued monthly.
- Sick Leave (SL): 7 days per year, supported by medical certificate beyond 2 consecutive days.
- Earned Leave (EL): 15 days per year, carry-forward up to 30 days.
- Maternity Leave: 26 weeks per Maternity Benefit Act, 1961.
- Paternity Leave: 5 days within 6 months of childbirth.
- Bereavement Leave: 3 days for immediate family.

## Process
1. All leave must be applied in advance through the HR portal and approved by the reporting Manager.
2. Sick leave applied within 24 hours of resuming duty with proof.
3. Continuous unauthorised absence of 3 working days may be treated as voluntary abandonment after written notice.
4. Attendance is captured via biometric / turnstile. Manual punches require Manager approval.
`,
  },
  {
    code: 'anti_discrimination',
    title: 'Anti-Discrimination & Equal Opportunity Policy',
    applicable_roles: ['owner', 'admin', 'manager', 'staff', 'trainer'],
    body_markdown: `# Anti-Discrimination & Equal Opportunity Policy

Incline is an equal opportunity employer. We do not discriminate on grounds of gender, caste, religion, region, disability, gender identity or sexual orientation in hiring, compensation, promotion, training or termination.

Specific protections apply under:
- Equal Remuneration Act, 1976.
- Rights of Persons with Disabilities Act, 2016.
- Transgender Persons (Protection of Rights) Act, 2019.

Members and employees experiencing discrimination may raise a complaint to the Manager or directly to the Proprietor. Retaliation is itself a disciplinary offence.
`,
  },
  {
    code: 'anti_bribery',
    title: 'Anti-Bribery & Gifts Policy',
    applicable_roles: ['owner', 'admin', 'manager', 'staff', 'trainer'],
    body_markdown: `# Anti-Bribery & Gifts Policy

1. No employee may give or receive bribes, kickbacks, or any improper payment in connection with Incline's business.
2. Gifts from members or vendors are limited to a nominal value of ₹500 and must be declared to the Manager.
3. Personal-training tips received from members are taxable income and must be declared in the trainer's payroll record.
4. Reciprocal arrangements (free PT in exchange for personal favours) are prohibited.
`,
  },
  {
    code: 'health_safety',
    title: 'Health, Safety & Emergency Policy',
    applicable_roles: ['owner', 'admin', 'manager', 'staff', 'trainer'],
    body_markdown: `# Health, Safety & Emergency Policy

1. Trainers must hold a valid first-aid / CPR certification at all times.
2. Trainers operate within their scope of practice and do not provide medical diagnosis or prescription.
3. Equipment must be checked daily before opening; any defect is logged and the equipment is taken offline.
4. Saunas, ice baths and recovery rooms are operated only when staff are present.
5. AED location, fire exits and the emergency contact list are visible at every branch reception.
6. Any member injury is documented in the Incident Register and reported to the Manager within 1 hour.
`,
  },
  {
    code: 'confidentiality_nonsolicit',
    title: 'Confidentiality & Non-Solicitation Policy',
    applicable_roles: ['owner', 'admin', 'manager', 'staff', 'trainer'],
    body_markdown: `# Confidentiality & Non-Solicitation Policy

Mirrors clauses 9 and 10 of the Employment Agreement.

1. Member data, pricing, marketing strategy and supplier terms are confidential. The duty survives termination.
2. During employment and for 12 months after exit, an employee shall not contact Incline's members for competing services or induce other staff to leave.
3. Post-employment non-compete (i.e. preventing the employee from working in any gym) is void under Section 27 of the Indian Contract Act, 1872. Only confidentiality and non-solicit apply after exit.
`,
  },
  {
    code: 'social_media',
    title: 'Social Media & Brand Representation Policy',
    applicable_roles: ['owner', 'admin', 'manager', 'staff', 'trainer'],
    body_markdown: `# Social Media & Brand Representation Policy

1. Only the Marketing team may post on Incline's official handles.
2. Personal accounts may reshare official posts. Original posts about Incline (transformations, classes, members) must be approved by the Manager and use the member's written consent.
3. Do not post photos of the floor, other staff, or members without consent.
4. Negative comments about Incline, members or co-workers on public social media are a disciplinary offence.
5. Use the hashtag #TheInclineLife only for approved content.
`,
  },
];
