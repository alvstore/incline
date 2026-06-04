// v0.1.0 — RCS dispatcher stub (Telinfy / GreenAds Global / MSG91 RCS).
// Wired into the universal dispatcher path. Returns `not_configured` until a
// credentials row is saved in `integration_settings` (provider='telinfy',
// integration_type='rcs'). Actual send implementation lands in a follow-up
// once the API key + sender ID are provisioned.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const { branch_id, recipient, message } = body ?? {};
    if (!recipient || !message) {
      return json(400, { status: 'failed', reason: 'missing recipient/message' });
    }

    // Resolve creds: branch-scoped, fall back to global.
    const { data: cfgRow } = await supabase
      .from('integration_settings')
      .select('config, is_active')
      .eq('integration_type', 'rcs')
      .eq('provider', 'telinfy')
      .in('branch_id', branch_id ? [branch_id, null] : [null])
      .order('branch_id', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (!cfgRow?.is_active || !cfgRow?.config) {
      return json(200, { status: 'not_configured', reason: 'RCS provider not configured' });
    }

    // TODO: implement actual Telinfy/GreenAds RCS API call once credentials & sender ID confirmed.
    // Endpoints from the Postman collection:
    //   POST {base_url}/rcs/send/text     (auth: Bearer api_key)
    //   POST {base_url}/rcs/send/card
    //   webhook (DLR) → separate receiver edge fn
    return json(200, {
      status: 'queued',
      reason: 'RCS provider configured but send implementation pending',
      provider: 'telinfy',
    });
  } catch (e) {
    console.error('send-rcs error', e);
    return json(500, { status: 'failed', reason: e instanceof Error ? e.message : String(e) });
  }
});
