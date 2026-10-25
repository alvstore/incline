import { AGREEMENT_PARTS } from '@/lib/registration/agreement';

/** Reuse approved agreement wording; invoice tax figures remain authoritative. */
export function invoiceTerms(hasMembership: boolean): string[] {
  const clauses = AGREEMENT_PARTS.flatMap(part => part.clauses);
  const titles = hasMembership
    ? ['Fees, Taxes & Payment Policy', 'Membership Freeze / Pause', 'Dispute Resolution & Jurisdiction']
    : ['Dispute Resolution & Jurisdiction'];
  return titles.flatMap(title => {
    const clause = clauses.find(value => value.title === title);
    if (!clause) return [];
    // Do not imply additional GST on an already-issued non-GST invoice.
    return [title === 'Fees, Taxes & Payment Policy' ? clause.body.split('. ')[0] + '.' : clause.body];
  });
}