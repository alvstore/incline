import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Fitness plan / generic attachment links.
 *
 * The `attachments` bucket is PRIVATE. Historic rows stored a public-style
 * object URL (`/storage/v1/object/attachments/...`) which the storage API
 * rejects with 400, and newer rows stored a 30-day signed URL that eventually
 * expires. Both cases are fixed by re-deriving the object path and minting a
 * fresh short-lived signed URL at view time.
 */
const DEFAULT_TTL_SECONDS = 10 * 60;
const BUCKET = 'attachments';

/** Derive the storage object path from a stored URL or raw path. */
export function attachmentPathFromStored(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const value = stored.trim();
  if (!value) return null;

  if (!/^https?:\/\//i.test(value)) {
    // Already a path — tolerate a leading bucket prefix.
    return value.replace(/^\/+/, '').replace(new RegExp(`^${BUCKET}/`), '');
  }

  try {
    const url = new URL(value);
    const marker = `/${BUCKET}/`;
    const idx = url.pathname.indexOf(marker);
    if (idx === -1) return null;
    return decodeURIComponent(url.pathname.slice(idx + marker.length));
  } catch {
    return null;
  }
}

/**
 * Returns a freshly signed, short-lived URL for an attachment.
 * Falls back to the stored value when the path can't be derived or signed
 * (e.g. the file lives on an external CDN).
 */
export async function signAttachmentUrl(
  stored: string | null | undefined,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<string | null> {
  if (!stored) return null;
  const path = attachmentPathFromStored(stored);
  if (!path) return stored;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, Math.min(Math.max(ttlSeconds, 60), 60 * 60));

  if (error || !data?.signedUrl) {
    return /^https?:\/\//i.test(stored) ? stored : null;
  }
  return data.signedUrl;
}

/** React Query wrapper so components can render a link without effects. */
export function useSignedAttachment(stored: string | null | undefined) {
  const query = useQuery({
    queryKey: ['signed-attachment', stored ?? null],
    queryFn: () => signAttachmentUrl(stored),
    enabled: Boolean(stored),
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });

  return {
    url: query.data ?? null,
    isLoading: Boolean(stored) && query.isLoading,
    isError: query.isError,
  };
}
