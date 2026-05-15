// v2.0.0 — SSOT: routes through ai-runtime.generateOnce (purpose='dashboard_insight').
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { captureEdgeError } from '../_shared/capture-edge-error.ts'
import { generateOnce } from '../_shared/ai-runtime.ts'
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // ---- Authentication: require a valid signed-in user ----
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const supabaseAuth = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData } = await supabaseAuth.auth.getClaims(token);
    const userId = claimsData?.claims?.sub;
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ---- Authorization: only owner / admin / manager can see financial KPIs ----
    const { data: roleRow } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .in('role', ['owner', 'admin', 'manager'])
      .maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { branch_id } = await req.json();

    // Gather metrics
    const today = new Date().toISOString().split('T')[0];
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const lastMonthStart = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString();
    const lastMonthEnd = new Date(new Date().getFullYear(), new Date().getMonth(), 0).toISOString();

    const buildQuery = (table: string, select: string, filters?: Record<string, unknown>) => {
      let q = supabase.from(table).select(select, { count: 'exact' });
      if (branch_id) q = q.eq('branch_id', branch_id);
      if (filters) {
        Object.entries(filters).forEach(([k, v]) => {
          if (typeof v === 'string' && v.startsWith('gte:')) q = q.gte(k, v.slice(4));
          else if (typeof v === 'string' && v.startsWith('lte:')) q = q.lte(k, v.slice(4));
          else q = q.eq(k, v as string);
        });
      }
      return q;
    };

    // Active members
    const { count: activeMembers } = await buildQuery('members', 'id', { status: 'active' });
    const { count: totalMembers } = await buildQuery('members', 'id');

    // This month revenue
    let revenueQ = supabase.from('payments').select('amount').gte('payment_date', monthStart);
    if (branch_id) revenueQ = revenueQ.eq('branch_id', branch_id);
    const { data: thisMonthPayments } = await revenueQ;
    const thisMonthRevenue = thisMonthPayments?.reduce((s, p) => s + p.amount, 0) || 0;

    // Last month revenue
    let lastRevenueQ = supabase.from('payments').select('amount').gte('payment_date', lastMonthStart).lte('payment_date', lastMonthEnd);
    if (branch_id) lastRevenueQ = lastRevenueQ.eq('branch_id', branch_id);
    const { data: lastMonthPayments } = await lastRevenueQ;
    const lastMonthRevenue = lastMonthPayments?.reduce((s, p) => s + p.amount, 0) || 0;

    // Today's attendance
    let attQ = supabase.from('member_attendance').select('id', { count: 'exact' }).gte('check_in', today);
    if (branch_id) attQ = attQ.eq('branch_id', branch_id);
    const { count: todayAttendance } = await attQ;

    // Expiring memberships (7 days)
    const next7 = new Date(Date.now() + 7 * 86400000).toISOString();
    let expQ = supabase.from('memberships').select('id', { count: 'exact' }).eq('status', 'active').gte('end_date', today).lte('end_date', next7);
    if (branch_id) expQ = expQ.eq('branch_id', branch_id);
    const { count: expiringCount } = await expQ;

    // Overdue invoices
    let overdueQ = supabase.from('invoices').select('id, total_amount, amount_paid', { count: 'exact' }).eq('status', 'overdue');
    if (branch_id) overdueQ = overdueQ.eq('branch_id', branch_id);
    const { data: overdueInvoices, count: overdueCount } = await overdueQ;
    const overdueAmount = overdueInvoices?.reduce((s, i) => s + ((i.total_amount || 0) - (i.amount_paid || 0)), 0) || 0;

    // New leads this month
    let leadsQ = supabase.from('leads').select('id', { count: 'exact' }).gte('created_at', monthStart);
    if (branch_id) leadsQ = leadsQ.eq('branch_id', branch_id);
    const { count: newLeads } = await leadsQ;

    // Frozen memberships
    let frozenQ = supabase.from('memberships').select('id', { count: 'exact' }).eq('status', 'frozen');
    if (branch_id) frozenQ = frozenQ.eq('branch_id', branch_id);
    const { count: frozenCount } = await frozenQ;

    const revenueChange = lastMonthRevenue > 0 
      ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue * 100).toFixed(1) 
      : 'N/A';

    const metricsContext = `
Gym Dashboard Metrics (as of ${today}):
- Total Members: ${totalMembers || 0}
- Active Members: ${activeMembers || 0}
- Frozen Memberships: ${frozenCount || 0}
- Today's Check-ins: ${todayAttendance || 0}
- This Month Revenue: ₹${thisMonthRevenue.toLocaleString()}
- Last Month Revenue: ₹${lastMonthRevenue.toLocaleString()}
- Revenue Change: ${revenueChange}%
- Memberships Expiring in 7 Days: ${expiringCount || 0}
- Overdue Invoices: ${overdueCount || 0} (₹${overdueAmount.toLocaleString()})
- New Leads This Month: ${newLeads || 0}
`;

    const r = await generateOnce({
      purpose: 'dashboard_insight',
      userMessage: metricsContext,
      systemOverride: 'Format: produce 4-5 brief insights via the provide_insights tool. Each insight: emoji icon + 3-6 word title + 1-2 sentence actionable description + severity (info|warning|success|critical). Be specific with numbers.',
      tools: [{
        type: 'function',
        function: {
          name: 'provide_insights',
          description: 'Return actionable business insights based on gym metrics',
          parameters: {
            type: 'object',
            properties: {
              insights: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    icon: { type: 'string' },
                    title: { type: 'string' },
                    description: { type: 'string' },
                    severity: { type: 'string', enum: ['info', 'warning', 'success', 'critical'] }
                  },
                  required: ['icon', 'title', 'description', 'severity'],
                  additionalProperties: false
                }
              }
            },
            required: ['insights'],
            additionalProperties: false
          }
        }
      }],
      toolChoice: { type: 'function', function: { name: 'provide_insights' } }
    });

    const insights = r.toolCallArgs?.insights ?? [
      { icon: '📊', title: 'Analysis Complete', description: 'Unable to parse detailed insights.', severity: 'info' }
    ];

    return new Response(
      JSON.stringify({ insights, metrics: { totalMembers, activeMembers, thisMonthRevenue, lastMonthRevenue, revenueChange, todayAttendance, expiringCount, overdueCount, overdueAmount, newLeads, frozenCount } }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('AI insights error:', error);
    await captureEdgeError('ai-dashboard-insights', error);
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
