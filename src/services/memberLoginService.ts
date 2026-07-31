import { supabase } from '@/integrations/supabase/client';

export interface ProvisionLoginInput {
  memberId: string;
  email?: string | null;
  phone?: string | null;
  fullName?: string | null;
}

export interface ProvisionLoginResult {
  user_id: string;
  action: 'created' | 'linked_existing' | 'already_linked';
  email?: string | null;
  phone?: string | null;
  full_name?: string | null;
}

/**
 * Mint (or link) an auth login for a member that has none — typically a
 * lead→member conversion where `members.user_id` is still NULL.
 *
 * Throws an Error with a human-readable message on failure so callers can
 * surface the real reason instead of a generic toast.
 */
export async function provisionMemberLogin(
  input: ProvisionLoginInput,
): Promise<ProvisionLoginResult> {
  const { data, error } = await supabase.functions.invoke('provision-member-login', {
    body: {
      member_id: input.memberId,
      email: input.email || undefined,
      phone: input.phone || undefined,
      full_name: input.fullName || undefined,
    },
  });

  if (error) {
    // Supabase surfaces non-2xx as FunctionsHttpError; read the JSON body for
    // the real reason (identity_taken, no_email_or_phone, ...).
    let message = error.message || 'Failed to create member login';
    const ctx: any = (error as any).context;
    try {
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json();
        if (body?.message) message = body.message;
        else if (body?.error) message = body.error;
      }
    } catch {
      /* keep the transport-level message */
    }
    throw new Error(message);
  }

  if (!data?.user_id) {
    throw new Error(data?.message || data?.error || 'Login could not be created for this member');
  }

  return data as ProvisionLoginResult;
}
