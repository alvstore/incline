/** Signing links leave the app: local/preview request origins are never deliverable. */
export function contractPublicOrigin(configuredUrl: string | undefined, requestOrigin: string | null): string {
  const canonical = 'https://theincline.in';
  const parsePublic = (value: string | null | undefined): URL | null => {
    if (!value) return null;
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
      if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return null;
      if (/^[\d.]+$/.test(host) || host.includes(':') || host.includes('preview')) return null;
      return url;
    } catch { return null; }
  };
  // Server-owned configuration wins and supports a future custom domain.
  const configured = parsePublic(configuredUrl);
  if (configured) return configured.origin;
  // Never reflect arbitrary caller-controlled origins into secure signing messages.
  const request = parsePublic(requestOrigin);
  const publishedHosts = ['theincline.in', 'www.theincline.in', 'incline.lovable.app'];
  if (request && publishedHosts.includes(request.hostname.toLowerCase())) return request.origin;
  return canonical;
}