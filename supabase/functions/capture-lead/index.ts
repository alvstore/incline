// v1.2.0 — phoneVariants dedupe (leads + members)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizePhone, phoneVariants } from '../_shared/phone.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 255;
const MAX_PHONE_LENGTH = 20;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+?[0-9]{10,15}$/;

function sanitize(str: string, max: number): string {
  return str.trim().replace(/[\u0000-\u001F\u007F-\u009F]/g, '').slice(0, max);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const contentLength = parseInt(req.headers.get('content-length') || '0');
    if (contentLength > 10240) {
      return new Response(JSON.stringify({ error: 'Request too large' }), { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json();

    const fullName = sanitize(body.fullName || '', MAX_NAME_LENGTH);
    const phoneRaw = (body.phone || '').replace(/[\s\-\(\)]/g, '').slice(0, MAX_PHONE_LENGTH);
    const phone = normalizePhone(phoneRaw) || phoneRaw;
    const email = body.email ? sanitize(body.email, MAX_EMAIL_LENGTH) : null;

    if (!fullName || fullName.length < 2) {
      return new Response(JSON.stringify({ error: 'Name is required (min 2 chars)' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!phone || phone.length < 10 || !PHONE_REGEX.test(phone)) {
      return new Response(JSON.stringify({ error: 'Valid phone number is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (email && !EMAIL_REGEX.test(email)) {
      return new Response(JSON.stringify({ error: 'Invalid email format' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Duplicate check across all phone variants — also block if a member exists
    const variants = phoneVariants(phone);
    const { data: existing } = await supabase.from('leads').select('id').in('phone', variants).limit(1).maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ success: true, message: 'Thank you! We will contact you soon.' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { data: existingMember } = await supabase.from('profiles').select('id').in('phone', variants).limit(1).maybeSingle();
    if (existingMember) {
      return new Response(JSON.stringify({ success: true, message: 'Thank you! We already have your details on file.' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Branch resolution: explicit > slug > first active
    let branchId = body.branch_id || null;
    if (!branchId && body.branch_slug) {
      const { data: slugBranch } = await supabase.from('branches').select('id').eq('code', body.branch_slug).eq('is_active', true).maybeSingle();
      if (slugBranch) branchId = slugBranch.id;
    }
    if (!branchId) {
      const { data: defaultBranch } = await supabase.from('branches').select('id').eq('is_active', true).limit(1).single();
      if (!defaultBranch) {
        return new Response(JSON.stringify({ error: 'Service temporarily unavailable' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      branchId = defaultBranch.id;
    }

    // Determine source and UTM data
    const source = (body.source || body.utm_source || 'website').toLowerCase().slice(0, 50);
    const utmSource = (body.utm_source || '').slice(0, 100) || null;
    const utmMedium = (body.utm_medium || '').slice(0, 100) || null;
    const utmCampaign = (body.utm_campaign || '').slice(0, 100) || null;
    const utmContent = (body.utm_content || '').slice(0, 100) || null;
    const utmTerm = (body.utm_term || '').slice(0, 100) || null;
    const landingPage = (body.landing_page || '').slice(0, 500) || null;
    const referrerUrl = (body.referrer_url || '').slice(0, 500) || null;

    const { data: lead, error: leadError } = await supabase.from('leads').insert({
      full_name: fullName,
      phone,
      email,
      source,
      branch_id: branchId,
      status: 'new',
      temperature: 'warm',
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      landing_page: landingPage,
      referrer_url: referrerUrl,
    }).select('id').single();

    if (leadError) {
      console.error('Failed to create lead:', leadError);
      return new Response(JSON.stringify({ error: 'Failed to submit. Please try again.' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log('Lead captured:', lead.id, 'source:', source, 'branch:', branchId);

    // Record opt-in consent (RCS/SMS/Email/WhatsApp) — MSG91 / TRAI audit evidence.
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
          p_source: consent.source || source || 'capture_lead',
          p_consent_text: consent.text || null,
          p_ip: ip,
          p_user_agent: ua,
          p_action: 'grant',
        });
      }
    } catch (e) {
      console.error('record_consent failed (non-fatal):', e);
    }


    // Fire-and-forget: trigger lead notifications via unified dispatcher
    try {
      const notifyUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/notify-lead-created`;
      fetch(notifyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({ lead_id: lead.id, branch_id: branchId }),
      }).catch(e => console.error('Lead notification dispatch failed:', e));
    } catch (e) {
      console.error('Lead notification setup error:', e);
    }

    return new Response(JSON.stringify({ success: true, message: 'Thank you! We will contact you soon.' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Capture lead error:', error);
    return new Response(JSON.stringify({ error: 'An unexpected error occurred' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
