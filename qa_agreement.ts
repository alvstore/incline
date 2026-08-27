import { buildMembershipAgreementPdf } from '@/utils/pdfBlob';
import { writeFileSync } from 'fs';
const acks: Record<string, boolean> = { health_declaration: true, waiver: true, facility_rules: true, dpdp: true, whatsapp: true, photo: false };
const blob = await buildMembershipAgreementPdf({
  data: { memberName: 'Surendra Singh Chundawat', memberCode: 'INC-26-0132', email: 'a@b.com', phone: '+919928591305', gender: 'male', dateOfBirth: '1990-04-11', address: 'Sector 14', city: 'Udaipur', state: 'Rajasthan', emergencyContactName: 'Ramesh', emergencyContactPhone: '+919999999999', planName: 'Annual Elite', startDate: '2026-07-27', endDate: '2027-07-26', pricePaid: 42000, branchName: 'Incline Udaipur' },
  govIdType: 'aadhaar', govIdNumber: '1234 5678 9012',
  fitnessGoals: 'Fat loss + strength',
  medicalConditions: 'Knee injury (left), Asthma',
  parq: Object.fromEntries((await import('@/lib/registration/healthQuestions')).PARQ_QUESTIONS.map((q, i) => [q, i % 3 === 0 ? 'yes' : 'no'])),
  parqQuestions: [...(await import('@/lib/registration/healthQuestions')).PARQ_QUESTIONS],
  customTerms: 'Member has opted for locker #22 for the full term.',
  acknowledgements: acks,
  signatureDataUrl: null,
  signedAt: new Date().toISOString(),
});
writeFileSync('/tmp/agreement.pdf', Buffer.from(await blob.arrayBuffer()));
console.log('ok');
