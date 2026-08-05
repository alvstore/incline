// send-benefit-slot-reminders v1.0.0
// Cron worker (Automation Brain rule `benefit_slot_reminders`). Finds confirmed
// facility/benefit bookings whose slot starts inside the reminder window and
// fires `facility_slot_reminder` through notify-booking-event (which routes via
// the canonical dispatch-communication funnel). Dedupe is handled downstream by
// the dedupe_key `facility_slot_reminder:<booking_id>:<channel>`.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-system-call",
};

const DEFAULT_LEAD_HOURS = 3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const started = Date.now();
  try {
    const payload = await req.json().catch(() => ({}));
    const leadHours = Number(payload?.lead_hours ?? DEFAULT_LEAD_HOURS);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const now = new Date();
    const until = new Date(now.getTime() + leadHours * 3600_000);
    // Slots are stored as IST date + time; compare in IST.
    const istDate = (d: Date) =>
      new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const istTime = (d: Date) =>
      new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(11, 19);

    const { data: bookings, error } = await supabase
      .from("benefit_bookings")
      .select("id, status, slot:benefit_slots!inner(slot_date, start_time)")
      .in("status", ["booked", "confirmed"])
      .gte("slot.slot_date", istDate(now))
      .lte("slot.slot_date", istDate(until));

    if (error) throw error;

    let sent = 0;
    const errors: string[] = [];

    for (const b of bookings || []) {
      const slot = (b as any).slot;
      if (!slot) continue;
      const startsAt = new Date(`${slot.slot_date}T${slot.start_time}+05:30`);
      if (startsAt < now || startsAt > until) continue;

      try {
        const { error: invokeErr } = await supabase.functions.invoke("notify-booking-event", {
          body: { event: "facility_slot_reminder", booking_id: b.id },
        });
        if (invokeErr) errors.push(`${b.id}: ${invokeErr.message}`);
        else sent++;
      } catch (e) {
        errors.push(`${b.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const result = {
      ok: true,
      took_ms: Date.now() - started,
      lead_hours: leadHours,
      window_end_ist: `${istDate(until)} ${istTime(until)}`,
      candidates: bookings?.length ?? 0,
      sent,
      errors,
    };
    console.log(`[send-benefit-slot-reminders] ${JSON.stringify(result)}`);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[send-benefit-slot-reminders]", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
