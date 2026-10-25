import { classifyMetaError } from './metaErrorPolicy.ts';

export function metaDmOutcome(code: string | number | null, message: string, httpStatus: number) {
  const policy = classifyMetaError({ code, message, httpStatus });
  const closedWindow = httpStatus < 500 && /outside (?:of )?(?:the )?(?:allowed|24.hour) (?:messaging )?window|more than 24 hours|outside.*24.hour/i.test(message);
  const expected = closedWindow || (['terminal', 'pacing'].includes(policy.class) && !policy.operator_action_required);
  return { severity: expected ? 'warning' as const : 'error' as const, status: expected ? 422 : 502, classification: closedWindow ? 'closed_window' : policy.class };
}