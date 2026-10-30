// v1.1.0 — Hands out 24-hour signed links for exercise demo media (streaming-safe).
// Staff/trainers always; members only when their branch switch is on AND the
// requested file belongs to one of their own active workout plans.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const BUCKET = 'inclineexercisedb';
const TTL = 86400; // keep in sync with SIGNED_TTL_SECONDS in src/lib/exercises/exerciseMedia.ts
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const auth = req.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
    const url = Deno.env.get('SUPABASE_URL')!;
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: claims, error: cErr } = await userClient.auth.getClaims(auth.slice(7));
    if (cErr || !claims?.claims?.sub) return json({ error: 'Unauthorized' }, 401);
    const userId = claims.claims.sub as string;

    const body = await req.json().catch(() => null);
    const paths: unknown = body?.paths;
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > 60) return json({ error: 'paths must be 1-60 items' }, 400);
    const clean = [...new Set(paths.filter((p): p is string =>
      typeof p === 'string' && p.startsWith('exercisedb/') && !p.includes('..') && p.length < 300))];
    if (clean.length === 0) return json({ error: 'No valid paths' }, 400);

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: visible } = await admin.rpc('exercise_demos_visible_for', { _user_id: userId });
    if (!visible) return json({ error: 'Exercise demos are not available', code: 'demos_off' }, 403);

    const { data: roleRows } = await admin.from('user_roles').select('role').eq('user_id', userId)
      .in('role', ['owner', 'admin', 'manager', 'trainer', 'staff']).limit(1);
    const isStaff = (roleRows?.length ?? 0) > 0;
    let allowed = clean;
    if (!isStaff) {
      const { data: member } = await admin.from('members').select('id').eq('user_id', userId).maybeSingle();
      if (!member) return json({ error: 'Forbidden' }, 403);
      const today = new Date().toISOString().slice(0, 10);
      const { data: plans } = await admin.from('member_fitness_plans').select('plan_data')
        .eq('member_id', member.id).eq('plan_type', 'workout')
        .or(`valid_until.is.null,valid_until.gte.${today}`);
      const blob = JSON.stringify((plans ?? []).map((p) => p.plan_data));
      allowed = clean.filter((p) => blob.includes(p));
    }
    if (allowed.length === 0) return json({ urls: {} });

    const { data: signed, error } = await admin.storage.from(BUCKET).createSignedUrls(allowed, TTL);
    if (error) throw error;
    const urls: Record<string, string> = {};
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls[s.path] = s.signedUrl;
    return json({ urls, expires_in: TTL });
  } catch (e) {
    console.error('exercise-media-sign failed', e);
    return json({ error: 'Could not prepare exercise media' }, 500);
  }
});
