// notify-class-session v1.1.0
// v1.0.1: member deep-link → /book (member booking route); dispatcher provenance fields.
// Tells booked members when a class session is cancelled or changed (trainer /
// time / venue). Everything goes through the canonical `dispatch-communication`
// funnel — WhatsApp, SMS, Email and in-app — so channel toggles, member
// preferences, quiet hours and dedupe all apply. Only channels that are enabled
// for the branch are attempted.
//
// Called by the admin UI right after `cancel_class_session` /
// `override_class_session` / `delete_class_template` succeed. Safe to call
// again: dedupe keys make re-sends idempotent per member + channel.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type EventName = "session_cancelled" | "session_updated";
const EVENTS: EventName[] = ["session_cancelled", "session_updated"];
const CHANNELS = ["whatsapp", "sms", "email"] as const;

interface Body {
  class_id?: string;
  event?: EventName;
  member_ids?: string[];
  changes?: { trainer_changed?: boolean; time_changed?: boolean; venue_changed?: boolean };
  reason?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fmtIst(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(d).toUpperCase();
  return { date, time };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // ---- input ------------------------------------------------------------
    let body: Body;
    try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON body" }, 400); }
    const classId = String(body.class_id ?? "");
    const event = body.event as EventName;
    if (!UUID_RE.test(classId)) return json({ success: false, error: "class_id must be a UUID" }, 400);
    if (!EVENTS.includes(event)) return json({ success: false, error: "event must be session_cancelled or session_updated" }, 400);
    const explicitMembers = Array.isArray(body.member_ids)
      ? body.member_ids.filter((m) => typeof m === "string" && UUID_RE.test(m)).slice(0, 500)
      : null;
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 240) : "";

    // ---- authz: staff who can manage the class's branch ------------------
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const isServiceCall = token && token === serviceKey;
    let actorId: string | null = null;
    if (!isServiceCall) {
      const { data: userData } = await admin.auth.getUser(token);
      actorId = userData?.user?.id ?? null;
      if (!actorId) return json({ success: false, error: "Not authenticated" }, 401);
    }

    // ---- class + parent + branch -----------------------------------------
    const { data: cls, error: cErr } = await admin
      .from("classes")
      .select("id, branch_id, name, scheduled_at, duration_minutes, venue, trainer_id, external_trainer_name, cancelled_at, cancellation_reason, class_type_id, updated_at")
      .eq("id", classId)
      .maybeSingle();
    if (cErr) throw cErr;
    if (!cls) return json({ success: false, error: "Class not found" }, 404);

    if (!isServiceCall) {
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: allowed, error: aErr } = await userClient.rpc("can_manage_class_session", { p_branch_id: cls.branch_id });
      if (aErr || !allowed) return json({ success: false, error: "Not authorised for this branch" }, 403);
    }

    const [{ data: branch }, trainerName] = await Promise.all([
      admin.from("branches").select("name").eq("id", cls.branch_id).maybeSingle(),
      (async (): Promise<string> => {
        if (cls.external_trainer_name) return cls.external_trainer_name;
        if (!cls.trainer_id) return "";
        const { data: t } = await admin.from("trainers").select("user_id").eq("id", cls.trainer_id).maybeSingle();
        if (!t?.user_id) return "";
        const { data: p } = await admin.from("profiles").select("full_name").eq("id", t.user_id).maybeSingle();
        return p?.full_name ?? "";
      })(),
    ]);

    // ---- recipients ---------------------------------------------------------
    let memberIds: string[] = explicitMembers ?? [];
    // v1.1.0 — explicit recipients must actually be booked on this class.
    if (memberIds.length) {
      const { data: bk } = await admin.from("class_bookings").select("member_id").eq("class_id", classId).in("member_id", memberIds);
      const okIds = new Set((bk ?? []).map((r) => r.member_id));
      memberIds = memberIds.filter((m) => okIds.has(m));
      if (memberIds.length === 0) return json({ success: false, error: "Selected members are not booked on this class" }, 400);
    }
    if (memberIds.length === 0) {
      if (event === "session_cancelled") {
        const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
        const { data: rows } = await admin
          .from("class_bookings")
          .select("member_id")
          .eq("class_id", classId)
          .eq("status", "cancelled")
          .gte("cancelled_at", since)
          .ilike("cancellation_reason", "Class cancelled by the gym%");
        memberIds = (rows ?? []).map((r) => r.member_id);
      } else {
        const { data: rows } = await admin
          .from("class_bookings")
          .select("member_id")
          .eq("class_id", classId)
          .eq("status", "booked");
        memberIds = (rows ?? []).map((r) => r.member_id);
      }
    }
    memberIds = [...new Set(memberIds)];

    if (memberIds.length === 0) {
      if (event === "session_cancelled") {
        await admin.from("classes").update({ cancellation_notified_at: new Date().toISOString() }).eq("id", classId);
      }
      return json({ success: true, members: 0, sent: 0, results: [] });
    }

    const { data: members } = await admin
      .from("members")
      .select("id, user_id, branch_id")
      .in("id", memberIds);
    const userIds = (members ?? []).map((m) => m.user_id).filter((u): u is string => !!u);
    const { data: profiles } = userIds.length
      ? await admin.from("profiles").select("id, full_name, phone, email").in("id", userIds)
      : { data: [] as { id: string; full_name: string | null; phone: string | null; email: string | null }[] };
    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

    // ---- enabled channels for this branch ----------------------------------
    const enabled: Record<string, boolean> = {};
    await Promise.all(CHANNELS.map(async (ch) => {
      try {
        const { data } = await admin.rpc("channel_active_for_branch", { p_branch_id: cls.branch_id, p_channel: ch });
        enabled[ch] = data !== false; // null/undefined → let the dispatcher decide
      } catch { enabled[ch] = true; }
    }));

    // ---- message ------------------------------------------------------------
    const { date, time } = fmtIst(cls.scheduled_at);
    const branchName = branch?.name ?? "Incline";
    const venue = cls.venue ?? "";
    const trainerLine = trainerName ? ` with ${trainerName}` : "";
    const venueLine = venue ? ` (${venue})` : "";
    const changes = body.changes ?? {};
    const changedBits: string[] = [];
    if (changes.time_changed) changedBits.push("time");
    if (changes.trainer_changed) changedBits.push("trainer");
    if (changes.venue_changed) changedBits.push("venue");
    const changeSummary = changedBits.length ? changedBits.join(" and ") : "details";

    const subject = event === "session_cancelled"
      ? `${cls.name} on ${date} is cancelled`
      : `${cls.name} on ${date} — schedule update`;
    const bodyTemplate = event === "session_cancelled"
      ? `Hi {{member_name}}, your ${cls.name} class on ${date} at ${time} at ${branchName} has been cancelled${reason ? ` (${reason})` : ""}. Any class credit used for this booking has been returned. You can book another session from the app.`
      : `Hi {{member_name}}, the ${changeSummary} for your ${cls.name} class on ${date} has been updated. It now runs at ${time}${trainerLine}${venueLine} at ${branchName}. Your booking remains confirmed.`;

    const version = new Date(cls.updated_at ?? Date.now()).getTime();
    const results: Array<{ member_id: string; channel: string; success: boolean; status?: string; error?: string }> = [];

    for (const m of members ?? []) {
      const profile = m.user_id ? profileById.get(m.user_id) : undefined;
      const memberName = profile?.full_name?.split(" ")[0] || "Member";
      const text = bodyTemplate.replaceAll("{{member_name}}", memberName);
      const vars: Record<string, string> = {
        event_key: "class_schedule_change",
        member_name: memberName,
        class_name: cls.name,
        class_date: date,
        class_time: time,
        class_when: `${date}, ${time}`,
        class_trainer: trainerName || "Incline team",
        class_venue: venue || branchName,
        branch_name: branchName,
        change_type: event === "session_cancelled" ? "cancelled" : "updated",
        reason,
      };

      // in-app (always)
      if (m.user_id) {
        try {
          await admin.from("notifications").insert({
            user_id: m.user_id,
            branch_id: cls.branch_id,
            title: subject,
            message: text,
            type: event === "session_cancelled" ? "warning" : "info",
            category: "booking",
            action_url: "/book?type=classes",
          });
          results.push({ member_id: m.id, channel: "in_app", success: true });
        } catch (e) {
          results.push({ member_id: m.id, channel: "in_app", success: false, error: String(e) });
        }
      }

      for (const channel of CHANNELS) {
        if (enabled[channel] === false) continue;
        const recipient = channel === "email" ? profile?.email : profile?.phone;
        if (!recipient) continue;
        const dedupeKey = event === "session_cancelled"
          ? `class_session_cancelled:${classId}:${m.id}:${channel}`
          : `class_session_updated:${classId}:${version}:${m.id}:${channel}`;
        try {
          const { data, error } = await admin.functions.invoke("dispatch-communication", {
            body: {
              branch_id: cls.branch_id,
              channel,
              category: "transactional",
              recipient,
              member_id: m.id,
              user_id: m.user_id,
              payload: { subject, body: text, variables: vars, use_branded_template: channel === "email" },
              dedupe_key: dedupeKey,
              force: true,
              source_caller: `notify-class-session:${event}`,
              source_type: "transactional",
            },
          });
          results.push({ member_id: m.id, channel, success: !error, status: (data as { status?: string } | null)?.status, error: error?.message });
        } catch (e) {
          results.push({ member_id: m.id, channel, success: false, error: String(e) });
        }
      }
    }

    if (event === "session_cancelled") {
      await admin.from("classes").update({ cancellation_notified_at: new Date().toISOString() }).eq("id", classId);
    }

    const sent = results.filter((r) => r.success && r.channel !== "in_app").length;
    return json({ success: true, members: (members ?? []).length, sent, channels: enabled, results });
  } catch (e) {
    console.error("notify-class-session error", e);
    return json({ success: false, error: (e as Error).message ?? String(e) }, 500);
  }
});
