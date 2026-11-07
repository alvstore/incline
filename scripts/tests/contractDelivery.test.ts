import { describe, expect, test } from 'bun:test';
import { contractDeliveryInput, contractDeliveryError } from '../../src/lib/hrm/contractDelivery';
import { normalizeDeliveryStatus, deliveryStopped } from '../../src/lib/comms/deliveryStatus';

describe('contract signing delivery', () => {
  test('passes the canonical event and ordered approved-template slots', () => {
    const input = contractDeliveryInput({ branchId: 'branch', contractId: 'contract', role: 'employee', recipient: '+919876543210', name: 'Trainer', employerName: 'The Incline Life by Incline', link: 'https://theincline.in/contract-fill/test', message: 'Please sign', attemptId: '123' });
    expect(input.payload.variables?.event_key).toBe('contract_fill_link');
    expect(input.payload.variables?.variable_1).toBe('Trainer');
    expect(input.payload.variables?.variable_2).toBe('The Incline Life by Incline');
    expect(input.payload.variables?.variable_3).toBe('https://theincline.in/contract-fill/test');
    expect(input.branch_id).toBe('branch');
    expect(input.dedupe_key).toBe('contract_fill_link:contract:employee:123');
  });
  test('HTTP-success suppression is not successful delivery', () => {
    expect(contractDeliveryError({ status: 'suppressed', reason: 'no_template_for_closed_session' })).toBe('no_template_for_closed_session');
    expect(contractDeliveryError({ status: 'failed', reason: 'provider refused' })).toBe('provider refused');
    expect(contractDeliveryError({ status: 'sent' })).toBeNull();
    expect(contractDeliveryError({ status: 'queued' })).toBeNull();
    expect(contractDeliveryError({ status: 'deduped' })).not.toBeNull();
    expect(contractDeliveryError(null)).not.toBeNull();
  });
  test('suppressed rows are terminal, not waiting for provider acknowledgement', () => {
    expect(normalizeDeliveryStatus({ status: 'suppressed', delivery_status: 'suppressed' })).toBe('suppressed');
    expect(normalizeDeliveryStatus({ status: 'sent', delivery_status: 'suppressed' })).toBe('suppressed');
    expect(deliveryStopped('suppressed')).toBe(true);
    expect(deliveryStopped('queued')).toBe(false);
    expect(normalizeDeliveryStatus({ status: 'sent', delivery_status: 'delivered' })).toBe('delivered');
  });
});