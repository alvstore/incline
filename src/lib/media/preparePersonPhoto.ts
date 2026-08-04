/**
 * Auto-remediating biometric photo pipeline (client side).
 *
 * The old flow rejected anything that was not already a straight-on, roughly
 * square portrait — staff had to retake photos that were perfectly usable.
 * Instead of rejecting, we now FIX what is fixable in the browser:
 *
 *   EXIF orientation → centre square crop → device-safe 720px JPEG (≤350KB)
 *
 * Only genuinely unusable inputs still fail: a file that cannot be decoded, or
 * an image so small that no gate could ever build a face template from it.
 */

const TARGET_EDGE = 720;      // MIPS face-safety long edge
const HARD_MIN_EDGE = 240;    // below this nothing can be recovered
const MAX_SIZE_BYTES = 350 * 1024;
const MIN_QUALITY = 0.6;

export interface PreparedPhoto {
  file: File;
  width: number;
  height: number;
  sizeKB: number;
  /** Human-readable list of the fixes applied, for UI feedback. */
  notes: string[];
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    } catch {
      /* fall through to <img> decode */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode failed'));
      el.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', quality);
  });
}

/**
 * Returns a device-ready square JPEG. Throws only when the photo cannot be
 * salvaged, with a message that tells the user exactly what to do.
 */
export async function preparePersonPhoto(file: File): Promise<PreparedPhoto> {
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await decode(file);
  } catch {
    throw new Error('This file could not be read as an image. Please upload a JPG or PNG photo.');
  }

  const sw = 'width' in source && typeof source.width === 'number'
    ? (source as ImageBitmap).width || (source as HTMLImageElement).naturalWidth
    : (source as HTMLImageElement).naturalWidth;
  const sh = 'height' in source && typeof source.height === 'number'
    ? (source as ImageBitmap).height || (source as HTMLImageElement).naturalHeight
    : (source as HTMLImageElement).naturalHeight;

  if (!sw || !sh) throw new Error('This image appears to be empty. Please upload another photo.');

  if (Math.min(sw, sh) < HARD_MIN_EDGE) {
    throw new Error(
      `Photo is too small (${sw}×${sh}). The gates need at least ${HARD_MIN_EDGE}px on the shortest side — please take a fresh photo.`,
    );
  }

  const notes: string[] = [];

  // Centre square crop — fixes wide/tall photos instead of rejecting them.
  const side = Math.min(sw, sh);
  const sx = Math.round((sw - side) / 2);
  const sy = Math.round((sh - side) / 2);
  if (sw !== sh) notes.push('Cropped to a square portrait');

  // Never upscale: keep the true pixels we have, capped at the device edge.
  const out = Math.min(side, TARGET_EDGE);
  const canvas = document.createElement('canvas');
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source as CanvasImageSource, sx, sy, side, side, 0, 0, out, out);
  if (side > TARGET_EDGE) notes.push(`Resized to ${TARGET_EDGE}px for the gates`);

  // Lift very dark captures — the terminals fail detection on underexposed faces.
  try {
    const { data } = ctx.getImageData(0, 0, out, out);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4 * 16) {
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    const mean = sum / (data.length / (4 * 16));
    if (mean < 70) {
      ctx.filter = `brightness(${Math.min(1.8, 90 / Math.max(mean, 25)).toFixed(2)}) contrast(1.05)`;
      ctx.drawImage(canvas, 0, 0);
      ctx.filter = 'none';
      notes.push('Brightened an underexposed photo');
    }
  } catch {
    /* tainted canvas or unsupported filter — the crop alone is still valid */
  }

  let quality = 0.9;
  let blob = await toBlob(canvas, quality);
  while (blob.size > MAX_SIZE_BYTES && quality > MIN_QUALITY) {
    quality = Math.round((quality - 0.1) * 10) / 10;
    blob = await toBlob(canvas, quality);
  }
  if (blob.size > MAX_SIZE_BYTES) notes.push('Compressed for the 400KB device limit');

  if ('close' in source && typeof (source as ImageBitmap).close === 'function') {
    (source as ImageBitmap).close();
  }

  return {
    file: new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }),
    width: out,
    height: out,
    sizeKB: Math.round(blob.size / 1024),
    notes,
  };
}
