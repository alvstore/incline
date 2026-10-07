// product-batch-expiry-check v1.0.0
// Daily cron: flips expired batches → status='expired', notifies branch managers
// of batches expiring in 30/15/7 days and of newly-expired batches.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { requireCaller } from "../_shared/requireCaller.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface BatchRow {
  id: string;
  product_id: string;
  branch_id: string;
  batch_number: string;
  exp_date: string;
  quantity_remaining: number;
  status: string;
  products?: { name: string } | null;
  branches?: { name: string } | null;
}

async function dispatchInApp(supa: any, branch_id: string, title: string, body: string, dedupe: string) {
  try {
    await supa.functions.invoke('dispatch-communication', {
      body: {
        channel: 'in_app',
        category: 'system',
        target_role_in_branch: { roles: ['owner', 'admin', 'manager'], branch_id },
        title,
        body,
        dedupe_key: dedupe,
      },
    });
  } catch (e) {
    console.error('[batch-expiry] dispatch failed', e);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  { const __caller = await requireCaller(req, corsHeaders, { roles: [] }); if (!__caller.ok) return __caller.response; }
  const startedAt = new Date().toISOString();
  try {
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // 1) Flip expired batches
    const { data: justExpired, error: expErr } = await supa
      .from('product_batches')
      .update({ status: 'expired' })
      .eq('status', 'active')
      .lt('exp_date', todayStr)
      .select('id, product_id, branch_id, batch_number, exp_date, quantity_remaining, products(name), branches(name)');
    if (expErr) throw expErr;

    // 2) Find batches expiring in 30/15/7 days
    const horizons = [30, 15, 7];
    const warnings: Array<{ days: number; rows: BatchRow[] }> = [];
    for (const days of horizons) {
      const target = new Date(today);
      target.setDate(target.getDate() + days);
      const targetStr = target.toISOString().split('T')[0];
      const { data, error } = await supa
        .from('product_batches')
        .select('id, product_id, branch_id, batch_number, exp_date, quantity_remaining, status, products(name), branches(name)')
        .eq('status', 'active')
        .gt('quantity_remaining', 0)
        .eq('exp_date', targetStr);
      if (error) throw error;
      warnings.push({ days, rows: (data || []) as any });
    }

    // 3) Group + notify per branch
    const byBranch = new Map<string, { expired: BatchRow[]; warn: Map<number, BatchRow[]> }>();
    for (const row of (justExpired || []) as any[]) {
      if (!byBranch.has(row.branch_id)) byBranch.set(row.branch_id, { expired: [], warn: new Map() });
      byBranch.get(row.branch_id)!.expired.push(row);
    }
    for (const w of warnings) {
      for (const row of w.rows) {
        if (!byBranch.has(row.branch_id)) byBranch.set(row.branch_id, { expired: [], warn: new Map() });
        const bucket = byBranch.get(row.branch_id)!;
        if (!bucket.warn.has(w.days)) bucket.warn.set(w.days, []);
        bucket.warn.get(w.days)!.push(row);
      }
    }

    let notified = 0;
    for (const [branch_id, bucket] of byBranch) {
      if (bucket.expired.length > 0) {
        const lines = bucket.expired.map(b => `• ${b.products?.name || 'Product'} — ${b.batch_number} (${b.quantity_remaining} units)`).join('\n');
        await dispatchInApp(
          supa,
          branch_id,
          `${bucket.expired.length} batch(es) just expired`,
          `These batches are now blocked from sale:\n${lines}\n\nReview and recall/quarantine if needed.`,
          `batch_expired:${branch_id}:${todayStr}`,
        );
        notified++;
      }
      for (const [days, rows] of bucket.warn) {
        const lines = rows.map(b => `• ${b.products?.name || 'Product'} — ${b.batch_number} (${b.quantity_remaining} units, EXP ${b.exp_date})`).join('\n');
        await dispatchInApp(
          supa,
          branch_id,
          `${rows.length} batch(es) expire in ${days} days`,
          `Plan a sell-through or quarantine:\n${lines}`,
          `batch_warn_${days}:${branch_id}:${todayStr}`,
        );
        notified++;
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      expired_count: (justExpired || []).length,
      warning_counts: warnings.map(w => ({ days: w.days, count: w.rows.length })),
      notifications_sent: notified,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('[product-batch-expiry-check] fatal', err);
    return new Response(JSON.stringify({ ok: false, error: err?.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
