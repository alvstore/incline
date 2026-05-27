import { normalizePhone, isValidIndianMobile } from '@/lib/contacts/phone';

export function isEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim());
}

export type LoginIdentifier =
  | { kind: 'email'; value: string }
  | { kind: 'phone'; value: string }
  | { kind: 'invalid' };

export function classifyIdentifier(raw: string): LoginIdentifier {
  const v = raw.trim();
  if (!v) return { kind: 'invalid' };
  if (isEmail(v)) return { kind: 'email', value: v.toLowerCase() };
  if (isValidIndianMobile(v)) return { kind: 'phone', value: normalizePhone(v) };
  return { kind: 'invalid' };
}
