// v1.2.0 — phoneVariants dedupe (leads + members)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizePhone, phoneVariants } from '../_shared/phone.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const url = new URL(req.url);
    const slug = url.searchParams.get('slug');
    const branchSlug = url.searchParams.get('branch_slug');
    const providedSecret = req.headers.get('x-webhook-secret');
    const webhookSecret = Deno.env.get('WEBHOOK_LEAD_SECRET');

    let authenticated = false;
    if (slug) {
      const { data: orgSettings } = await supabase.from('organization_settings').select('id').eq('webhook_slug', slug).maybeSingle();
      if (orgSettings) authenticated = true;
    }
    if (!authenticated && webhookSecret && providedSecret === webhookSecret) authenticated = true;

    if (!authenticated) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const contentLength = parseInt(req.headers.get('content-length') || '0');
    if (contentLength > 10240) {
      return new Response(JSON.stringify({ error: 'Request too large' }), { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json();

    const fullName = (body.full_name || body.fullName || body.name || '').trim().slice(0, 100);
    const phoneRaw = (body.phone || body.phone_number || body.mobile || '').replace(/[\s\-\(\)]/g, '').slice(0, 20);
    const phone = normalizePhone(phoneRaw) || phoneRaw;
    const email = (body.email || '').trim().slice(0, 255) || null;
    const source = (body.source || body.utm_source || body.platform || 'api').toLowerCase().slice(0, 50);
    const notes = (body.notes || body.message || '').slice(0, 500);

    // UTM data
    const utmSource = (body.utm_source || '').slice(0, 100) || null;
    const utmMedium = (body.utm_medium || '').slice(0, 100) || null;
    const utmCampaign = (body.utm_campaign || '').slice(0, 100) || null;
    const utmContent = (body.utm_content || '').slice(0, 100) || null;
    const utmTerm = (body.utm_term || '').slice(0, 100) || null;
    const landingPage = (body.landing_page || '').slice(0, 500) || null;
    const referrerUrl = (body.referrer_url || body.referrer || '').slice(0, 500) || null;

    if (!fullName || fullName.length < 2) {
      return new Response(JSON.stringify({ error: 'Name is required (min 2 chars)' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!phone || phone.length < 10) {
      return new Response(JSON.stringify({ error: 'Valid phone number is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Duplicate check across all phone variants
    const variants = phoneVariants(phone);
    const { data: existing } = await supabase.from('leads').select('id').in('phone', variants).limit(1).maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ success: true, message: 'Lead already exists', lead_id: existing.id }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { data: existingMember } = await supabase.from('profiles').select('id').in('phone', variants).limit(1).maybeSingle();
    if (existingMember) {
      return new Response(JSON.stringify({ success: true, message: 'Already a member' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Branch resolution: explicit > branch_slug param > body.branch_code > first active
    let branchId = body.branch_id || null;
    if (!branchId && (branchSlug || body.branch_code)) {
      const code = branchSlug || body.branch_code;
      const { data: b } = await supabase.from('branches').select('id').eq('code', code).eq('is_active', true).maybeSingle();
      if (b) branchId = b.id;
    }
    if (!branchId) {
      const { data: branch } = await supabase.from('branches').select('id').eq('is_active', true).limit(1).single();
      if (!branch) {
        return new Response(JSON.stringify({ error: 'No active branch found' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      branchId = branch.id;
    }

    const { data: lead, error: insertError } = await supabase.from('leads').insert({
      full_name: fullName,
      phone,
      email,
      source,
      branch_id: branchId,
      status: 'new',
      temperature: 'warm',
      notes,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      landing_page: landingPage,
      referrer_url: referrerUrl,
    }).select('id').single();

    if (insertError) {
      console.error('Failed to create lead:', insertError);
      return new Response(JSON.stringify({ error: 'Failed to create lead' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log('Webhook lead created:', lead.id, 'source:', source, 'branch:', branchId);

    // Record opt-in consent if provided (MSG91 / RCS / TRAI evidence).
    try {
      const consent = body.consent ?? null;
      if (consent && consent.granted === true) {
        const ip = req.headers.get('cf-connecting-ip')
          || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
          || null;
        const ua = req.headers.get('user-agent') || null;
        await supabase.rpc('record_consent', {
          p_subject_type: 'lead',
          p_subject_id: lead.id,
          p_channels: Array.isArray(consent.channels) ? consent.channels : ['sms','email','rcs','whatsapp'],
          p_source: consent.source || source || 'webhook_lead_capture',
          p_consent_text: consent.text || null,
          p_ip: ip,
          p_user_agent: ua,
          p_action: 'grant',
        });
      }
    } catch (e) {
      console.error('record_consent failed (non-fatal):', e);
    }

    // Build response immediately, defer heavy work (notifications, scoring, WhatsApp triggers)
    const response = new Response(
      JSON.stringify({ success: true, lead_id: lead.id }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );


    const heavyWork = (async () => {
      try {
        const notifyUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/notify-lead-created`;
        await fetch(notifyUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({ lead_id: lead.id, branch_id: branchId }),
        });
      } catch (e) {
        console.error('Lead notification dispatch failed:', e);
      }
    })();

    // @ts-ignore — EdgeRuntime is provided by Supabase Edge runtime
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(heavyWork);
    } else {
      // Fallback: don't await, but ensure it doesn't block
      heavyWork.catch(e => console.error('Lead heavy-work error:', e));
    }

    return response;
  } catch (error) {
    console.error('Webhook lead capture error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
