import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * One photo-picking rule for every attendance screen:
 * permanent profile photo → permanent gate photo → fresh link for the stored gate photo → initials.
 * Signed storage links expire, so they are never used as a stored photo.
 */
export function isTemporaryPhotoUrl(url: string | null | undefined): boolean {
  return !!url && url.includes('/object/sign/');
}

export interface AvatarSources {
  profileAvatar?: string | null;
  biometricUrl?: string | null;
  biometricPath?: string | null;
}

/** Permanent URL to show, or the gate-photo path that still needs a fresh link. */
export function pickAvatar(s: AvatarSources): { url: string | null; path: string | null } {
  for (const u of [s.profileAvatar, s.biometricUrl]) {
    if (u && !isTemporaryPhotoUrl(u)) return { url: u, path: null };
  }
  return { url: null, path: s.biometricPath || null };
}

const BUCKET = 'member-photos';

/** Fresh view links for stored gate photos, one request per screen load, cached ~50 min. */
export function useSignedBiometricBatch(paths: Array<string | null | undefined>) {
  const unique = [...new Set(paths.filter((p): p is string => !!p))].sort().slice(0, 100);
  const { data } = useQuery({
    queryKey: ['signed-biometric-batch', unique],
    enabled: unique.length > 0,
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(unique, 60 * 60);
      if (error) return {} as Record<string, string>;
      const out: Record<string, string> = {};
      for (const r of data ?? []) if (r.path && r.signedUrl) out[r.path] = r.signedUrl;
      return out;
    },
  });
  return data ?? {};
}

/** Final image URL for a person, given resolved sources and a signed-link map. */
export function avatarSrc(s: AvatarSources, signed: Record<string, string>): string | null {
  const { url, path } = pickAvatar(s);
  return url ?? (path ? signed[path] ?? null : null);
}
