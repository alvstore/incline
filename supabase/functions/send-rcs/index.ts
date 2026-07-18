// v0.5.0 — Unified RCS dispatcher. Routes to Telinfy or Smartping via _shared/rcsProviders.
//   POST /send-rcs { branch_id?, recipient, template_name?, template_id?, variables?, message?, log_id?, provider? }
// Caller contract preserved — dispatch-communication continues to invoke this.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendRcs, type RcsProviderName } from '../_shared/rcsProviders.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (s: number, b: unknown) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json().catch(() => ({}));
    const { branch_id, recipient, template_name, template_id, variables, message, log_id, provider, components } = body ?? {};
    if (!recipient) return json(400, { status: 'failed', reason: 'missing recipient' });

    // If provider not passed but template_id (UUID) is present, hint Smartping.
    const hint: RcsProviderName | undefined =
      (provider as RcsProviderName) ||
      (template_id && /^[0-9a-f-]{16,}$/i.test(String(template_id)) ? 'smartping' : undefined);

    const result = await sendRcs(supabase, branch_id ?? null, {
      recipient, template_id, template_name, variables, message, log_id, components,
    }, hint);

    if (log_id && result.status === 'sent') {
      await supabase.from('communication_logs')
        .update({
          provider_message_id: result.provider_message_id || null,
          provider_record_id: result.provider_record_id || null,
          delivery_status: 'sent',
          sent_at: new Date().toISOString(),
        })
        .eq('id', log_id);
    }

    console.log(`[send-rcs] provider=${result.provider} status=${result.status} to=${recipient}`);
    return json(200, result);
  } catch (e) {
    console.error('[send-rcs] error', e);
    return json(500, { status: 'failed', reason: e instanceof Error ? e.message : String(e) });
  }
});
