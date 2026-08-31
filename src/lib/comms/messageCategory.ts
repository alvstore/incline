// Browser mirror of the category rules in
// `supabase/functions/_shared/whatsappPolicy.ts`. Edge code cannot be imported
// into the Vite bundle, so these two files must stay in sync — change both.

export type MessageCategory = 'marketing' | 'utility' | 'authentication' | 'service';

const UTILITY_CATEGORIES = new Set([
  'invoice', 'payment_receipt', 'payment_reminder', 'membership', 'booking',
  'class', 'pt_session', 'attendance', 'transactional', 'document', 'report',
]);
const AUTH_CATEGORIES = new Set(['otp', 'password_reset', 'verification']);
const SERVICE_CATEGORIES = new Set(['service', 'conversation', 'support', 'reply']);

/** Maps an app-level category onto the four Meta-facing message categories.
 *  Never widens marketing into utility — unknown categories stay marketing. */
export function resolveMessageCategory(category?: string | null): MessageCategory {
  const c = String(category ?? '').toLowerCase().trim();
  if (!c) return 'marketing';
  if (AUTH_CATEGORIES.has(c)) return 'authentication';
  if (SERVICE_CATEGORIES.has(c)) return 'service';
  if (UTILITY_CATEGORIES.has(c)) return 'utility';
  return 'marketing';
}

/** Meta template category (MARKETING/UTILITY/AUTHENTICATION) → our category. */
export function categoryFromTemplate(templateCategory?: string | null): MessageCategory | null {
  const t = String(templateCategory ?? '').toLowerCase().trim();
  if (t === 'marketing') return 'marketing';
  if (t === 'utility') return 'utility';
  if (t === 'authentication') return 'authentication';
  return null;
}

/** True when the declared purpose and the template's Meta category disagree.
 *  A mismatch must block the send — relabelling marketing as utility is abuse. */
export function categoryMismatch(
  declared: MessageCategory,
  templateCategory?: string | null,
): boolean {
  const fromTemplate = categoryFromTemplate(templateCategory);
  if (!fromTemplate) return false;
  if (declared === 'service') return false;
  return fromTemplate !== declared;
}

/** Campaign type → declared message purpose. Promotional intent stays marketing. */
export function campaignPurpose(campaignType: string): MessageCategory {
  return campaignType === 'promotion' || campaignType === 'event' || campaignType === 'lead_reengagement'
    ? 'marketing'
    : 'utility';
}

/** Meta template statuses that must never be used for a live send. */
export const UNUSABLE_TEMPLATE_STATUSES = ['REJECTED', 'PAUSED', 'DISABLED', 'PENDING_DELETION'];

export function templateStatusBlocked(status?: string | null): boolean {
  return UNUSABLE_TEMPLATE_STATUSES.includes(String(status ?? '').toUpperCase());
}
