// Content Security Policy injected into index.html for production builds only
// (dev/HMR needs looser rules). Hosting can't set response headers, so this is a
// <meta> CSP: frame-ancestors / Permissions-Policy are not possible here.
// Add a host only when a real feature loads from it.
export const CSP_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'self'"],
  "script-src": ["'self'", "'unsafe-inline'", "https://checkout.razorpay.com", "https://*.razorpay.com", "https://maps.googleapis.com", "https://*.lovable.app", "https://*.lovable.dev", "https://cdn.gpteng.co"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:", "blob:", "https:"],
  "media-src": ["'self'", "data:", "blob:", "https:"],
  "font-src": ["'self'", "data:"],
  "connect-src": ["'self'", "https://*.supabase.co", "wss://*.supabase.co", "https://*.razorpay.com", "https://maps.googleapis.com", "https://*.lovable.app", "https://*.lovable.dev", "https://*.gpteng.co", "https://prodapi.howbodyfit.com", "https://howbody-haidiobj.s3.eu-central-1.amazonaws.com", "https://storage.googleapis.com", "data:", "blob:"],
  "frame-src": ["'self'", "blob:", "https://*.razorpay.com", "https://www.google.com", "https://www.youtube.com", "https://www.youtube-nocookie.com"],
  "worker-src": ["'self'", "blob:"],
  "manifest-src": ["'self'"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'", "https://*.razorpay.com"],
};

export function buildCsp(): string {
  return Object.entries(CSP_DIRECTIVES).map(([k, v]) => `${k} ${v.join(" ")}`).join("; ") + "; upgrade-insecure-requests";
}
