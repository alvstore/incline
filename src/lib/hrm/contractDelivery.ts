import type { DispatchInput, DispatchResult } from '@/services/preferencesService';

/** Both semantic and positional values are supplied for the approved Meta copy. */
export function contractDeliveryInput(input: {
  branchId: string;
  contractId: string;
  role: string;
  recipient: string;
  name: string;
  employerName: string;
  link: string;
  message: string;
  attemptId: string;
}): DispatchInput {
  return {
    branch_id: input.branchId,
    channel: 'whatsapp',
    category: 'transactional',
    recipient: input.recipient,
    payload: {
      body: input.message,
      variables: {
        event_key: 'contract_fill_link',
        name: input.name,
        recipient_name: input.name,
        employer_name: input.employerName,
        link: input.link,
        variable_1: input.name,
        variable_2: input.employerName,
        variable_3: input.link,
      },
    },
    dedupe_key: `contract_fill_link:${input.contractId}:${input.role}:${input.attemptId}`,
    force: true,
  };
}

export function contractDeliveryError(result: DispatchResult | null | undefined): string | null {
  if (!result) return 'No delivery confirmation received. Check the Live Feed before sending again.';
  if (result.status === 'failed' || result.status === 'suppressed') {
    return result.reason || 'The contract message could not be sent.';
  }
  if (result.status === 'deduped' && !result.provider_message_id) {
    return 'This request was already recorded. Check its delivery status in the Live Feed.';
  }
  return null;
}