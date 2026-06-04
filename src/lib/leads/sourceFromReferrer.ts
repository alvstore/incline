// Maps a referrer URL or UTM source string into the canonical `leads.source`
// value. Keeps EmbedLeadForm + capture-lead edge fn in sync.

const HOST_MAP: Array<{ test: RegExp; source: string }> = [
  { test: /linktr\.ee|linktree/i, source: 'linktree' },
  { test: /instagram\.com|ig\.me/i, source: 'instagram' },
  { test: /facebook\.com|fb\.me|fb\.com/i, source: 'facebook' },
  { test: /wa\.me|whatsapp\.com|api\.whatsapp/i, source: 'whatsapp' },
  { test: /youtube\.com|youtu\.be/i, source: 'youtube' },
  { test: /google\./i, source: 'google' },
  { test: /bing\./i, source: 'bing' },
  { test: /t\.co|twitter\.com|x\.com/i, source: 'twitter' },
  { test: /linkedin\.com|lnkd\.in/i, source: 'linkedin' },
  { test: /tiktok\.com/i, source: 'tiktok' },
  { test: /threads\.net/i, source: 'threads' },
];

/** Returns the canonical source given an optional utmSource + referrer URL.
 *  Falls back to `defaultSource` (default: 'website'). */
export function deriveLeadSource(
  utmSource?: string | null,
  referrerUrl?: string | null,
  defaultSource = 'website',
): string {
  const utm = (utmSource || '').trim().toLowerCase();
  if (utm) {
    // accept verbatim if it matches our canonical vocabulary
    for (const { source } of HOST_MAP) if (source === utm) return source;
    // otherwise allow the utm value through (capped + sanitized)
    return utm.replace(/[^a-z0-9_-]/g, '').slice(0, 32) || defaultSource;
  }
  const ref = (referrerUrl || '').trim();
  if (ref) {
    for (const { test, source } of HOST_MAP) if (test.test(ref)) return source;
  }
  return defaultSource;
}
