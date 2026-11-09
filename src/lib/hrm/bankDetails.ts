export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ACCOUNT_RE = /^\d{6,24}$/;

/** Show only the last four digits of a bank account number. */
export function maskAccount(account: string | null | undefined): string {
  const a = (account || '').trim();
  if (!a) return '—';
  return `•••• ${a.slice(-4)}`;
}

export const isValidIfsc = (v: string) => IFSC_RE.test(v);
export const isValidAccount = (v: string) => ACCOUNT_RE.test(v);
