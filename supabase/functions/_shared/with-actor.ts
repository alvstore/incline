// v1.0.0 — Pin the real caller's identity on audit_logs rows.
// Edge functions running with the service-role key bypass auth.uid(), so the
// audit trigger would record actor_name='System'. Call setAuditActor() once
// per request to forward the JWT user's id + name to the trigger via GUCs.
//
// Usage:
//   const supabase = createClient(url, serviceKey);
//   await setAuditActor(supabase, req.headers.get('Authorization'), 'create-staff-user');

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

export async function setAuditActor(
  supabase: SupabaseClient,
  authHeader: string | null,
  source: string,
): Promise<{ actor_id: string | null; actor_name: string | null }> {
  let actor_id: string | null = null;
  let actor_name: string | null = null;

  try {
    const token = (authHeader || '').replace(/^Bearer\s+/i, '').trim();
    if (token) {
      const { data: userData } = await supabase.auth.getUser(token);
      const u = userData?.user;
      if (u?.id) {
        actor_id = u.id;
        // Prefer profiles.full_name, fall back to email.
        const { data: prof } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', u.id)
          .maybeSingle();
        actor_name = (prof?.full_name as string | undefined) || u.email || null;
      }
    }
  } catch {
    // best-effort; never block the request
  }

  try {
    await supabase.rpc('audit_set_actor', {
      p_actor_id: actor_id,
      p_actor_name: actor_name,
      p_source: source,
    });
  } catch {
    // ignore — audit context is best-effort
  }

  return { actor_id, actor_name };
}
