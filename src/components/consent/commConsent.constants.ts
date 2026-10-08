/**
 * Canonical opt-in copy. Persisted verbatim into `comm_consent_text` for
 * DLT / MSG91 / TRAI / RCS audit evidence. Do NOT paraphrase per surface —
 * the audit log relies on the exact string the user saw.
 */
export const COMM_CONSENT_TEXT =
  'I authorise The Incline Life by Incline to send me notifications via SMS, Email, RCS and WhatsApp as per the Terms of Service and Privacy Policy.';

export const COMM_CONSENT_CHANNELS = ['sms', 'email', 'rcs', 'whatsapp'] as const;
export type CommConsentChannel = (typeof COMM_CONSENT_CHANNELS)[number];

export interface ConsentPayload {
  granted: boolean;
  channels: string[];
  text: string;
}

export function buildConsentPayload(granted: boolean): ConsentPayload {
  return {
    granted,
    channels: granted ? [...COMM_CONSENT_CHANNELS] : [],
    text: COMM_CONSENT_TEXT,
  };
}
