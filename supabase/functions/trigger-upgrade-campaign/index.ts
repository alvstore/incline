// v1.3.0 — IST Day 7/12 catch-up, actual outcomes and live eligibility.
// v1.2.0 — records last_sent_at for the dashboard "offers sent" tile.
// v1.1.0 — event_key routes to approved Meta templates annual_upgrade_day7 / annual_upgrade_closing.
// v1.0.0 — 15-Day "Honeymoon" Annual Upgrade campaign worker.
// Called daily by Automation Brain (rule `annual_upgrade_nudge`, 09:00 IST).
// Day 7: send the upgrade offer. Day 12: send the 72-hour closing reminder.
// Past window: mark expired. All sends route through dispatch-communication
// (dedupe, do-not-contact, quiet hours, template resolution).

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireCaller, callerBranchIds } from "../_shared/requireCaller.ts";
import { upgradeReminderStage, upgradeReminderHandled } from "../_shared/upgradeWindow.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? '';
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? '';

function istToday(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

async function dispatch(payload: Record<string, unknown>): Promise<{ status: string; reason?: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/dispatch-communication`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let parsed: { status?: string; reason?: string } = {};
    try { parsed = JSON.parse(text); } catch { /* non-json */ }
    if (!res.ok) return { status: "failed", reason: parsed.reason ?? text.slice(0, 200) };
    return { status: parsed.status ?? "failed", reason: parsed.reason };
  } catch (e) {
    return { status: "failed", reason: (e as Error).message };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const caller = await requireCaller(req, corsHeaders, { roles: ['owner', 'admin', 'manager'] });
    if (!caller.ok) return caller.response;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const branchIds = await callerBranchIds(caller);
    const input = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const dryRun = input.dry_run === true;

    // Kill switch: settings row branch_id IS NULL, key 'annual_upgrade_campaign', value 'false' disables.
    const { data: killSwitch } = await admin
      .from("settings")
      .select("value")
      .is("branch_id", null)
      .eq("key", "annual_upgrade_campaign")
      .maybeSingle();
    if (killSwitch && String(killSwitch.value) !== '"true"' && String(killSwitch.value) !== "true") {
      return new Response(JSON.stringify({ success: true, skipped: "disabled_by_setting" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const today = istToday();

    // Derive expiry in reads; persist only during this existing daily reconciliation.
    let expiredCount = 0;
    if (!dryRun) {
      let expireQuery = admin.from('upgrade_offers').update({ status: 'expired', updated_at: new Date().toISOString() })
        .in('status', ['pending', 'day7_sent', 'day12_sent']).lte('window_ends_at', new Date().toISOString());
      if (branchIds) expireQuery = expireQuery.in('branch_id', branchIds);
      const { data: expired, error } = await expireQuery.select('id');
      if (error) throw error;
      expiredCount = expired?.length ?? 0;
    }
    // Explicit pagination avoids the default API row cap.
    const offers = [];
    for (let offset = 0; ; offset += 500) {
      let query = admin.from('upgrade_offers')
        .select('id, branch_id, member_id, membership_id, status, annual_price, already_paid, upgrade_cost, window_ends_at, memberships!inner(start_date, status, membership_plans(duration_days))')
        .in('status', ['pending', 'day7_sent', 'day12_sent'])
        .gt('window_ends_at', new Date().toISOString()).order('id').range(offset, offset + 499);
      if (branchIds) query = query.in('branch_id', branchIds);
      const { data, error } = await query;
      if (error) throw error;
      offers.push(...(data ?? []));
      if ((data?.length ?? 0) < 500) break;
    }

    let sentDay7 = 0;
    let sentDay12 = 0;
    const failures: string[] = [];
    let eligible = 0;
    let queued = 0;
    let suppressed = 0;

    for (const offer of offers ?? []) {
      const ms = Array.isArray(offer.memberships) ? offer.memberships[0] : offer.memberships;
      if (!ms || ms.status !== "active") continue;
      const plan = Array.isArray(ms.membership_plans) ? ms.membership_plans[0] : ms.membership_plans;
      if (![30, 90, 180].includes(Number(plan?.duration_days))) continue;
      const stage = upgradeReminderStage(String(ms.start_date), offer.window_ends_at, ms.status, offer.status);
      if (!stage) continue;
      const isDay7 = stage === 'd7';
      const dedupeKey = `upgrade:${offer.id}:${stage}:wa`;
      const { data: previous, error: previousError } = await admin.from('communication_logs')
        .select('delivery_status,error_message').eq('dedupe_key', dedupeKey).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (previousError) throw previousError;
      if (upgradeReminderHandled(previous?.delivery_status, previous?.error_message)) continue;
      // Existing queue owns retries; do not race a queued failed attempt.
      const { data: retry, error: retryError } = await admin.from('communication_retry_queue').select('id')
        .eq('member_id', offer.member_id).in('status', ['pending', 'processing', 'awaiting_confirmation'])
        .contains('metadata', { event_key: isDay7 ? 'annual_upgrade_day7' : 'annual_upgrade_closing' }).limit(1).maybeSingle();
      if (retryError) throw retryError;
      if (retry) continue;
      eligible++;
      if (dryRun) continue;
      const { data: calculation, error: calcError } = await admin.rpc('calculate_upgrade_cost', { p_member_id: offer.member_id });
      if (calcError) { failures.push(`${offer.id}: calculation unavailable`); continue; }
      if (!calculation?.eligible || calculation.offer_id !== offer.id) continue;

      // Resolve recipient.
      const { data: member } = await admin
        .from("members")
        .select("id, member_code, profiles:user_id(full_name, phone)")
        .eq("id", offer.member_id)
        .maybeSingle();
      const profile = Array.isArray(member?.profiles) ? member?.profiles[0] : member?.profiles;
      const phone = String(profile?.phone ?? "").replace(/\D/g, "");
      if (!phone) { failures.push(`${offer.id}: no phone`); continue; }

      const firstName = String(profile?.full_name ?? "there").split(" ")[0];
      const cost = inr(Number(calculation.upgrade_cost ?? 0));
      const annual = inr(Number(calculation.annual_price ?? 0));
      const paid = inr(Number(calculation.already_paid ?? 0));
      const endsOn = new Date(offer.window_ends_at).toLocaleDateString("en-IN", {
        day: "numeric", month: "long", timeZone: "Asia/Kolkata",
      });

      const body = isDay7
        ? `Hi ${firstName}! You're one week into your Incline journey Upgrade to the Annual plan within your 15-day window and we'll adjust every rupee you've already paid (${paid}) against the Annual fee (${annual}) — your upgrade cost is just ${cost}. Reply UPGRADE to see your exact savings. Window ends ${endsOn}.`
        : `Hi ${firstName}, your annual-upgrade window closes on ${endsOn}. Your ${paid} already paid still counts 100% toward the Annual plan — upgrade for just ${cost}. Reply UPGRADE before the window closes.`;

      const result = await dispatch({
        branch_id: offer.branch_id,
        channel: "whatsapp",
        category: "retention_nudge",
        recipient: phone,
        member_id: offer.member_id,
        payload: {
          body,
          variables: {
            member_name: firstName,
            upgrade_offer_id: offer.id,
            annual_price: annual,
            already_paid: paid,
            upgrade_cost: cost,
            window_ends: endsOn,
            event_key: isDay7 ? "annual_upgrade_day7" : "annual_upgrade_closing",
          },
        },
        dedupe_key: dedupeKey,
        ttl_seconds: 7 * 86400,
        source_caller: "trigger-upgrade-campaign",
        source_type: "automation",
      });

      if (result.status === "queued") { queued++; continue; }
      if (result.status === "suppressed") { suppressed++; continue; }
      if (result.status === "deduped") continue;
      if (result.status !== "sent") {
        failures.push(`${offer.id}: ${result.reason ?? "send failed"}`);
        continue;
      }

      await admin
        .from("upgrade_offers")
        .update({ status: isDay7 ? "day7_sent" : "day12_sent", last_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", offer.id);
      if (isDay7) sentDay7++; else sentDay12++;
    }

    return new Response(
      JSON.stringify({
        success: true,
        date: today,
        expired: expiredCount,
        dry_run: dryRun,
        eligible, queued, suppressed,
        sent_day7: sentDay7,
        sent_day12: sentDay12,
        failures,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
