/**
 * Phone normalization helpers used across the platform.
 * MUST mirror the database-side `public.normalize_phone_in()` function exactly
 * so client lookups always match server-stored values.
 *
 * Rules (in order):
 *  - Strip everything except digits and a leading `+`
 *  - If starts with `+`, keep as-is (E.164)
 *  - 13-digit `091XXXXXXXXXX` → `+91XXXXXXXXXX`
 *  - 11-digit `0XXXXXXXXXX` where XXX… starts 6/7/8/9 → `+91XXXXXXXXXX`
 *  - 10-digit starting 6/7/8/9 → `+91XXXXXXXXXX`
 *  - 12-digit starting `91` → `+91XXXXXXXXXX`
 *  - Otherwise prefix `+`
 */

export function normalizePhone(input: string | null | undefined): string {
  if (!input) return '';
  const stripped = String(input).replace(/[^\d+]/g, '');
  if (!stripped) return '';
  if (stripped.startsWith('+')) return stripped;
  // 091XXXXXXXXXX → +91XXXXXXXXXX
  if (stripped.length === 13 && stripped.startsWith('091')) {
    return `+${stripped.slice(1)}`;
  }
  // 0XXXXXXXXXX (leading 0 + 10-digit IN mobile) → +91XXXXXXXXXX
  if (stripped.length === 11 && stripped.startsWith('0') && /^[6-9]/.test(stripped.slice(1, 2))) {
    return `+91${stripped.slice(1)}`;
  }
  // 10-digit Indian mobile
  if (/^[6-9]\d{9}$/.test(stripped)) return `+91${stripped}`;
  // 12-digit starting 91
  if (stripped.length === 12 && stripped.startsWith('91')) return `+${stripped}`;
  return `+${stripped}`;
}

/** True when the input normalizes to a valid 10-digit Indian mobile (+91[6-9]XXXXXXXXX). */
export function isValidIndianMobile(input: string | null | undefined): boolean {
  const n = normalizePhone(input);
  return /^\+91[6-9]\d{9}$/.test(n);
}

/** Build the set of phone variants we should search by in the database. */
export function phoneVariants(input: string | null | undefined): string[] {
  if (!input) return [];
  const n = normalizePhone(input);
  const noPlus = n.replace(/^\+/, '');
  const last10 = noPlus.slice(-10);
  return Array.from(new Set([n, noPlus, `+${noPlus}`, last10].filter(Boolean)));
}

export function formatPhoneDisplay(input: string | null | undefined): string {
  const n = normalizePhone(input);
  if (!n) return '';
  // +91 98765 43210
  if (n.startsWith('+91') && n.length === 13) {
    return `+91 ${n.slice(3, 8)} ${n.slice(8)}`;
  }
  return n;
}
