/**
 * Unified identity resolver for an inbound phone number.
 * Lookup priority: Member (profiles.phone) → Lead → Contact Book → Unknown.
 *
 * Every call uses normalised phone variants so spaces/leading zeros do not
 * cause false negatives.
 */
import { supabase } from '@/integrations/supabase/client';
import { normalizePhone, phoneVariants } from '@/lib/contacts/phone';

export type IdentitySource = 'member' | 'lead' | 'contact' | 'unknown';

export interface ResolvedIdentity {
  source: IdentitySource;
  display_name: string;
  phone: string;            // normalised
  member_id?: string | null;
  lead_id?: string | null;
  contact_id?: string | null;
  email?: string | null;
  member_code?: string | null;
  avatar_url?: string | null;
}

const cache = new Map<string, ResolvedIdentity>();

export function clearIdentityCache() {
  cache.clear();
}

export async function resolveIdentity(rawPhone: string): Promise<ResolvedIdentity> {
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    return { source: 'unknown', display_name: 'Unknown', phone: rawPhone || '' };
  }
  const cached = cache.get(phone);
  if (cached) return cached;

  const variants = phoneVariants(phone);

  // 1) Member (via profiles.phone → members.user_id)
  try {
    const { data: prof } = await supabase
      .from('profiles')
      .select('id, full_name, email, phone, avatar_url')
      .in('phone', variants)
      .limit(1)
      .maybeSingle();
    if (prof?.id) {
      const { data: m } = await supabase
        .from('members')
        .select('id, member_code')
        .eq('user_id', prof.id)
        .limit(1)
        .maybeSingle();
      if (m?.id) {
        const out: ResolvedIdentity = {
          source: 'member',
          display_name: prof.full_name || prof.email || phone,
          phone,
          member_id: m.id,
          email: prof.email,
          member_code: m.member_code,
          avatar_url: (prof as any).avatar_url ?? null,
        };
        cache.set(phone, out);
        return out;
      }
    }
  } catch (_) { /* fall through */ }

  // 2) Lead
  try {
    const { data: lead } = await supabase
      .from('leads')
      .select('id, full_name, email, avatar_url')
      .in('phone', variants)
      .limit(1)
      .maybeSingle();
    if (lead?.id) {
      const out: ResolvedIdentity = {
        source: 'lead',
        display_name: lead.full_name || phone,
        phone,
        lead_id: lead.id,
        email: lead.email,
        avatar_url: (lead as any).avatar_url ?? null,
      };
      cache.set(phone, out);
      return out;
    }
  } catch (_) { /* fall through */ }

  // 3) Contact Book
  try {
    const { data: c } = await supabase
      .from('contacts')
      .select('id, full_name, email')
      .in('phone', variants)
      .limit(1)
      .maybeSingle();
    if (c?.id) {
      const out: ResolvedIdentity = {
        source: 'contact',
        display_name: c.full_name,
        phone,
        contact_id: c.id,
        email: c.email,
      };
      cache.set(phone, out);
      return out;
    }
  } catch (_) { /* fall through */ }

  const fallback: ResolvedIdentity = { source: 'unknown', display_name: phone, phone };
  cache.set(phone, fallback);
  return fallback;
}

/** Batch resolver — useful for chat list. Returns a Map keyed by normalised phone. */
export async function resolveIdentities(phones: string[]): Promise<Map<string, ResolvedIdentity>> {
  const map = new Map<string, ResolvedIdentity>();
  await Promise.all(
    phones.map(async (p) => {
      const r = await resolveIdentity(p);
      map.set(normalizePhone(p), r);
    }),
  );
  return map;
}
