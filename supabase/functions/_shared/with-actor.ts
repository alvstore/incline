// v1.1.0 — Stamp the real caller's identity on audit_logs via PostgREST request headers.
//
// PostgREST exposes the incoming request header set as a per-request GUC
// (`request.headers`). The audit trigger reads `x-actor-id`, `x-actor-name`,
// and `x-actor-source` from there. This survives PgBouncer / Supavisor pooling
// because the headers are bound to the HTTP request, not the connection.
//
// Usage:
//   const supabase = createActorClient(serviceRoleClient, actorId, actorName, 'create-staff-user');
//   await supabase.from('trainers').insert(...)   // audit row now has real actor
//
// For one-off RPC paths (cron, triggers cascading from SECURITY DEFINER) call
// `audit_set_actor(p_actor_id, p_actor_name, p_source)` RPC instead.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

export interface ActorIdentity {
  actor_id: string | null;
  actor_name: string | null;
  source: string;
}

/** Resolve actor identity from the inbound user JWT (best-effort, never throws). */
export async function resolveActor(
  admin: SupabaseClient,
  authHeader: string | null,
  source: string,
): Promise<ActorIdentity> {
  let actor_id: string | null = null;
  let actor_name: string | null = null;

  try {
    const token = (authHeader || '').replace(/^Bearer\s+/i, '').trim();
    if (token) {
      const { data } = await admin.auth.getUser(token);
      const u = data?.user;
      if (u?.id) {
        actor_id = u.id;
        const { data: prof } = await admin
          .from('profiles')
          .select('full_name')
          .eq('id', u.id)
          .maybeSingle();
        actor_name = (prof?.full_name as string | undefined) || u.email || null;
      }
    }
  } catch { /* swallow */ }

  return { actor_id, actor_name, source };
}

/** Build a service-role client whose PostgREST writes carry x-actor-* headers
 *  so the audit trigger records the real user instead of "System". */
export function createActorClient(actor: ActorIdentity): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const headers: Record<string, string> = {
    'x-actor-source': actor.source,
  };
  if (actor.actor_id) headers['x-actor-id'] = actor.actor_id;
  if (actor.actor_name) headers['x-actor-name'] = actor.actor_name;
  return createClient(supabaseUrl, serviceKey, { global: { headers } });
}

/** Convenience: parse auth header → resolve actor → return tagged admin client. */
export async function createAdminClientForRequest(
  authHeader: string | null,
  source: string,
): Promise<{ admin: SupabaseClient; actor: ActorIdentity }> {
  const bootstrap = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const actor = await resolveActor(bootstrap, authHeader, source);
  return { admin: createActorClient(actor), actor };
}
