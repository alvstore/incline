/** Mirror the transfer RPC's UTC scheduled_at::date boundary, including no-shows. */
export const TRANSFER_FINAL_SESSION_STATUSES = ['completed', 'late', 'absent', 'no_show'] as const;

export function minimumTransferDate(dates: readonly (string | null)[]): string | undefined {
  const validDates = dates.filter((date): date is string => Boolean(date));
  return validDates.sort().at(-1);
}

export function isTransferDateValid(date: string, minimum?: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && (!minimum || date >= minimum);
}