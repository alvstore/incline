// v1.0.0 — Detects "stop messaging me / do not contact" intent in inbound
// WhatsApp / IG / FB messages. Multilingual (English + Hinglish + Hindi script).
// Returns { optOut: boolean, reason: string } from a cheap regex match. The
// caller is responsible for actually persisting the flag via the
// mark_do_not_contact RPC, and (when appropriate) sending a single
// confirmation reply before short-circuiting the AI brain.

export type OptOutResult = {
  optOut: boolean;
  reason: string;
  matched?: string;
};

// Keywords. Each entry is matched as a whole-token regex; punctuation/diacritics
// stripped from the inbound text first so "msg mat karo!" → "msg mat karo".
const OPT_OUT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // English explicit
  { pattern: /\bunsubscribe\b/i, reason: "keyword:unsubscribe" },
  { pattern: /\bstop\s+(messaging|texting|calling|contacting|sending|spamming)/i, reason: "keyword:stop_action" },
  { pattern: /^\s*stop\s*$/i, reason: "keyword:stop" },
  { pattern: /\b(please\s+)?(don't|do\s+not)\s+(message|msg|text|call|contact|disturb|bother|spam)\b/i, reason: "keyword:dont_contact" },
  { pattern: /\bremove\s+me\b/i, reason: "keyword:remove_me" },
  { pattern: /\bopt\s*out\b/i, reason: "keyword:opt_out" },
  { pattern: /\bleave\s+me\s+alone\b/i, reason: "keyword:leave_me_alone" },
  { pattern: /\bnot\s+interested\b.*\b(stop|don't)\b/i, reason: "keyword:not_interested_stop" },

  // Hinglish (latin script)
  { pattern: /\b(msg|message|sms|call|baat|baatcheet|contact)\s+mat\s+(kar|karo|kariye|karna|karein|kr)\b/i, reason: "keyword:msg_mat_karo" },
  { pattern: /\bmat\s+(karo|kariye|karna|kar)\b.*\b(msg|message|call|baat|contact|disturb|pareshan)\b/i, reason: "keyword:mat_karo_msg" },
  { pattern: /\bdisturb\s+mat\s+(kar|karo|kariye|karna|kr)\b/i, reason: "keyword:disturb_mat_karo" },
  { pattern: /\bpareshan\s+mat\s+(kar|karo|kariye|karna|kr)\b/i, reason: "keyword:pareshan_mat_karo" },
  { pattern: /\b(baar\s+baar|bar\s+bar)\b.*\bmat\b/i, reason: "keyword:baar_baar_mat" },
  { pattern: /\b(band|bandh)\s+(kar|karo|kariye|kr)\b.*\b(msg|message|call|contact)\b/i, reason: "keyword:band_karo" },
  { pattern: /\b(msg|message|call|contact)\b.*\b(band|bandh)\s+(kar|karo|kariye|kr)\b/i, reason: "keyword:msg_band_karo" },
  { pattern: /\bnahi\s+chahiye\b.*\b(msg|message|call|offer|info)\b/i, reason: "keyword:nahi_chahiye" },

  // Hindi (devanagari) — common forms
  { pattern: /मैसेज\s*मत\s*(करो|कीजिए|करें|कर)/i, reason: "keyword:hi_msg_mat" },
  { pattern: /कॉल\s*मत\s*(करो|कीजिए|करें|कर)/i, reason: "keyword:hi_call_mat" },
  { pattern: /परेशान\s*मत\s*(करो|कीजिए|करें|कर)/i, reason: "keyword:hi_pareshan_mat" },
  { pattern: /बार\s*बार\s*मत/i, reason: "keyword:hi_baar_baar_mat" },
];

export function detectOptOut(rawText: string | null | undefined): OptOutResult {
  if (!rawText) return { optOut: false, reason: "" };
  // Normalise: collapse whitespace, strip surrounding punctuation but keep
  // word characters and devanagari. Lowercased copy used for the regexes
  // marked /i; devanagari is case-insensitive so it just passes through.
  const text = String(rawText)
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return { optOut: false, reason: "" };

  // Cap message length for regex cost.
  const sample = text.length > 600 ? text.slice(0, 600) : text;

  for (const { pattern, reason } of OPT_OUT_PATTERNS) {
    const m = sample.match(pattern);
    if (m) return { optOut: true, reason, matched: m[0] };
  }
  return { optOut: false, reason: "" };
}

// Standardised confirmation reply we send back exactly once when an opt-out is
// detected automatically. Kept short and template-safe (no variables).
export const OPT_OUT_CONFIRMATION =
  "Got it 🙏 We won't message you again. If you ever change your mind, just reply here and we'll be happy to help.";
