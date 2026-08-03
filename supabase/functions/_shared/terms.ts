/**
 * MIRROR of src/lib/registration/terms.ts — keep in sync.
 * Single source of truth for the Incline membership terms & conditions.
 *
 * Rendered on:
 *  - `/register` (public self-onboarding, signed digitally)
 *  - Staff "Member Registration Form" drawer + its printed/stored PDF
 *  - `register-member` edge function waiver PDF (mirrored in
 *    `supabase/functions/_shared/terms.ts` — keep both in sync)
 *
 * Bump `TERMS_VERSION` whenever a clause changes; the version is stored with
 * every signature so we can prove which revision a member accepted.
 */

export interface TermClause {
  title: string;
  body: string;
}

export const TERMS_VERSION = '2026.08-incline-24x7';

export const MEMBER_DECLARATION =
  'I have read, understood, and agree to abide by all the terms and conditions stated above.';

export const FACILITY_TERMS: TermClause[] = [
  {
    title: '24/7 Access Consent & Unstaffed Hours',
    body:
      'I understand and agree that Incline operates on a 24x7 basis and that during certain hours the facility may be unstaffed. I voluntarily choose to use the facility during these times at my own absolute risk.',
  },
  {
    title: 'Health Declaration & Assumption of Risk',
    body:
      'I confirm that I am medically fit to participate in physical exercise. I understand that fitness activities involve inherent risks, including injury, illness, or in rare cases, death. I voluntarily assume all such risks and agree that the fitness centre, its owners, staff, and trainers shall not be held liable for any injury, loss, or damage sustained while using the facility.',
  },
  {
    title: 'Medical Liability & Disclosure',
    body:
      'Incline and its management are not legally or financially liable for any personal injury, medical emergency, or accident that occurs on the premises. Members must ensure they are medically fit to engage in physical activity and agree to disclose any pre-existing medical conditions. The fitness centre is not responsible for health complications arising from undisclosed conditions.',
  },
  {
    title: 'CCTV Surveillance Consent & Privacy',
    body:
      'For member safety, the facility is monitored by 24/7 CCTV surveillance. By signing this agreement, I consent to being recorded while in the public/workout areas of the gym. Recorded footage may be accessed only by management. Requests for footage retrieval and masking, if approved, will incur an administrative fee of \u20B9200.',
  },
  {
    title: 'Personal Training Policy — No Outside Trainers',
    body:
      'External or freelance personal trainers are strictly prohibited from training members inside the facility. Only certified trainers officially employed or authorized by Incline are permitted to conduct training sessions. Violation of this rule will result in the immediate termination of the membership for both the trainer and the client, without a refund.',
  },
  {
    title: 'Access Control & Turnstile Usage',
    body:
      'Access to the facility is strictly controlled via the turnstile. Tailgating (allowing another person to enter behind you on your scan) is strictly prohibited. Forcing, breaking, tampering with, or misusing the turnstile or any access hardware is a serious offense: any member found doing so will be charged for the full cost of repairs and will face immediate membership cancellation.',
  },
  {
    title: 'Membership Usage & Credentials',
    body:
      'Membership allows one entry per day, unless otherwise specified. Sharing membership credentials (ID card, biometrics, access code, etc.) is strictly prohibited. Any misuse will result in immediate termination without refund.',
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
    title: 'Code of Conduct & Right of Admission',
    body:
      'Management reserves the right of admission and may terminate membership without refund for: abusive, threatening, or inappropriate behaviour; misuse of equipment (including dropping weights negligently); or violation of gym rules or safety guidelines.',
  },
  {
    title: 'Equipment Use & Property Damage',
    body:
      'Members must use equipment responsibly and follow staff instructions. Any damage caused due to negligence or misuse must be compensated fully by the member.',
  },
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
    title: 'Supplements & External Products',
    body:
      'The fitness centre does not endorse or take responsibility for any supplements or products purchased from third parties. Members consume such products at their own risk.',
  },
  {
    title: 'Data Protection & Consent',
    body:
      'By enrolling, I consent to the collection and use of my personal data for membership management, communication and updates. Data will be handled in accordance with applicable privacy laws, including the DPDP Act, 2023.',
  },
  {
    title: 'Emergency Medical Consent',
    body:
      'In case of an emergency, I authorize the fitness centre staff to arrange medical assistance. All associated costs shall be borne by me.',
  },
  {
    title: 'Indemnity Clause',
    body:
      'I agree to indemnify and hold harmless the fitness centre, its staff, and affiliates from any claims, damages, or liabilities arising out of my use of the facility.',
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
];
