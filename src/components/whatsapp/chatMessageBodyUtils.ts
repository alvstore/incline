// Helpers for ChatMessageBody — split out so the component file only exports
// the component (react-refresh/only-export-components).

/** True when a URL points to a document (short doc link or PDF in storage). */
export function isDocumentUrl(url: string): boolean {
  if (/\/functions\/v1\/doc\?c=/i.test(url)) return true;
  if (/\/storage\/v1\/object\//i.test(url) && /\.pdf/i.test(url)) return true;
  if (/\.pdf(\?|$)/i.test(url)) return true;
  // Signed storage links hide the path inside the JWT payload.
  const token = url.match(/[?&]token=([^&]+)/)?.[1];
  if (token && /\/storage\/v1\/object\/sign\//i.test(url)) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return typeof payload?.url === 'string' && /\.pdf$/i.test(payload.url);
    } catch {
      return false;
    }
  }
  return false;
}
