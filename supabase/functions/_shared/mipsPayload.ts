// mipsPayload.ts v1.0.0 — keep gate-scan payloads small before they land in access_logs.
//
// MIPS face terminals post the recognised frame as base64 (imgBase64 / imgUri /
// checkImgUri, ~55 kB each). Nothing in the app reads those blobs, yet they made
// access_logs 85% of the whole database (2.5 GB) and turned every Live Access
// Feed load into a 3-4 MB download. Strip them (and the device token) at write
// time; `prune_access_log_media()` in the database is the nightly safety net.

const MAX_INLINE_STRING = 2048;

// Keys that are credentials or always-binary, dropped regardless of size.
const ALWAYS_DROP = new Set(["imgbase64", "base64", "token", "imagebase64", "photobase64", "facefeature", "feature"]);

// Keys that may hold either a URL (keep) or an inline base64 frame (drop).
const URL_OR_BLOB = new Set(["imguri", "img_uri", "checkimguri", "check_img_uri", "path", "snapshot", "picurl", "photourl"]);

function looksLikeUrlOrPath(v: string): boolean {
  if (v.length > 1024) return false;
  return /^(https?:\/\/|\/|[a-z0-9_-]+\/)/i.test(v) && !/^\/9j\//.test(v);
}

export interface StrippedScanPayload {
  payload: Record<string, unknown>;
  /** Total bytes of media removed (0 when the terminal sent none). */
  mediaBytesRemoved: number;
  /** A capture existed on the original event (useful for audits even though the frame is not stored). */
  hadCapture: boolean;
}

export function stripScanMedia(input: unknown): StrippedScanPayload {
  const out: Record<string, unknown> = {};
  let removed = 0;
  let hadCapture = false;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { payload: out, mediaBytesRemoved: 0, hadCapture: false };
  }
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const k = key.toLowerCase();
    if (ALWAYS_DROP.has(k)) {
      if (typeof value === "string" && value.length > 0) {
        removed += value.length;
        if (k !== "token") hadCapture = true;
      }
      continue;
    }
    if (typeof value === "string") {
      if (URL_OR_BLOB.has(k) && !looksLikeUrlOrPath(value)) {
        removed += value.length;
        hadCapture = true;
        continue;
      }
      if (value.length > MAX_INLINE_STRING) {
        removed += value.length;
        hadCapture = true;
        continue;
      }
    }
    out[key] = value;
  }
  return { payload: out, mediaBytesRemoved: removed, hadCapture };
}

/** Returns `uri` only when it is a real URL/path (never an inline base64 frame). */
export function urlOnly(uri: string | null | undefined): string | null {
  if (!uri) return null;
  return looksLikeUrlOrPath(uri) ? uri : null;
}
