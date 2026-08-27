/**
 * INCLINE MEMBERSHIP REGISTRATION & AGREEMENT — single source of truth.
 *
 * ONE document, ONE signature, ONE stored PDF. There is no separate
 * registration form, waiver, terms sheet, health declaration, PAR-Q form or
 * consent form — every one of those is a Part of this agreement.
 *
 * Rendered identically by:
 *  - `/register` (public self-onboarding)  → `register-member` edge function PDF
 *  - Staff "Membership Registration & Agreement" drawer → `buildMembershipAgreementPdf`
 *
 * Mirrored at `supabase/functions/_shared/agreement.ts` — keep both in sync.
 * Bump `AGREEMENT_VERSION` whenever a clause changes; the version is stored
 * with every signature so we can prove which revision a member accepted.
 */

export const AGREEMENT_VERSION = '2026.09-incline-unified-v1';

export const AGREEMENT_TITLE = 'MEMBERSHIP REGISTRATION & AGREEMENT';

export const FINAL_DECLARATION =
  'I confirm that I have read and understood this Membership Registration & Agreement in its entirety, ' +
  'that the information I have provided is true and complete to the best of my knowledge, and that I accept ' +
  'the health declaration, assumption of risk, facility rules, privacy notice and the consents recorded above. ' +
  'I sign this document once, and my signature applies to all Parts A to I.';

export interface AgreementClause {
  title: string;
  body: string;
}

export type AgreementPartId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I';

export interface AgreementPart {
  id: AgreementPartId;
  /** Heading printed on the PDF and shown as the drawer section title. */
  title: string;
  /** Short helper line shown under the heading. */
  intro?: string;
  /** Legal clauses printed in this part (empty for data-capture parts). */
  clauses: AgreementClause[];
}

/** A tick-box the member records individually. One signature covers them all. */
export interface AgreementAcknowledgement {
  key: string;
  part: AgreementPartId;
  label: string;
  required: boolean;
}

export const AGREEMENT_PARTS: AgreementPart[] = [
  {
    id: 'A',
    title: 'Member Information',
    intro: 'Identity, contact and emergency details on record.',
    clauses: [],
  },
  {
    id: 'B',
    title: 'Membership & Payment Details',
    intro: 'Plan, term, amount and branch.',
    clauses: [
      {
        title: 'Fees, Taxes & Payment Policy',
        body:
          'All membership fees are non-refundable and non-transferable under any circumstances, including non-usage, relocation, or change of mind. Applicable taxes, including 5% GST, will be charged additionally. Prices and tax rates are subject to change as per government regulations.',
      },
      {
        title: 'Membership Freeze / Pause',
        body:
          'Membership freezing may be allowed only with prior written request, subject to management approval, and applicable fees and conditions.',
      },
      {
        title: 'Membership Usage & Credentials',
        body:
          'Membership allows one entry per day, unless otherwise specified. Sharing membership credentials (ID card, biometrics, access code, etc.) is strictly prohibited. Any misuse will result in immediate termination without refund.',
      },
    ],
  },
  {
    id: 'C',
    title: 'Health Declaration & PAR-Q',
    intro: 'Physical Activity Readiness Questionnaire and declared conditions.',
    clauses: [
      {
        title: 'Health Declaration & Disclosure',
        body:
          'I confirm that I am medically fit to participate in physical exercise. I agree to disclose any pre-existing medical condition, injury, pregnancy or medication that may affect my ability to train safely, and to update Incline if my health status changes. Incline is not responsible for health complications arising from undisclosed conditions.',
      },
      {
        title: 'Supplements & External Products',
        body:
          'The fitness centre does not endorse or take responsibility for any supplements or products purchased from third parties. Members consume such products at their own risk.',
      },
    ],
  },
  {
    id: 'D',
    title: 'Assumption of Risk & Emergency Medical Consent',
    clauses: [
      {
        title: 'Assumption of Risk',
        body:
          'I understand that fitness activities involve inherent risks, including injury, illness, or in rare cases, death. I voluntarily assume all such risks and agree that the fitness centre, its owners, staff, and trainers shall not be held liable for any injury, loss, or damage sustained while using the facility, except in cases of gross negligence.',
      },
      {
        title: '24/7 Access Consent & Unstaffed Hours',
        body:
          'I understand and agree that Incline operates on a 24x7 basis and that during certain hours the facility may be unstaffed. I voluntarily choose to use the facility during these times at my own absolute risk.',
      },
      {
        title: 'Medical Liability',
        body:
          'Incline and its management are not legally or financially liable for any personal injury, medical emergency, or accident that occurs on the premises.',
      },
      {
        title: 'Emergency Medical Consent',
        body:
          'In case of an emergency, I authorize the fitness centre staff to arrange medical assistance. All associated costs shall be borne by me.',
      },
      {
        title: 'Indemnity',
        body:
          'I agree to indemnify and hold harmless the fitness centre, its staff, and affiliates from any claims, damages, or liabilities arising out of my use of the facility.',
      },
    ],
  },
  {
    id: 'E',
    title: 'Facility Rules & Membership Conditions',
    clauses: [
      {
        title: 'Access Control & Turnstile Usage',
        body:
          'Access to the facility is strictly controlled via the turnstile. Tailgating (allowing another person to enter behind you on your scan) is strictly prohibited. Forcing, breaking, tampering with, or misusing the turnstile or any access hardware is a serious offense: any member found doing so will be charged for the full cost of repairs and will face immediate membership cancellation.',
      },
      {
        title: 'Personal Training Policy — No Outside Trainers',
        body:
          'External or freelance personal trainers are strictly prohibited from training members inside the facility. Only certified trainers officially employed or authorized by Incline are permitted to conduct training sessions. Violation of this rule will result in the immediate termination of the membership for both the trainer and the client, without a refund.',
      },
      {
        title: 'Hygiene & Footwear Etiquette',
        body:
          'To maintain a clean and hygienic environment for all members, outdoor shoes are strictly prohibited on the gym floor. Members must carry a separate pair of clean, indoor-only athletic shoes to wear during their workouts.',
      },
      {
        title: 'Locker Policy & Liability',
        body:
          'Lockers are available for use only during active workouts unless a long-term locker rental has been purchased. Using or locking a locker overnight without a valid rental purchase is strictly prohibited, and management reserves the right to cut unauthorized locks and remove items. All items stored in lockers are kept entirely at the member\u2019s risk \u2014 Incline is not responsible or liable for any lost, stolen, or damaged personal belongings.',
      },
      {
        title: 'Parking Facility',
        body:
          'Vehicles parked on or near the Incline premises are parked entirely at the owner\u2019s risk. Management is not liable for any theft, damage, or loss of vehicles or items left inside vehicles.',
      },
      {
        title: 'Equipment Use & Property Damage',
        body:
          'Members must use equipment responsibly and follow staff instructions. Any damage caused due to negligence or misuse must be compensated fully by the member.',
      },
      {
        title: 'Code of Conduct & Right of Admission',
        body:
          'Management reserves the right of admission and may terminate membership without refund for: abusive, threatening, or inappropriate behaviour; misuse of equipment (including dropping weights negligently); or violation of gym rules or safety guidelines.',
      },
      {
        title: 'Rules & Amendments',
        body:
          'Management reserves the right to modify rules, timings, fees, and policies at any time. Members are expected to stay informed and comply with updated terms.',
      },
      {
        title: 'Dispute Resolution & Jurisdiction',
        body:
          'Any disputes arising shall be subject to the jurisdiction of courts in the city where the fitness centre is located.',
      },
    ],
  },
  {
    id: 'F',
    title: 'Privacy & Data Protection Notice',
    clauses: [
      {
        title: 'Data Protection & Consent (DPDP Act, 2023)',
        body:
          'By enrolling, I consent to the collection and use of my personal data \u2014 including contact details, government ID, health declarations, biometric access data and attendance records \u2014 for membership management, facility access, safety and service communication. Data is handled in accordance with applicable privacy laws, including the DPDP Act, 2023, and is retained only as long as required for these purposes or by law.',
      },
      {
        title: 'CCTV Surveillance & Privacy',
        body:
          'For member safety, the facility is monitored by 24/7 CCTV surveillance. By signing this agreement, I consent to being recorded while in the public/workout areas of the gym. Recorded footage may be accessed only by management. Requests for footage retrieval and masking, if approved, will incur an administrative fee of \u20B9200.',
      },
    ],
  },
  {
    id: 'G',
    title: 'Communication Preferences',
    clauses: [
      {
        title: 'Service & Update Messages',
        body:
          'Incline sends membership, payment, booking and safety messages over WhatsApp, SMS and email. I may opt out of promotional messages at any time by replying STOP or writing to the club; essential transactional messages will continue while my membership is active.',
      },
    ],
  },
  {
    id: 'H',
    title: 'Photography / Media Consent',
    clauses: [
      {
        title: 'Identification & Media Use',
        body:
          'My photograph may be stored and used for member identification and facility access. Any use of my image or video in marketing or social media is optional and only with the separate consent recorded in this Part, which I may withdraw at any time in writing.',
      },
    ],
  },
  {
    id: 'I',
    title: 'Declaration & Acceptance',
    clauses: [],
  },
];

export const AGREEMENT_ACKNOWLEDGEMENTS: AgreementAcknowledgement[] = [
  {
    key: 'health_declaration',
    part: 'C',
    label:
      'I declare that my health information and PAR-Q answers above are true and complete.',
    required: true,
  },
  {
    key: 'waiver',
    part: 'D',
    label:
      'I accept the assumption of risk, 24/7 unstaffed-hours access, emergency medical consent and indemnity in Part D.',
    required: true,
  },
  {
    key: 'facility_rules',
    part: 'E',
    label:
      'I have read and accept the facility rules and membership conditions in Part E (turnstile, footwear, lockers, parking, conduct).',
    required: true,
  },
  {
    key: 'dpdp',
    part: 'F',
    label:
      'I consent to processing of my personal data, including CCTV recording, per the DPDP Act, 2023.',
    required: true,
  },
  {
    key: 'whatsapp',
    part: 'G',
    label:
      'I consent to receiving membership updates over WhatsApp, SMS and email.',
    required: true,
  },
  {
    key: 'photo',
    part: 'H',
    label:
      'I consent to my photo being used for member identification (optional: marketing/social media use).',
    required: false,
  },
];

export function acknowledgementsForPart(part: AgreementPartId): AgreementAcknowledgement[] {
  return AGREEMENT_ACKNOWLEDGEMENTS.filter((a) => a.part === part);
}

export function acknowledgementLabel(key: string): string {
  return AGREEMENT_ACKNOWLEDGEMENTS.find((a) => a.key === key)?.label ?? key;
}

export const REQUIRED_ACKNOWLEDGEMENT_KEYS = AGREEMENT_ACKNOWLEDGEMENTS
  .filter((a) => a.required)
  .map((a) => a.key);
