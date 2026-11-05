// v2.1.0 — Website chat turns answered from shared ai_knowledge and stored in the CRM inbox (web_chat).
// v2.0.0 — Logic moved to _shared/websiteLeadCapture.ts. Adds Website Chatbot intake
//          (returns lead reference), honeypot, hashed-IP rate limit, slug-only branch
//          resolution, WhatsApp-only consent and suppress_lead_welcome for chatbot leads.
//          Embed form response contract unchanged.
// v1.2.1 — identical response for new, existing lead and existing member (no enumeration).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleCaptureLead, hashKey } from '../_shared/websiteLeadCapture.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const contentLength = parseInt(req.headers.get('content-length') || '0');
    if (contentLength > 32768) return json({ error: 'Request too large' }, 413);

    let body: unknown;
    try { body = await req.json(); } catch { return json({ error: 'Invalid request' }, 400); }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const ip = req.headers.get('cf-connecting-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null;

    const result = await handleCaptureLead(body, { ip, userAgent: req.headers.get('user-agent') }, {
      db: supabase,
      rateLimit: async (clientIp) => {
        if (!clientIp) return true;
        const { data, error } = await supabase.rpc('hit_public_form_rate_limit', {
          p_key: `capture-lead:${await hashKey(clientIp)}`, p_limit: 8, p_window_seconds: 600,
        });
        return error ? true : data !== false; // fail open: light protection only
      },
      chatRateLimit: async (clientIp) => {
        if (!clientIp) return true;
        const { data, error } = await supabase.rpc('hit_public_form_rate_limit', {
          p_key: `web-chat:${await hashKey(clientIp)}`, p_limit: 60, p_window_seconds: 600,
        });
        return error ? true : data !== false;
      },
      notify: (args) => {
        fetch(`${supabaseUrl}/functions/v1/notify-lead-created`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify(args),
        }).catch(() => console.error('[capture-lead] notification dispatch failed'));
      },
    });
    return json(result.body, result.status);
  } catch {
    console.error('[capture-lead] unexpected error');
    return json({ error: 'An unexpected error occurred' }, 500);
  }
});
