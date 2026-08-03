// v1.0.0 — Backfill Razorpay gateway fees/tax onto historical payment rows.
// Reads each payment's gateway payment id (pay_xxx), fetches the authoritative
// fee + tax from the Razorpay API and stores the net settlement amount so the
// finance reports show the true cost of online collection.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const serve = Deno.serve;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const branchId = (body.branchId as string | undefined) ?? undefined;
    const limit = Math.min(Number(body.limit ?? 200), 500);
    const dryRun = Boolean(body.dryRun);

    // Resolve Razorpay credentials: branch-specific first, then global.
    let credQuery = supabase
      .from("integration_settings")
      .select("credentials, branch_id")
      .eq("integration_type", "payment_gateway")
      .eq("provider", "razorpay")
      .eq("is_active", true);
    if (branchId) credQuery = credQuery.or(`branch_id.eq.${branchId},branch_id.is.null`);
    const { data: integrations } = await credQuery.order("branch_id", {
      ascending: true,
      nullsFirst: false,
    });

    const creds = (integrations || [])[0] as { credentials?: Record<string, string> } | undefined;
    const keyId = creds?.credentials?.key_id;
    const keySecret = creds?.credentials?.key_secret;
    if (!keyId || !keySecret) {
      return json({ error: "Razorpay not configured", code: "NO_GATEWAY" }, 400);
    }
    const auth = "Basic " + btoa(`${keyId}:${keySecret}`);

    // Candidate payments: settled online payments without recorded fees.
    let q = supabase
      .from("payments")
      .select("id, amount, transaction_id, gateway_fee, payment_source")
      .not("transaction_id", "is", null)
      .is("gateway_fee", null)
      .order("payment_date", { ascending: false })
      .limit(limit);
    if (branchId) q = q.eq("branch_id", branchId);

    const { data: payments, error: payErr } = await q;
    if (payErr) return json({ error: payErr.message, code: "QUERY_FAILED" }, 500);

    const candidates = (payments || []).filter((p) =>
      typeof p.transaction_id === "string" && p.transaction_id.startsWith("pay_")
    );

    let updated = 0;
    let skipped = 0;
    const failures: { id: string; reason: string }[] = [];

    for (const p of candidates) {
      try {
        const res = await fetch(`https://api.razorpay.com/v1/payments/${p.transaction_id}`, {
          headers: { Authorization: auth },
        });
        if (!res.ok) {
          failures.push({ id: p.id, reason: `HTTP ${res.status}` });
          continue;
        }
        const rp = await res.json();
        const fee = Number(rp.fee || 0) / 100;
        const tax = Number(rp.tax || 0) / 100;
        if (!fee) {
          skipped++;
          continue;
        }
        const net = Number(p.amount || 0) - fee;

        if (!dryRun) {
          const { error: upErr } = await supabase
            .from("payments")
            .update({
              gateway_fee: fee,
              gateway_tax: tax,
              net_settlement_amount: net,
              payment_source: p.payment_source ?? "razorpay",
            })
            .eq("id", p.id);
          if (upErr) {
            failures.push({ id: p.id, reason: upErr.message });
            continue;
          }
        }
        updated++;
      } catch (e) {
        failures.push({ id: p.id, reason: e instanceof Error ? e.message : "unknown" });
      }
    }

    return json({
      success: true,
      dryRun,
      scanned: candidates.length,
      updated,
      skipped,
      failures,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("backfill-razorpay-fees error:", msg);
    return json({ error: msg, code: "INTERNAL_ERROR" }, 500);
  }
});
