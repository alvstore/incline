import { z } from 'zod';

export const ptCloseoutFormSchema = z.object({
  reason: z.string().trim().min(6, 'Enter a reason of at least 6 characters.').max(2000),
  externalCommission: z.coerce.number().finite().min(0, 'Amount cannot be negative.'),
});

export const ptCloseoutPreviewSchema = z.object({
  invoice_id: z.string(),
  already: z.boolean(),
  retained_amount: z.number(),
  waived_amount: z.number(),
  commission_entitlement: z.number(),
  remaining_commission: z.number(),
  original_total: z.number().optional(),
  payroll_linked_commission: z.number().optional(),
  confirmed_external_commission: z.number().optional(),
  sessions_used: z.number().nullable().optional(),
});

export type PtCloseoutPreview = z.infer<typeof ptCloseoutPreviewSchema>;
export type PtCloseoutForm = z.infer<typeof ptCloseoutFormSchema>;

export function ptCloseoutError(error: { message?: string; code?: string }): string {
  const messages: Record<string, string> = {
    forbidden: 'You do not have permission to close this invoice.',
    unauthorized: 'Please sign in again.',
    feature_disabled: 'PT closeout is not enabled for this branch.',
    not_found: 'This invoice is no longer available.',
    bos_pt_only: 'Only non-GST PT invoices are supported. GST invoices need a credit-note review.',
    not_partial: 'This invoice must have received payment and an outstanding balance.',
    stale_preview: 'The invoice changed. Refresh the preview before saving.',
    commission_recovery_required: 'Recorded commission exceeds the revised entitlement. Review payroll recovery first.',
    single_package_required: 'Multiple packages need an individual accounting review.',
    single_commission_required: 'The commission record needs an accounting review.',
    mixed_invoice: 'This invoice contains other services and needs an accounting review.',
    cancel_future_sessions_first: 'Cancel upcoming PT appointments before closing the package.',
    reason_required: 'Enter a reason of at least 6 characters.',
    invalid_external_commission: 'Enter a valid commission amount with at most two decimal places.',
    package_closed: 'This PT package is already closed.',
  };
  return messages[error.message ?? ''] ?? 'Could not close the PT invoice. No changes were saved.';
}

export function closeoutCommission(retained: number, share: number, linked: number, external: number) {
  const entitlement = Math.round(retained * share) / 100;
  return { entitlement, remaining: entitlement - linked - external };
}