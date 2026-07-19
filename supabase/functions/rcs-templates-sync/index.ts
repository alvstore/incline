// v2.0.0 — Provider-aware RCS template sync.
//   Routes via `integration_settings` (Smartping preferred, Telinfy fallback).
//   • Telinfy: GET /rcs/templates (probes several paths); handles grouped
//     {richStandard, basicStandard, richDynamic, basicDynamic} or flat arrays.
//   • Smartping: authorize → GET /rcs/api/template/list; normalizes into
//     rcs_templates rows with provider='smartping' and external_template_id=<UUID>.
//   POST /rcs-templates-sync { branch_id?: string }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveRcsProvider } from '../_shared/rcsProviders.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (s: number, b: unknown) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

function extractVars(text: string): string[] {
  const matches = String(text || '').match(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g) || [];
  return Array.from(new Set(matches.map((m) => m.replace(/[{}\s]/g, ''))));
}

async function smartpingAuthorize(baseUrl: string, userId: string, apiKey: string): Promise<string | null> {
  const resp = await fetch(`${baseUrl}/rcs/api/user/authorize`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, apiKey }),
  });
  const text = await resp.text();
  let parsed: any = null; try { parsed = JSON.parse(text); } catch { /* keep */ }
  if (!resp.ok) return null;
  const token = parsed?.token || parsed?.authorization || parsed?.jwt ||
    parsed?.data?.token || parsed?.data?.authorization ||
    resp.headers.get('authorization') || resp.headers.get('Authorization');
  return token ? String(token).replace(/^Bearer\s+/i, '') : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json().catch(() => ({}));
    const branchId: string | null = body?.branch_id || null;

    const cfg = await resolveRcsProvider(supabase, branchId);
    if (!cfg.is_active) return json(200, { ok: false, provider: cfg.provider, reason: `${cfg.provider} integration is disabled` });

    // ══════════════════════════════════════════════════════════════════════════════
    // SMARTPING
    // ══════════════════════════════════════════════════════════════════════════════
    if (cfg.provider === 'smartping') {
      const userId = cfg.credentials?.user_id || Deno.env.get('SMARTPING_RCS_USER_ID');
      const apiKey = cfg.credentials?.api_key || Deno.env.get('SMARTPING_RCS_API_KEY');
      if (!userId || !apiKey) return json(200, { ok: false, provider: 'smartping', reason: 'Smartping user_id / api_key missing' });

      const token = await smartpingAuthorize(cfg.base_url, userId, apiKey);
      if (!token) return json(200, { ok: false, provider: 'smartping', reason: 'Smartping authorize failed (check credentials + IP whitelist)' });

      const CANDIDATE_PATHS = ['/rcs/api/template/list', '/rcs/api/templates', '/rcs/api/template'];
      const attempts: Array<{ url: string; status: number; body: any }> = [];
      let data: any = null; let usedUrl = '';
      for (const p of CANDIDATE_PATHS) {
        const url = `${cfg.base_url}${p}`;
        const resp = await fetch(url, { method: 'GET', headers: { 'Authorization': token, 'Accept': 'application/json' } });
        const text = await resp.text();
        let parsed: any = null; try { parsed = JSON.parse(text); } catch { /* keep */ }
        attempts.push({ url, status: resp.status, body: parsed ?? text?.slice(0, 200) });
        if (resp.ok) { data = parsed; usedUrl = url; break; }
        if (resp.status === 401 || resp.status === 403) break;
      }
      if (!data) {
        const last = attempts[attempts.length - 1] ?? { status: 0 };
        return json(200, { ok: false, provider: 'smartping', reason: `HTTP ${last.status}`, attempts, base_url: cfg.base_url });
      }

      const list: any[] = Array.isArray(data) ? data :
        (data?.templates || data?.data || data?.result || data?.list || []);
      let upserted = 0;
      for (const t of list) {
        const name = t?.templateName || t?.name || t?.template_name;
        const extId = t?.templateId || t?.template_id || t?.id;
        if (!name || !extId) continue;
        const preview = t?.body || t?.messageText || t?.text || t?.description || '';
        const vars = Array.isArray(t?.variables) ? t.variables : extractVars(preview);
        const status = (t?.status || t?.approvalStatus || 'approved').toString().toLowerCase();
        const mediaUrl = t?.mediaUrl || t?.imageUrl || t?.image || t?.thumbnailUrl || null;
        const kindRaw = String(t?.templateType || t?.type || '').toLowerCase();
        const kind =
          kindRaw.includes('rich') || kindRaw.includes('card') || kindRaw.includes('carousel') ? 'rich_standard' :
          mediaUrl ? 'rich_standard' : 'basic_standard';
        const { error } = await supabase.from('rcs_templates').upsert({
          branch_id: branchId,
          provider: 'smartping',
          template_name: name,
          external_template_id: String(extId),
          body_preview: preview,
          variables: vars,
          status,
          kind,
          media_url: mediaUrl,
          raw: t,
          last_synced_at: new Date().toISOString(),
        }, { onConflict: 'branch_id,provider,template_name' });
        if (!error) upserted++;
      }
      return json(200, { ok: true, provider: 'smartping', count: list.length, upserted, endpoint: usedUrl });
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // TELINFY (legacy)
    // ══════════════════════════════════════════════════════════════════════════════
    const apiKey = cfg.credentials?.api_key || Deno.env.get('TELINFY_API_KEY') || '';
    if (!apiKey) return json(200, { ok: false, provider: 'telinfy', reason: 'Telinfy API key missing' });

    const CANDIDATE_PATHS = ['/rcs/templates', '/rcs/template', '/rcs/templates/list', '/templates/rcs', '/rcs/templates/approved'];
    const attempts: Array<{ url: string; status: number; body: any }> = [];
    let data: any = null; let usedUrl = '';
    for (const p of CANDIDATE_PATHS) {
      const url = `${cfg.base_url}${p}`;
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
        last.status === 404 ? `No templates endpoint found on ${cfg.base_url}` :
        `HTTP ${last.status}`;
      return json(200, { ok: false, provider: 'telinfy', reason, attempts, base_url: cfg.base_url });
    }

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
        provider: 'telinfy',
        template_name: name,
        body_preview: preview,
        variables: vars,
        status,
        kind: inferredKind,
        media_url: mediaUrl,
        raw: t,
        last_synced_at: new Date().toISOString(),
      }, { onConflict: 'branch_id,provider,template_name' });
      if (!error) upserted++;
    }

    return json(200, { ok: true, provider: 'telinfy', count: flat.length, upserted, endpoint: usedUrl });
  } catch (e) {
    console.error('[rcs-templates-sync] error', e);
    return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
