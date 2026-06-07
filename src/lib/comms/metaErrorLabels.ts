// Friendly labels for Meta WhatsApp Cloud API error codes.
// https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
export interface FriendlyCommError {
  code: number | null;
  short: string;
  hint: string;
  raw: string;
}

const META_ERROR_MAP: Record<number, { short: string; hint: string }> = {
  100: {
    short: 'Invalid recipient or parameter',
    hint: 'Phone number is malformed, not on WhatsApp, or a template variable is missing/invalid.',
  },
  130429: {
    short: 'Rate limit hit',
    hint: 'Too many messages in a short window — retry will resume automatically.',
  },
  131000: {
    short: 'Generic Meta error',
    hint: 'Temporary issue on Meta\'s side. Safe to retry.',
  },
  131005: {
    short: 'Access denied',
    hint: 'WABA token lacks permission for this template or number.',
  },
  131008: {
    short: 'Required parameter missing',
    hint: 'A template variable was empty — check your trigger config.',
  },
  131021: {
    short: 'Recipient = sender',
    hint: 'You cannot send a WhatsApp message to your own business number.',
  },
  131026: {
    short: 'Message undeliverable',
    hint: 'The recipient cannot receive WhatsApp messages (no WA, blocked, or offline >30 days).',
  },
  131047: {
    short: 'Outside 24-hour window',
    hint: 'Last user message is >24h old — must send a template to re-open the session.',
  },
  131051: {
    short: 'Unsupported message type',
    hint: 'Channel does not support this media kind — fallback to document or text.',
  },
  132000: {
    short: 'Template parameter mismatch',
    hint: 'Number of variables sent does not match the approved template body.',
  },
  132001: {
    short: 'Template not found in WABA',
    hint: 'Re-sync templates from Meta in Templates Hub, or pick a valid template.',
  },
  132005: {
    short: 'Template text translation mismatch',
    hint: 'The text sent does not match the approved language/version. Re-sync template.',
  },
  132007: {
    short: 'Template format error',
    hint: 'Header/body/footer formatting does not match what Meta approved.',
  },
  132012: {
    short: 'Param format wrong',
    hint: 'A variable value violates Meta\'s format rules (URLs, dates, currency).',
  },
  132015: {
    short: 'Template paused',
    hint: 'Meta paused this template due to low quality. Edit & resubmit or use another.',
  },
  132016: {
    short: 'Template disabled',
    hint: 'Meta disabled this template. Create a fresh version.',
  },
  133010: {
    short: 'Number not registered',
    hint: 'WABA phone number is not registered with Cloud API.',
  },
};

const CODE_PATTERNS: RegExp[] = [
  /\(#(\d{3,6})\)/, // "(#132001)"
  /"meta_code"\s*:\s*(\d{3,6})/, // JSON blob
  /^(\d{3,6})\s*[:\-]/, // "132001: Template..."
];

export function parseCommError(raw: string | null | undefined): FriendlyCommError | null {
  if (!raw) return null;
  const text = String(raw);
  let code: number | null = null;
  for (const re of CODE_PATTERNS) {
    const m = text.match(re);
    if (m) {
      code = Number(m[1]);
      break;
    }
  }
  if (code && META_ERROR_MAP[code]) {
    return { code, short: META_ERROR_MAP[code].short, hint: META_ERROR_MAP[code].hint, raw: text };
  }
  if (code) {
    return { code, short: `Meta error ${code}`, hint: 'Unmapped Meta Cloud API error — see raw details.', raw: text };
  }
  // Non-Meta errors (SMTP, SMS provider, etc.) — strip the giant raw blob
  const firstLine = text.split('\n')[0].slice(0, 180);
  return { code: null, short: firstLine, hint: '', raw: text };
}
