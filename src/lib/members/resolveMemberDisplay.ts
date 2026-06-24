/**
 * Unified display resolver for a `members` row that may not yet have an auth
 * `profiles` row (typical for leads who were converted to members but haven't
 * completed signup). Falls back through `profiles → lead → customer_name`.
 *
 * Use this everywhere we render a member's name / avatar / email / phone in
 * lists (Invoices, Payments, Analytics, etc.) to keep behaviour consistent.
 */
export interface MemberDisplay {
  name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  code: string | null;
}

interface MemberLike {
  member_code?: string | null;
  profiles?: {
    full_name?: string | null;
    email?: string | null;
    phone?: string | null;
    avatar_url?: string | null;
  } | null;
  lead?: {
    full_name?: string | null;
    email?: string | null;
    phone?: string | null;
    avatar_url?: string | null;
  } | null;
}

export function resolveMemberDisplay(
  member: MemberLike | null | undefined,
  customerNameFallback?: string | null,
): MemberDisplay {
  const p = member?.profiles ?? null;
  const l = member?.lead ?? null;
  return {
    name:
      p?.full_name?.trim() ||
      l?.full_name?.trim() ||
      customerNameFallback?.trim() ||
      'Walk-in Customer',
    email: p?.email ?? l?.email ?? null,
    phone: p?.phone ?? l?.phone ?? null,
    avatar_url: p?.avatar_url ?? l?.avatar_url ?? null,
    code: member?.member_code ?? null,
  };
}
