import { useEffect, useState } from 'react';
import { logoToneFromPixels, type LogoTone } from '@/lib/brand/logoTone';

const cache = new Map<string, LogoTone>();
const SAMPLE = 48;

/**
 * Samples the logo once per URL (cached for the session). Falls back to
 * 'unknown' when the image can't be read (e.g. a host without CORS), in which
 * case callers leave the logo untouched.
 */
export function useLogoTone(url: string | null | undefined): LogoTone {
  const [tone, setTone] = useState<LogoTone>(() => (url && cache.get(url)) || 'unknown');

  useEffect(() => {
    if (!url) { setTone('unknown'); return; }
    const hit = cache.get(url);
    if (hit) { setTone(hit); return; }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      let result: LogoTone = 'unknown';
      try {
        const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
        const w = Math.max(1, Math.round(ratio >= 1 ? SAMPLE : SAMPLE * ratio));
        const h = Math.max(1, Math.round(ratio >= 1 ? SAMPLE / ratio : SAMPLE));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          result = logoToneFromPixels(ctx.getImageData(0, 0, w, h).data);
        }
      } catch {
        result = 'unknown';
      }
      cache.set(url, result);
      if (!cancelled) setTone(result);
    };
    img.onerror = () => { cache.set(url, 'unknown'); if (!cancelled) setTone('unknown'); };
    img.src = url;
    return () => { cancelled = true; };
  }, [url]);

  return tone;
}
