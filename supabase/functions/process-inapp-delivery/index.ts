// v1.0.0 — Durable, audience-scoped In-App delivery for immediate and scheduled posts.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';
import { requireCaller } from '../_shared/requireCaller.ts';
import { captureEdgeError } from '../_shared/capture-edge-error.ts';
import { deliverBatch, type DeliveryBatch } from './delivery.ts';

const schema = z.object({ announcement_id: z.string().uuid().optional() }).strict();
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const caller = await requireCaller(req, corsHeaders, { roles: ['owner', 'admin', 'manager'] });
    if (!caller.ok) return caller.response;
    let body: unknown;
    try { body = await req.json(); } catch { return json({ error: 'invalid_input', message: 'Body must be valid JSON' }, 400); }
    const parsed = schema.safeParse(body);
    if (!parsed.success) return json({ error: 'invalid_input', message: 'Invalid delivery request' }, 400);
    const id = parsed.data.announcement_id;
    if (!caller.internal) {
      if (!id || !caller.userId) return json({ error: 'forbidden', message: 'An announcement is required' }, 403);
      // Use the user's RLS context, including the selected branch, before using internal claims.
      const url = Deno.env.get('SUPABASE_URL');
      const key = Deno.env.get('SUPABASE_ANON_KEY');
      if (!url || !key) throw new Error('Missing configuration');
      const response = await fetch(`${url}/rest/v1/announcements?id=eq.${id}&select=id,created_by,targeted_delivery`, {
        headers: { apikey: key, Authorization: req.headers.get('authorization') ?? '' },
      });
      const rows = response.ok ? await response.json() : [];
      if (!Array.isArray(rows) || !rows.some((r) => r.created_by === caller.userId && r.targeted_delivery)) {
        return json({ error: 'forbidden', message: 'Announcement not available' }, 403);
      }
    }
    const started = Date.now();
    let processed = 0;
    for (let i = 0; i < 10 && Date.now() - started < 45000; i++) {
      const { data, error } = await caller.admin.rpc('claim_inapp_delivery', { p_announcement_id: id ?? null });
      if (error) throw error;
      if (!data) break;
      const batch = data as DeliveryBatch;
      const results = await deliverBatch(batch, async (input) => {
        const { data: result, error: dispatchError } = await caller.admin.functions.invoke('dispatch-communication', { body: input });
        if (dispatchError) throw dispatchError;
        return result;
      });
      const finished = await caller.admin.rpc('finish_inapp_delivery', {
        p_announcement_id: batch.announcement_id, p_claim_token: batch.claim_token, p_results: results,
      });
      if (finished.error) throw finished.error;
      processed += results.length;
    }
    return json({ accepted: true, processed });
  } catch (error) {
    await captureEdgeError('process-inapp-delivery', error);
    return json({ error: 'internal_error', message: 'Delivery will be retried safely' }, 500);
  }
});