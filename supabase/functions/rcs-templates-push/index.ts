// v1.0.0 — Push local rcs_templates rows up to the active RCS provider.
//   POST /rcs-templates-push { branch_id?: string, template_ids?: string[], all?: boolean }
// Currently supports Smartping (POST /rcs/api/template/create). Telinfy returns
// `unsupported` — templates on Telinfy must be created in their portal, then
// mirrored via `rcs-templates-sync`.
//
// Local template requirements:
//   - kind, template_name, body_preview
//   - media assets (if kind starts with 'rich') must be public https URLs
// On success writes back { external_template_id, provider, status: 'pending_approval' }.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveRcsProvider } from '../_shared/rcsProviders.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (s: number, b: unknown) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

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

type LocalTemplate = {
  id: string;
  branch_id: string | null;
  template_name: string;
  body_preview: string | null;
  variables: string[] | null;
  status: string | null;
  kind: string | null;
  media_url: string | null;
  provider: string | null;
  external_template_id: string | null;
  raw: any;
};

function validateForPush(t: LocalTemplate): string | null {
  if (!t.template_name?.trim()) return 'template_name is required';
  if (!t.kind) return 'kind is required (rich_standard | basic_standard | rich_dynamic | basic_dynamic)';
  if (!t.body_preview?.trim()) return 'body_preview (message body) is required';
  if (t.kind.startsWith('rich')) {
    if (!t.media_url) return 'media_url is required for rich templates';
    if (!/^https:\/\//i.test(t.media_url)) return 'media_url must be a public https URL';
  }
  return null;
}

async function pushToSmartping(baseUrl: string, token: string, t: LocalTemplate) {
  const payload: any = {
    templateName: t.template_name,
    templateType: t.kind,
    body: t.body_preview,
    ...(t.media_url ? { mediaUrl: t.media_url } : {}),
    ...(t.raw && typeof t.raw === 'object' ? { extra: t.raw } : {}),
  };
  const resp = await fetch(`${baseUrl}/rcs/api/template/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  let parsed: any = null; try { parsed = JSON.parse(text); } catch { /* keep */ }
  if (!resp.ok) return { ok: false, status: resp.status, reason: parsed?.message || text?.slice(0, 200) };
  const externalId =
    parsed?.templateId || parsed?.id || parsed?.data?.templateId || parsed?.data?.id || null;
  return { ok: true, externalId: externalId ? String(externalId) : null, raw: parsed };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json().catch(() => ({}));
    const branchId: string | null = body?.branch_id || null;
    const templateIds: string[] = Array.isArray(body?.template_ids) ? body.template_ids : [];
    const pushAll: boolean = !!body?.all;
    if (!templateIds.length && !pushAll) return json(400, { ok: false, reason: 'template_ids[] or all=true required' });

    const cfg = await resolveRcsProvider(supabase, branchId);
    if (!cfg.is_active) return json(200, { ok: false, provider: cfg.provider, reason: `${cfg.provider} integration is disabled` });
    if (cfg.provider !== 'smartping') {
      return json(200, {
        ok: false, provider: cfg.provider,
        reason: `${cfg.provider} does not expose a template-create API. Create templates in the ${cfg.provider} portal, then click Sync.`,
      });
    }

    // Load candidate rows
    let q = supabase.from('rcs_templates').select('*');
    if (branchId) q = q.or(`branch_id.eq.${branchId},branch_id.is.null`);
    else q = q.is('branch_id', null);
    if (!pushAll) q = q.in('id', templateIds);
    else q = q.is('external_template_id', null);
    const { data: rows, error } = await q;
    if (error) throw error;
    const candidates = (rows as LocalTemplate[]) || [];
    if (!candidates.length) return json(200, { ok: true, provider: 'smartping', pushed: 0, results: [] });

    // Auth once
    const userId = cfg.credentials?.user_id || Deno.env.get('SMARTPING_RCS_USER_ID');
    const apiKey = cfg.credentials?.api_key || Deno.env.get('SMARTPING_RCS_API_KEY');
    if (!userId || !apiKey) return json(200, { ok: false, provider: 'smartping', reason: 'Smartping user_id / api_key missing' });
    const token = await smartpingAuthorize(cfg.base_url, userId, apiKey);
    if (!token) return json(200, { ok: false, provider: 'smartping', reason: 'Smartping authorize failed' });

    const results: Array<{ id: string; template_name: string; ok: boolean; reason?: string; external_template_id?: string | null }> = [];
    for (const t of candidates) {
      const invalid = validateForPush(t);
      if (invalid) { results.push({ id: t.id, template_name: t.template_name, ok: false, reason: invalid }); continue; }

      const r = await pushToSmartping(cfg.base_url, token, t);
      if (!r.ok) { results.push({ id: t.id, template_name: t.template_name, ok: false, reason: `HTTP ${r.status}: ${r.reason}` }); continue; }

      await supabase.from('rcs_templates').update({
        provider: 'smartping',
        external_template_id: r.externalId,
        status: 'pending_approval',
        last_synced_at: new Date().toISOString(),
        raw: { ...(t.raw || {}), push_response: r.raw },
      }).eq('id', t.id);

      results.push({ id: t.id, template_name: t.template_name, ok: true, external_template_id: r.externalId });
    }

    const pushed = results.filter((r) => r.ok).length;
    return json(200, { ok: true, provider: 'smartping', pushed, total: results.length, results });
  } catch (e) {
    console.error('[rcs-templates-push] error', e);
    return json(500, { ok: false, reason: e instanceof Error ? e.message : String(e) });
  }
});
