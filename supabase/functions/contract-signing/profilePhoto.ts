/** Only stored display avatars on this backend may be embedded; never fetch arbitrary URLs. */
export function profilePhotoPath(value: unknown, backendUrl: string): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (url.origin !== new URL(backendUrl).origin) return null;
    const match = /^\/storage\/v1\/object\/(?:public|sign|authenticated)\/avatars\/(.+)$/.exec(url.pathname);
    if (!match) return null;
    const path = decodeURIComponent(match[1]);
    return path.split('/').some(part => part === '..' || part === '.') ? null : path;
  } catch { return null; }
}

export function photoDimensions(width: number, height: number, box = 64) {
  const scale = box / Math.max(width, height);
  return { width: width * scale, height: height * scale };
}