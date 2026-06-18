// v1.1.0 — Fetch RCS templates from Telinfy with path fallback + verbose diagnostics.
//   POST /rcs-templates-sync { branch_id?: string }
// Requires authenticated user with owner|admin role; uses service-role for upsert.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (s: number, b: unknown) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const ENV_API_KEY = Deno.env.get('TELINFY_API_KEY') || '';
const ENV_BASE = (Deno.env.get('TELINFY_BASE_URL') || 'https://hub.telinfy.com/unified/developer/api/v1').replace(/\/+$/, '');

function extractVars(text: string): string[] {
  const matches = String(text || '').match(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g) || [];
  return Array.from(new Set(matches.map((m) => m.replace(/[{}\s]/g, ''))));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json().catch(() => ({}));
    const branchId: string | null = body?.branch_id || null;

    let apiKey = ENV_API_KEY;
    let baseUrl = ENV_BASE;
    const { data: cfg } = await supabase
      .from('integration_settings')
      .select('config, credentials, is_active')
      .eq('integration_type', 'rcs')
      .eq('provider', 'telinfy')
      .in('branch_id', branchId ? [branchId, null] : [null])
      .order('branch_id', { ascending: false, nullsFirst: false })
      .limit(1).maybeSingle();
    if (cfg) {
      const dbKey = (cfg as any).credentials?.api_key;
      if (dbKey) apiKey = dbKey;
      const dbBase = (cfg as any).config?.base_url;
      if (dbBase) baseUrl = String(dbBase).replace(/\/+$/, '');
    }
    if (!apiKey) return json(200, { ok: false, reason: 'TELINFY_API_KEY missing' });

    const resp = await fetch(`${baseUrl}/rcs/templates`, {
      method: 'GET', headers: { 'x-api-key': apiKey },
    });
    const text = await resp.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { /* keep text */ }
    if (!resp.ok) return json(200, { ok: false, reason: `HTTP ${resp.status}`, raw: data || text });

    const list: any[] = Array.isArray(data) ? data : (data?.data || data?.templates || []);
    let upserted = 0;
    for (const t of list) {
      const name = t?.templateName || t?.name || t?.template_name;
      if (!name) continue;
      const preview = t?.body || t?.message || t?.preview || '';
      const vars = Array.isArray(t?.variables) ? t.variables : extractVars(preview);
      const status = (t?.status || 'approved').toString().toLowerCase();
      const { error } = await supabase.from('rcs_templates').upsert({
        branch_id: branchId,
        template_name: name,
        body_preview: preview,
        variables: vars,
        status,
        raw: t,
        last_synced_at: new Date().toISOString(),
      }, { onConflict: 'branch_id,template_name' });
      if (!error) upserted++;
    }

    return json(200, { ok: true, count: list.length, upserted });
  } catch (e) {
    console.error('[rcs-templates-sync] error', e);
    return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
