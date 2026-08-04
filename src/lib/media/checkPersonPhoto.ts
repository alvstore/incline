/**
 * Pre-flight validation for biometric / avatar photos.
 *
 * The turnstiles accept a photo from the MIPS server and then silently discard
 * it when they cannot build a face template — the server still answers 200, so
 * the failure only surfaces days later as a gate that will not recognise the
 * member. Catching unusable images at upload time is the only honest fix.
 *
 * Browsers cannot reliably detect a face without shipping a model, so we check
 * what is verifiable and cheap: decodable image, sane resolution and aspect
 * ratio. `FaceDetector` is used opportunistically when the browser exposes it.
 */
export interface PhotoCheckResult {
  ok: boolean;
  reason?: string;
  width: number;
  height: number;
}

const MIN_EDGE = 400;
const MAX_ASPECT = 2.2;

export async function checkPersonPhoto(file: File): Promise<PhotoCheckResult> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode failed"));
      el.src = url;
    }).catch(() => null);

    if (!img) {
      return { ok: false, reason: "This file could not be read as an image.", width: 0, height: 0 };
    }

    const width = img.naturalWidth;
    const height = img.naturalHeight;

    if (Math.min(width, height) < MIN_EDGE) {
      return {
        ok: false,
        width,
        height,
        reason: `Photo is too small (${width}×${height}). The gates need at least ${MIN_EDGE}px on the shortest side to build a face template.`,
      };
    }

    const aspect = Math.max(width / height, height / width);
    if (aspect > MAX_ASPECT) {
      return {
        ok: false,
        width,
        height,
        reason: "Photo is too wide or too tall — use a straight-on portrait, roughly square.",
      };
    }

    // Opportunistic face check (Chromium behind a flag; absent elsewhere).
    const FD = (globalThis as unknown as { FaceDetector?: new (o?: unknown) => { detect: (i: unknown) => Promise<unknown[]> } }).FaceDetector;
    if (FD) {
      try {
        const faces = await new FD({ fastMode: true }).detect(img);
        if (Array.isArray(faces)) {
          if (faces.length === 0) {
            return { ok: false, width, height, reason: "No face detected in this photo. Use a clear, front-facing portrait." };
          }
          if (faces.length > 1) {
            return { ok: false, width, height, reason: "More than one face detected. The gates need a photo of one person only." };
          }
        }
      } catch {
        // Detector unavailable at runtime — fall through to the size checks.
      }
    }

    return { ok: true, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
