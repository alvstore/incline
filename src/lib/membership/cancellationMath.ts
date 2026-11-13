export type RefundChoice = 'none' | 'full' | 'prorated' | 'custom';
export type BalanceAction = 'keep' | 'write_off';

/** Refund amount for a cancellation — never more than money actually received. */
export function computeRefund(opts: {
  choice: RefundChoice;
  received: number;
  totalDays: number;
  daysRemaining: number;
  custom?: number;
}): number {
  const received = Math.max(0, opts.received || 0);
  let amt = 0;
  switch (opts.choice) {
    case 'full': amt = received; break;
    case 'prorated':
      amt = opts.totalDays > 0 ? Math.round((received * Math.max(0, opts.daysRemaining)) / opts.totalDays) : 0;
      break;
    case 'custom': amt = Math.max(0, opts.custom || 0); break;
    default: amt = 0;
  }
  return Math.min(amt, received);
}

/** Amount the member still owes after cancelling, given the balance choice. */
export function remainingDue(due: number, action: BalanceAction): number {
  return action === 'write_off' ? 0 : Math.max(0, due || 0);
}

export const CANCEL_REASONS = [
  'Non payment',
  'Relocating',
  'Medical',
  'Not satisfied',
  'Joined by mistake',
  'Other',
] as const;
