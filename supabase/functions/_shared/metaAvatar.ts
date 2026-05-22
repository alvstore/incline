// v1.0.0 — Persist Meta (Instagram/Messenger) profile pictures into Supabase
// Storage so they survive Meta's short-lived CDN expirations. Returns a stable
// public URL under `avatars/meta/{platform}/{scoped_id}.{ext}`. Degrades to
// the original CDN URL when anything fails so webhooks never break.
//
// Bucket: existing public `avatars`. A SELECT policy is added in migration
// `20260522_meta_avatar_persistence.sql` for paths starting with `meta/`.

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB safety cap
const FETCH_TIMEOUT_MS = 5_000;

export type MetaPlatform = "instagram" | "messenger";
export type AvatarSource = "storage" | "meta_cdn" | "default";

export interface PersistAvatarArgs {
  scopedId: string;
  platform: MetaPlatform;
  cdnUrl: string;
  serviceClient: any; // supabase-js client with service role
}

export interface PersistAvatarResult {
  publicUrl: string;
  source: AvatarSource;
  syncedAt: string | null;
}

function extFromContentType(ct: string | null): string {
  if (!ct) return "jpg";
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  return "jpg";
}

export async function persistMetaAvatar(
  args: PersistAvatarArgs,
): Promise<PersistAvatarResult> {
  const { scopedId, platform, cdnUrl, serviceClient } = args;
  const fallback: PersistAvatarResult = {
    publicUrl: cdnUrl,
    source: "meta_cdn",
    syncedAt: null,
  };

  if (!scopedId || !cdnUrl || !serviceClient) return fallback;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const resp = await fetch(cdnUrl, { redirect: "follow", signal: ctrl.signal });
    clearTimeout(timer);

    if (!resp.ok) {
      console.warn(`[metaAvatar] fetch ${scopedId} → HTTP ${resp.status}`);
      return fallback;
    }
    const contentType = resp.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) {
      console.warn(`[metaAvatar] non-image content-type=${contentType}`);
      return fallback;
    }

    const buf = await resp.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) {
      console.warn(`[metaAvatar] size out of bounds: ${buf.byteLength} bytes`);
      return fallback;
    }

    const ext = extFromContentType(contentType);
    // Keep the path stable per contact so re-syncs reuse the same public URL.
    const path = `meta/${platform}/${scopedId}.${ext}`;

    const { error: upErr } = await serviceClient.storage
      .from("avatars")
      .upload(path, new Uint8Array(buf), {
        contentType,
        upsert: true,
        cacheControl: "86400",
      });
    if (upErr) {
      console.warn(`[metaAvatar] upload failed for ${path}: ${upErr.message}`);
      return fallback;
    }

    const { data: pub } = serviceClient.storage.from("avatars").getPublicUrl(path);
    if (!pub?.publicUrl) return fallback;

    const syncedAt = new Date().toISOString();
    // Cache-bust so React <img> refreshes when the underlying file changes.
    const publicUrl = `${pub.publicUrl}?v=${Date.parse(syncedAt)}`;
    return { publicUrl, source: "storage", syncedAt };
  } catch (e) {
    console.warn(
      `[metaAvatar] persist error for ${scopedId}:`,
      e instanceof Error ? e.message : String(e),
    );
    return fallback;
  }
}

/**
 * Detect Meta's "User consent is required" class of errors. These mean the
 * given IGSID belongs to someone who has not initiated a conversation with
 * the business (e.g. a comment-only contact) — Meta will never return a
 * profile for them. Caller should set `avatar_consent_blocked=true` and stop
 * retrying.
 */
export function isConsentBlockedError(err: any): boolean {
  if (!err) return false;
  const msg = String(err?.message || err?.error?.message || "").toLowerCase();
  const code = Number(err?.code ?? err?.error?.code ?? 0);
  const sub = Number(err?.error_subcode ?? err?.error?.error_subcode ?? 0);
  if (msg.includes("user consent is required")) return true;
  if (code === 10) return true; // permission denied — typically consent-class
  if (sub === 2018338) return true;
  return false;
}
