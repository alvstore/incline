// v1.2.0 — Fetch RCS templates from Telinfy. Handles grouped response
//          { richStandard, basicStandard, richDynamic, basicDynamic } and
//          populates `kind` + `media_url` per row so the UI can group/preview rich templates.
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

    const CANDIDATE_PATHS = ['/rcs/templates', '/rcs/template', '/rcs/templates/list', '/templates/rcs', '/rcs/templates/approved'];
    const attempts: Array<{ url: string; status: number; body: any }> = [];
    let data: any = null;
    let usedUrl = '';
    for (const p of CANDIDATE_PATHS) {
      const url = `${baseUrl}${p}`;
      const resp = await fetch(url, { method: 'GET', headers: { 'x-api-key': apiKey, 'Accept': 'application/json' } });
      const text = await resp.text();
      let parsed: any = null; try { parsed = JSON.parse(text); } catch { /* keep */ }
      attempts.push({ url, status: resp.status, body: parsed ?? text?.slice(0, 200) });
      if (resp.ok) { data = parsed; usedUrl = url; break; }
      if (resp.status === 401 || resp.status === 403) break;
    }
    if (!data) {
      const last = attempts[attempts.length - 1] ?? { status: 0 };
      const reason =
        last.status === 401 ? 'Invalid API key' :
        last.status === 403 ? 'API key lacks template permission' :
        last.status === 404 ? `No templates endpoint found on ${baseUrl}` :
        `HTTP ${last.status}`;
      return json(200, { ok: false, reason, attempts, base_url: baseUrl });
    }

    // Telinfy returns a grouped object: { richStandard:[], basicStandard:[], richDynamic:[], basicDynamic:[] }.
    // Older tenants may return a flat array. Normalize either shape into [{kind, t}].
    const KIND_KEYS = ['richStandard', 'basicStandard', 'richDynamic', 'basicDynamic'] as const;
    const KIND_MAP: Record<string, string> = {
      richStandard: 'rich_standard', basicStandard: 'basic_standard',
      richDynamic: 'rich_dynamic', basicDynamic: 'basic_dynamic',
    };
    const flat: Array<{ kind: string | null; t: any }> = [];
    if (Array.isArray(data)) {
      for (const t of data) flat.push({ kind: null, t });
    } else if (data && typeof data === 'object') {
      let grouped = false;
      for (const k of KIND_KEYS) {
        if (Array.isArray((data as any)[k])) {
          grouped = true;
          for (const t of (data as any)[k]) flat.push({ kind: KIND_MAP[k], t });
        }
      }
      if (!grouped) {
        const list: any[] = (data as any)?.data || (data as any)?.templates || [];
        for (const t of list) flat.push({ kind: null, t });
      }
    }

    let upserted = 0;
    for (const { kind, t } of flat) {
      const name = t?.templateName || t?.name || t?.template_name;
      if (!name) continue;
      const preview = t?.body || t?.message || t?.preview || t?.text || '';
      const vars = Array.isArray(t?.variables) ? t.variables : extractVars(preview);
      const status = (t?.status || 'approved').toString().toLowerCase();
      const mediaUrl =
        t?.mediaUrl || t?.media_url || t?.imageUrl || t?.image_url ||
        t?.thumbnailUrl || t?.thumbnail_url || t?.media?.url || null;
      const inferredKind = kind || (mediaUrl ? 'rich_standard' : 'basic_standard');
      const { error } = await supabase.from('rcs_templates').upsert({
        branch_id: branchId,
        template_name: name,
        body_preview: preview,
        variables: vars,
        status,
        kind: inferredKind,
        media_url: mediaUrl,
        raw: t,
        last_synced_at: new Date().toISOString(),
      }, { onConflict: 'branch_id,template_name' });
      if (!error) upserted++;
    }

    return json(200, { ok: true, count: flat.length, upserted, endpoint: usedUrl });
  } catch (e) {
    console.error('[rcs-templates-sync] error', e);
    return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
