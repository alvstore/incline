// notify-booking-event v3.0.0
// Dispatches booking confirmations / cancellations / reminders for benefit
// (facility) slot bookings through the canonical `dispatch-communication`
// funnel — WhatsApp, Email, SMS, RCS and in-app, honouring member channel
// preferences, quiet hours and dedupe. Called fire-and-forget from
// book_facility_slot / cancel_facility_slot RPCs and by the reminder sweep.
//
// v3.0.0 — the caller now declares the exact `event_key` so the dispatcher
// resolves a universal FACILITY template instead of silently falling back to
// a class template (which produced "your booking for the class on at").

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type EventName =
  | "facility_slot_booked"
  | "facility_slot_cancelled"
  | "facility_slot_reminder";

const SUBJECTS: Record<EventName, string> = {
  facility_slot_booked: "Booking Confirmed",
  facility_slot_cancelled: "Booking Cancelled",
  facility_slot_reminder: "Session Reminder",
};

const DEFAULT_TEMPLATES: Record<EventName, string> = {
  facility_slot_booked:
    "Hi {{member_name}}, your {{benefit_name}} session is confirmed for {{slot_date}} at {{slot_time}} at {{branch_name}}. {{cancellation_policy}}",
  facility_slot_cancelled:
    "Hi {{member_name}}, your {{benefit_name}} booking for {{slot_date}} at {{slot_time}} has been cancelled. You can rebook anytime from the member app.",
  facility_slot_reminder:
    "Hi {{member_name}}, reminder: your {{benefit_name}} session is today at {{slot_time}} at {{branch_name}}. {{cancellation_policy}}",
};

const CHANNELS = ["whatsapp", "email", "sms"] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { event, booking_id } = await req.json();
    if (!event || !booking_id) {
      return json({ error: "Missing event or booking_id" }, 400);
    }
    const eventName = event as EventName;
    if (!SUBJECTS[eventName]) return json({ error: "Unknown event" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Booking + slot
    const { data: booking, error: bErr } = await supabase
      .from("benefit_bookings")
      .select(`
        id, status, member_id,
        slot:benefit_slots(id, slot_date, start_time, end_time, branch_id, benefit_type, benefit_type_id, facility_id)
      `)
      .eq("id", booking_id)
      .single();

    if (bErr || !booking) return json({ error: "Booking not found" }, 404);

    const slot = (booking as any).slot;
    if (!slot) return json({ error: "Slot not found" }, 404);
    const branchId = slot.branch_id;

    // 2. Member contact
    const { data: member } = await supabase
      .from("members")
      .select("user_id, member_code, profiles:user_id (full_name, phone, email)")
      .eq("id", booking.member_id)
      .single();
    const profile = (member as any)?.profiles;
    if (!member?.user_id) return json({ error: "Member profile missing" }, 404);

    // 3. Branch, benefit name, cancellation window
    const [{ data: branch }, { data: benefitType }, { data: facility }, { data: settings }] =
      await Promise.all([
        supabase.from("branches").select("name").eq("id", branchId).single(),
        slot.benefit_type_id
          ? supabase.from("benefit_types").select("name").eq("id", slot.benefit_type_id).single()
          : Promise.resolve({ data: null } as any),
        slot.facility_id
          ? supabase.from("facilities").select("name").eq("id", slot.facility_id).single()
          : Promise.resolve({ data: null } as any),
        supabase
          .from("benefit_settings")
          .select("cancellation_deadline_minutes, no_show_policy")
          .eq("branch_id", branchId)
          .eq("benefit_type", slot.benefit_type)
          .maybeSingle(),
      ]);

    const cancelMinutes = settings?.cancellation_deadline_minutes ?? 120;
    const cancelWindow =
      cancelMinutes >= 60
        ? `${Math.round(cancelMinutes / 60)} hour(s)`
        : `${cancelMinutes} minutes`;
    const cancellationPolicy =
      eventName === "facility_slot_cancelled"
        ? ""
        : `Cancellation policy: please cancel at least ${cancelWindow} before the slot${
            settings?.no_show_policy === "charge_penalty"
              ? " — late cancellations and no-shows may be charged."
              : " — late cancellations count as used."
          }`;

    // 4. Trigger config (optional per-branch override)
    const { data: trigger } = await supabase
      .from("whatsapp_triggers")
      .select("template_id, is_active")
      .eq("branch_id", branchId)
      .eq("event_name", eventName)
      .maybeSingle();

    if (trigger && trigger.is_active === false) {
      return json({ success: true, skipped: true, reason: "trigger_disabled" });
    }

    let body = DEFAULT_TEMPLATES[eventName];
    if (trigger?.template_id) {
      const { data: tmpl } = await supabase
        .from("whatsapp_templates")
        .select("body_text")
        .eq("id", trigger.template_id)
        .maybeSingle();
      if (tmpl?.body_text) body = tmpl.body_text;
    }

    const benefitName =
      benefitType?.name || facility?.name || slot.benefit_type || "your session";

    // Human-readable date/time (IST) so the message never reads "on at".
    const prettyDate = (() => {
      try {
        return new Date(`${slot.slot_date}T00:00:00+05:30`).toLocaleDateString("en-IN", {
          weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata",
        });
      } catch { return String(slot.slot_date ?? ""); }
    })();
    const prettyTime = (() => {
      const hhmm = String(slot.start_time || "").slice(0, 5);
      if (!/^\d{2}:\d{2}$/.test(hhmm)) return hhmm;
      const [h, m] = hhmm.split(":").map(Number);
      const suffix = h >= 12 ? "PM" : "AM";
      const h12 = h % 12 === 0 ? 12 : h % 12;
      return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
    })();

    // The dispatcher resolves the approved universal FACILITY templates via
    // trigger_event. Reminders reuse the confirmation template copy.
    const EVENT_KEYS: Record<EventName, string> = {
      facility_slot_booked: "facility_booked",
      facility_slot_cancelled: "facility_cancelled",
      facility_slot_reminder: "facility_reminder",
    };

    const vars: Record<string, string> = {
      event_key: EVENT_KEYS[eventName],
      member_name: profile?.full_name || "Member",
      // Canonical slots used by the approved facility templates.
      facility_name: benefitName,
      booking_date: prettyDate,
      booking_time: prettyTime,
      // Aliases kept so any other template shape still renders real values
      // instead of "the class on at".
      benefit_name: benefitName,
      slot_date: prettyDate,
      slot_time: prettyTime,
      session_name: benefitName,
      class_name: benefitName,
      class_date: prettyDate,
      class_time: prettyTime,
      branch_name: branch?.name || "Incline",
      cancellation_policy: cancellationPolicy,
    };

    for (const [k, v] of Object.entries(vars)) {
      body = body.split(`{{${k}}}`).join(v);
    }
    body = body.replace(/\s{2,}/g, " ").trim();


    const subject = SUBJECTS[eventName];
    const results: any[] = [];

    // 5. In-app notification
    try {
      await supabase.from("notifications").insert({
        user_id: member.user_id,
        branch_id: branchId,
        title: subject,
        message: body,
        type: eventName === "facility_slot_cancelled" ? "info" : "success",
        category: "benefit",
        action_url: "/my-benefits",
      });
      results.push({ channel: "in_app", success: true });
    } catch (e) {
      results.push({ channel: "in_app", success: false, error: String(e) });
    }

    // 6. External channels via the canonical dispatcher
    for (const channel of CHANNELS) {
      const recipient = channel === "email" ? profile?.email : profile?.phone;
      if (!recipient) continue;
      try {
        const { data, error } = await supabase.functions.invoke("dispatch-communication", {
          body: {
            branch_id: branchId,
            channel,
            category: "transactional",
            recipient,
            member_id: booking.member_id,
            user_id: member.user_id,
            payload: { subject, body, variables: vars, use_branded_template: channel === "email" },
            dedupe_key: `${eventName}:${booking_id}:${channel}`,
          },
        });
        results.push({ channel, success: !error, status: data?.status, error: error?.message });
      } catch (e) {
        results.push({ channel, success: false, error: String(e) });
      }
    }

    return json({ success: true, sent: results.filter((r) => r.success).length, results });
  } catch (e) {
    console.error("notify-booking-event error", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
