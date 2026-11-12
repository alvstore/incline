/**
 * Decide whether an uploaded logo is predominantly dark, so it can be shown
 * as a light silhouette on dark surfaces (sidebar, dark-mode header) instead
 * of disappearing. Only visible pixels count; transparent padding is ignored.
 */
export type LogoTone = 'dark' | 'light' | 'unknown';

/** Below this mean luminance (0–255) a logo reads as dark-on-transparent. */
export const DARK_LOGO_THRESHOLD = 90;

export function logoToneFromPixels(rgba: ArrayLike<number>): LogoTone {
  let weight = 0;
  let sum = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255;
    if (a < 0.2) continue;
    const lum = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
    sum += lum * a;
    weight += a;
  }
  if (weight === 0) return 'unknown';
  return sum / weight < DARK_LOGO_THRESHOLD ? 'dark' : 'light';
}
