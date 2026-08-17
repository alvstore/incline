// Single source of truth for displaying timestamps in IST (Asia/Kolkata).
// The database is now configured to use 'Asia/Kolkata' as its default timezone.
// These helpers remain to provide explicit formatting and legacy compatibility.

const IST_TZ = 'Asia/Kolkata';

function asDate(input: string | number | Date | null | undefined): Date | null {
  if (input == null || input === '') return null;
  const d = input instanceof Date ? input : new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

/** 
 * Returns the current date/time as a Date object.
 * With the backend now defaulting to IST, this primarily ensures
 * consistent local object handling if needed.
 */
export function getISTNow(): Date {
  return new Date();
}

/** 
 * Returns the current YYYY-MM-DD in IST.
 */
export function getISTToday(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Format as IST (e.g. "12 Jun 2026, 8:25 PM"). */
export function formatIST(
  input: string | number | Date | null | undefined,
  opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
): string {
  const d = asDate(input);
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', { timeZone: IST_TZ, ...opts }).format(d);
}

/** Date only in IST (e.g. "12 Jun 2026"). */
export function formatISTDate(input: string | number | Date | null | undefined): string {
  return formatIST(input, { dateStyle: 'medium' });
}

/** Time only in IST (e.g. "8:25 PM"). */
export function formatISTTime(input: string | number | Date | null | undefined): string {
  return formatIST(input, { timeStyle: 'short' });
}

/** Full IST stamp suitable for logs/audit (e.g. "12 Jun 2026, 8:25:42 PM IST"). */
export function formatISTFull(input: string | number | Date | null | undefined): string {
  const d = asDate(input);
  if (!d) return '—';
  const base = new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TZ,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(d);
  return `${base} IST`;
}

/** Convert a UTC HH:MM to IST HH:MM (string -> string). */
export function utcHmToIstHm(hUtc: number, mUtc: number): { h: number; m: number } {
  let m = mUtc + 30;
  let h = hUtc + 5 + Math.floor(m / 60);
  m = m % 60;
  h = ((h % 24) + 24) % 24;
  return { h, m };
}

/** Convert an IST HH:MM to UTC HH:MM (for building cron expressions). */
export function istHmToUtcHm(hIst: number, mIst: number): { h: number; m: number } {
  let m = mIst - 30;
  let h = hIst - 5;
  if (m < 0) { m += 60; h -= 1; }
  h = ((h % 24) + 24) % 24;
  return { h, m };
}

export const IST_TIMEZONE = IST_TZ;
