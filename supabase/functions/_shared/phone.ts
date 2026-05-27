// Canonical phone normalization for edge functions.
// MUST mirror src/lib/contacts/phone.ts and public.normalize_phone_in() exactly.

export function normalizePhone(input: string | null | undefined): string {
  if (!input) return "";
  const stripped = String(input).replace(/[^\d+]/g, "");
  if (!stripped) return "";
  if (stripped.startsWith("+")) return stripped;
  if (stripped.length === 13 && stripped.startsWith("091")) {
    return `+${stripped.slice(1)}`;
  }
  if (stripped.length === 11 && stripped.startsWith("0") && /^[6-9]/.test(stripped.slice(1, 2))) {
    return `+91${stripped.slice(1)}`;
  }
  if (/^[6-9]\d{9}$/.test(stripped)) return `+91${stripped}`;
  if (stripped.length === 12 && stripped.startsWith("91")) return `+${stripped}`;
  return `+${stripped}`;
}

export function isValidIndianMobile(input: string | null | undefined): boolean {
  const n = normalizePhone(input);
  return /^\+91[6-9]\d{9}$/.test(n);
}

/** All variants we should match against `profiles.phone` / `leads.phone` /
 *  `contacts.phone` for a given inbound number. */
export function phoneVariants(input: string | null | undefined): string[] {
  if (!input) return [];
  const n = normalizePhone(input);
  if (!n) return [];
  const noPlus = n.replace(/^\+/, "");
  const last10 = noPlus.slice(-10);
  const raw = String(input).replace(/[\s\-]/g, "");
  return Array.from(
    new Set([n, noPlus, `+${noPlus}`, last10, raw].filter(Boolean)),
  );
}
