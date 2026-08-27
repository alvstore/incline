/**
 * Compatibility layer over the single Membership Registration & Agreement.
 *
 * The canonical structure now lives in `./agreement.ts` (Parts A–I). This file
 * only projects the legal clauses of that agreement into the flat list some
 * older call sites still consume, so a clause can never be printed twice or
 * drift between the two documents. Do NOT add clauses here — add them to the
 * relevant Part in `agreement.ts`.
 */

import {
  AGREEMENT_PARTS,
  AGREEMENT_VERSION,
  FINAL_DECLARATION,
  type AgreementClause,
} from './agreement';

export type TermClause = AgreementClause;

export const TERMS_VERSION = AGREEMENT_VERSION;

export const MEMBER_DECLARATION = FINAL_DECLARATION;

export const FACILITY_TERMS: TermClause[] = AGREEMENT_PARTS.flatMap((p) => p.clauses);
