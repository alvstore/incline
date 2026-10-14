// v1.0.0 — 15-Day "Honeymoon" Annual Upgrade campaign worker.
// Called daily by Automation Brain (rule `annual_upgrade_nudge`, 09:00 IST).
// Day 7: send the upgrade offer. Day 12: send the 72-hour closing reminder.
// Past window: mark expired. All sends route through dispatch-communication
// (dedupe, do-not-contact, quiet hours, template resolution).

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function istToday(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function istDateDaysAgo(days: number): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000 - days * 86400_000).toISOString().slice(0, 10);
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
    return { status: parsed.status ?? "sent", reason: parsed.reason };
  } catch (e) {
    return { status: "failed", reason: (e as Error).message };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Auth: Automation Brain / system (service key) OR a signed-in staff user (Run Now).
    const authHeader = req.headers.get("Authorization") ?? "";
    const apiKeyHeader = req.headers.get("apikey") ?? "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.replace("Bearer ", "").trim() : "";
    const isSystemCall = bearer === SERVICE_KEY || apiKeyHeader === SERVICE_KEY;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    if (!isSystemCall) {
      if (!bearer) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      }
      const authClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(bearer);
      if (claimsError || !claimsData?.claims) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      }
      const { data: roles } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", claimsData.claims.sub as string)
        .in("role", ["owner", "admin", "manager", "staff"]);
      if (!roles || roles.length === 0) {
        return new Response(JSON.stringify({ error: "Forbidden: Staff access required" }), { status: 403, headers: corsHeaders });
      }
    }

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

    const day7Date = istDateDaysAgo(7);
    const day12Date = istDateDaysAgo(12);
    const today = istToday();

    // 1. Expire anything past its window.
    const { data: expired } = await admin
      .from("upgrade_offers")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .in("status", ["pending", "day7_sent", "day12_sent"])
      .lt("window_ends_at", new Date().toISOString())
      .select("id");

    // 2. Fetch candidate offers with their membership start_date.
    const { data: offers, error: offersError } = await admin
      .from("upgrade_offers")
      .select("id, branch_id, member_id, membership_id, status, annual_price, already_paid, upgrade_cost, window_ends_at, memberships!inner(start_date, status)")
      .in("status", ["pending", "day7_sent"])
      .gte("window_ends_at", new Date().toISOString());
    if (offersError) throw offersError;

    let sentDay7 = 0;
    let sentDay12 = 0;
    const failures: string[] = [];

    for (const offer of offers ?? []) {
      const ms = Array.isArray(offer.memberships) ? offer.memberships[0] : offer.memberships;
      if (!ms || ms.status !== "active") continue;
      const startDate = String(ms.start_date).slice(0, 10);

      const isDay7 = offer.status === "pending" && startDate === day7Date;
      const isDay12 = offer.status === "day7_sent" && startDate === day12Date;
      if (!isDay7 && !isDay12) continue;

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
      const cost = inr(Number(offer.upgrade_cost ?? 0));
      const annual = inr(Number(offer.annual_price ?? 0));
      const paid = inr(Number(offer.already_paid ?? 0));
      const endsOn = new Date(offer.window_ends_at).toLocaleDateString("en-IN", {
        day: "numeric", month: "long", timeZone: "Asia/Kolkata",
      });

      const body = isDay7
        ? `Hi ${firstName}! You're one week into your Incline journey 💪 Upgrade to the Annual plan within your 15-day window and we'll adjust every rupee you've already paid (${paid}) against the Annual fee (${annual}) — your upgrade cost is just ${cost}. Reply UPGRADE to see your exact savings. Window ends ${endsOn}.`
        : `Hi ${firstName}, your annual-upgrade window closes in 72 hours (${endsOn}). Your ${paid} already paid still counts 100% toward the Annual plan — upgrade for just ${cost}. Reply UPGRADE before the window closes.`;

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
            annual_price: annual,
            already_paid: paid,
            upgrade_cost: cost,
            window_ends: endsOn,
          },
        },
        dedupe_key: `upgrade:${offer.id}:${isDay7 ? "d7" : "d12"}:wa`,
      });

      if (result.status === "failed") {
        failures.push(`${offer.id}: ${result.reason ?? "send failed"}`);
        continue;
      }

      await admin
        .from("upgrade_offers")
        .update({ status: isDay7 ? "day7_sent" : "day12_sent", updated_at: new Date().toISOString() })
        .eq("id", offer.id);
      if (isDay7) sentDay7++; else sentDay12++;
    }

    return new Response(
      JSON.stringify({
        success: true,
        date: today,
        expired: expired?.length ?? 0,
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
