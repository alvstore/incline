// Planned Content Security Policy origin allowlist (shared by the report-only audit).
export const ALLOWED_ORIGIN_PATTERNS: RegExp[] = [
  /^https:\/\/(www\.)?theincline\.in$/,
  /^https:\/\/[a-z0-9-]+\.supabase\.co$/,
  /^wss:\/\/[a-z0-9-]+\.supabase\.co$/,
  /^https:\/\/([a-z0-9-]+\.)*razorpay\.com$/,
  /^https:\/\/storage\.googleapis\.com$/,
  /^https:\/\/([a-z0-9-]+\.)*(lovable\.app|lovableproject\.com|lovable\.dev)$/,
  /^https:\/\/([a-z0-9-]+\.)*(google\.com|gstatic\.com|googleapis\.com|youtube\.com|ytimg\.com)$/,
  /^https:\/\/([a-z0-9-]+\.)*(instagram\.com|facebook\.com|fbcdn\.net)$/,
];

export function isAllowedOrigin(origin: string, self = location.origin): boolean {
  if (!origin || origin === self || origin === "null") return true;
  return ALLOWED_ORIGIN_PATTERNS.some((r) => r.test(origin));
}

