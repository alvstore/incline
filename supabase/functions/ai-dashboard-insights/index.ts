// v3.0.0 — Server-persisted insights + sales forecast (renewals, PT, trainers, projection).
// Modes: signed-in owner/admin/manager for one branch, or internal (x-internal-token) all_branches for the daily job.
import { requireCaller, canActOnBranch } from "../_shared/requireCaller.ts";
import { captureEdgeError } from '../_shared/capture-edge-error.ts'
import { generateOnce } from '../_shared/ai-runtime.ts'
import { projectMonth, type ForecastStats } from '../_shared/salesForecast.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-token, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';
const FRESH_MS = 6 * 3600_000;
const DEBOUNCE_MS = 2 * 60_000;
const UUID = /^[0-9a-f-]{36}$/i;

// deno-lint-ignore no-explicit-any
type Admin = any;

async function latest(admin: Admin, branchId: string | null) {
  let q = admin.from('ai_dashboard_insights').select('insights, forecast, generated_at, branch_id').order('generated_at', { ascending: false }).limit(1);
  q = branchId ? q.eq('branch_id', branchId) : q.is('branch_id', null);
  const { data } = await q;
  return data?.[0] ?? null;
}

async function buildForBranch(admin: Admin, branchId: string | null, userId: string) {
  const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
  const bq = (q: Admin) => (branchId ? q.eq('branch_id', branchId) : q);
  const today = new Date().toISOString().slice(0, 10);
  const next7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const [{ data: stats, error: fErr }, active, todayAtt, expiring, overdue, leads, frozen] = await Promise.all([
    admin.rpc('dashboard_sales_forecast', { p_branch: branchId }),
    bq(admin.from('members').select('id', { count: 'exact', head: true }).eq('status', 'active')),
    bq(admin.from('member_attendance').select('id', { count: 'exact', head: true }).gte('check_in', today)),
    bq(admin.from('memberships').select('id', { count: 'exact', head: true }).eq('status', 'active').gte('end_date', today).lte('end_date', next7)),
    bq(admin.from('invoices').select('total_amount, amount_paid', { count: 'exact' }).eq('status', 'overdue')),
    bq(admin.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString())),
    bq(admin.from('memberships').select('id', { count: 'exact', head: true }).eq('status', 'frozen')),
  ]);
  if (fErr) throw new Error(`forecast_failed: ${fErr.message}`);
  const s = stats as ForecastStats & Record<string, any>;
  const projection = projectMonth(s);
  const overdueAmt = (overdue.data ?? []).reduce((a: number, i: any) => a + ((i.total_amount || 0) - (i.amount_paid || 0)), 0);
  const trainers = (s.trainers ?? []) as Array<{ name: string; pt_revenue: number; active_clients: number; sessions_done: number }>;

  const ctx = `Gym metrics (IST ${s.as_of}, day ${s.days_elapsed}/${s.days_in_month}):
- Active members: ${active.count ?? 0}; frozen: ${frozen.count ?? 0}; check-ins today: ${todayAtt.count ?? 0}
- Collected this month: ${inr(s.collected_mtd)} (last month total ${inr(s.collected_last_month)}); daily pace ${inr(projection.daily_pace)}
- Renewals: this month ${s.renewal.this_month_renewed}/${s.renewal.this_month_due} renewed, last month ${s.renewal.last_month_renewed}/${s.renewal.last_month_due}; ${s.renewal.remaining_due} still due this month; blended ratio ${(projection.renewal_ratio * 100).toFixed(0)}%
- Expiring in 7 days: ${expiring.count ?? 0}; overdue invoices: ${overdue.count ?? 0} (${inr(overdueAmt)}); new leads (30d): ${leads.count ?? 0}
- PT packages: ${s.pt.sold_mtd} sold this month (${inr(s.pt.value_mtd)}) vs ${s.pt.sold_last} last month (${inr(s.pt.value_last)}); ${s.pt.expiring_7d} PT packages expire within 7 days
- Top trainers: ${trainers.map((t) => `${t.name} ${inr(t.pt_revenue)} PT, ${t.active_clients} clients, ${t.sessions_done} sessions`).join('; ') || 'none'}
- Projected month sales: low ${inr(projection.low)}, likely ${inr(projection.likely)}, high ${inr(projection.high)} (expected renewals ${inr(projection.expected_renewals)})`;

  const r = await generateOnce({
    purpose: 'dashboard_insight',
    userMessage: ctx,
    systemOverride: 'Use provide_insights. Return 4-5 insights (short title, 1-2 sentence description with specific numbers, severity info|warning|success|critical) and 3-5 concrete sales ideas to hit or beat the likely projection (renewal follow-ups, PT upsell, trainer coaching). Use only the numbers given; never invent prices. Use no emojis.',
    tools: [{
      type: 'function',
      function: {
        name: 'provide_insights',
        description: 'Business insights and sales ideas',
        parameters: {
          type: 'object',
          properties: {
            insights: { type: 'array', items: { type: 'object', properties: {
              title: { type: 'string' }, description: { type: 'string' },
              severity: { type: 'string', enum: ['info', 'warning', 'success', 'critical'] },
            }, required: ['title', 'description', 'severity'], additionalProperties: false } },
            ideas: { type: 'array', items: { type: 'string' } },
          },
          required: ['insights', 'ideas'],
          additionalProperties: false,
        },
      },
    }],
    toolChoice: { type: 'function', function: { name: 'provide_insights' } },
  });

  const insights = r.toolCallArgs?.insights ?? [];
  const ideas: string[] = r.toolCallArgs?.ideas ?? [];
  if (!insights.length) throw new Error('ai_empty_response');
  const forecast = { ...s, projection, ideas };
  const generated_at = new Date().toISOString();
  const { error: insErr } = await admin.from('ai_dashboard_insights').insert({
    user_id: userId, branch_id: branchId, insights, forecast, generated_at,
    expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
  });
  if (insErr) throw new Error(`persist_failed: ${insErr.message}`);
  return { insights, forecast, generated_at, branch_id: branchId };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const caller = await requireCaller(req, corsHeaders, { roles: ['owner', 'admin', 'manager'] });
    if (!caller.ok) return caller.response;
    const body = await req.json().catch(() => ({}));
    const branchId: string | null = typeof body?.branch_id === 'string' && UUID.test(body.branch_id) ? body.branch_id : null;
    const force = body?.force === true;
    const admin = caller.admin;

    if (caller.internal && body?.all_branches === true) {
      const { data: branches } = await admin.from('branches').select('id').eq('is_active', true);
      const results: Array<{ branch_id: string; ok: boolean; error?: string }> = [];
      for (const b of branches ?? []) {
        try { await buildForBranch(admin, b.id, SYSTEM_USER); results.push({ branch_id: b.id, ok: true }); }
        catch (e) { await captureEdgeError('ai-dashboard-insights', e); results.push({ branch_id: b.id, ok: false, error: String((e as Error).message) }); }
      }
      return json({ success: true, results });
    }

    if (!caller.internal) {
      const isGlobal = caller.roles.includes('owner') || caller.roles.includes('admin');
      if (!isGlobal && (!branchId || !(await canActOnBranch(caller, branchId)))) return json({ error: 'Forbidden for this branch' }, 403);
    }

    const prev = await latest(admin, branchId);
    const age = prev ? Date.now() - new Date(prev.generated_at).getTime() : Infinity;
    if (prev && (age < DEBOUNCE_MS || (!force && age < FRESH_MS))) return json({ ...prev, reused: true });

    const out = await buildForBranch(admin, branchId, caller.userId ?? SYSTEM_USER);
    return json({ ...out, reused: false });
  } catch (error) {
    await captureEdgeError('ai-dashboard-insights', error);
    return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
