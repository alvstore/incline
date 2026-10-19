/**
 * Parse a backend storage URL (signed or public) into bucket + object path,
 * so callers can re-sign it on demand instead of trusting a stored token
 * that may have expired. Returns null for external URLs and raw paths.
 */
export function parseStorageUrl(url: string): { bucket: string; path: string } | null {
  const m = /\/storage\/v1\/object\/(?:sign|public|authenticated)\/([^/?#]+)\/([^?#]+)/i.exec(url);
  if (!m) return null;
  try {
    return { bucket: decodeURIComponent(m[1]), path: decodeURIComponent(m[2]) };
  } catch {
    return { bucket: m[1], path: m[2] };
  }
}
