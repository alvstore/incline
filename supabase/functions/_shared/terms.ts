/**
 * MIRROR of src/lib/registration/terms.ts — compatibility layer over the single
 * Membership Registration & Agreement defined in `./agreement.ts` (Parts A–I).
 *
 * Do NOT add clauses here — add them to the relevant Part in `agreement.ts`.
 */

import {
  AGREEMENT_PARTS,
  AGREEMENT_VERSION,
  FINAL_DECLARATION,
  type AgreementClause,
} from "./agreement.ts";

export type TermClause = AgreementClause;

export const TERMS_VERSION = AGREEMENT_VERSION;

export const MEMBER_DECLARATION = FINAL_DECLARATION;

export const FACILITY_TERMS: TermClause[] = AGREEMENT_PARTS.flatMap((p) => p.clauses);
