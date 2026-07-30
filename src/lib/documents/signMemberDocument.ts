import { supabase } from "@/integrations/supabase/client";

/**
 * Canonical helper for sensitive member document URL retrieval.
 *
 * - Always uses createSignedUrl — never getPublicUrl.
 * - Default TTL 60 s; hard cap 5 min so links can't be silently long-lived.
 * - Pass `bucket` only for non-default buckets ('member-documents' default).
 */
const DEFAULT_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 300;

export type SignableBucket =
  | "documents"
  | "member-photos"
  | "member-media"
  | "member-onboarding";

export async function signMemberDocument(
  path: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
  bucket: SignableBucket = "documents",
): Promise<string> {
  if (!path) throw new Error("signMemberDocument: path is required");
  const ttl = Math.min(Math.max(ttlSeconds, 30), MAX_TTL_SECONDS);

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, ttl);

  if (error || !data?.signedUrl) {
    throw new Error(
      `Failed to sign document (${bucket}/${path}): ${error?.message ?? "unknown"}`,
    );
  }
  return data.signedUrl;
}
