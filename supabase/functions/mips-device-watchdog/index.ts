// mips-device-watchdog v1.2.0
//
// WHY: the Android turnstiles reboot silently. Nothing in the CRM ever noticed —
// `access_devices.is_online` was only refreshed when somebody pressed "Import
// devices". This worker polls the MIPS server device list, detects
// online → offline → online transitions, and writes an auditable restart trail
// to `access_device_health_events`.
//
// v1.2.0 — COMMAND-STORM DETECTION. The 21 Sep incident proved that a fast
// terminal restart (60–120 s heartbeat gap) is invisible to a 5-minute poll with
// a 6-minute staleness bar, so the card said "Stable 24h" while staff watched
// gates reboot. The thing we CAN see from here is the cause: a burst of gate
// commands for the same person. Every mips-access / sync-to-mips gate command
// is now in `mips_sync_attempts`; this tick counts them per gate over the last
// STORM_WINDOW_MIN minutes and records a `dispatch_storm` event when a gate is
// being hammered — with the top person named, so the fix is one click away.
//
// v1.1.0 — DAMPING. The MIPS server flags a device offline after a single
// missed 60s heartbeat, so ordinary packet jitter produced fake "restart"
// cards. We now ignore the server's onlineFlag on its own and require the
// device's own last heartbeat to be older than STALE_HEARTBEAT_SEC (two whole
// missed poll cycles) before calling a gate down. A gate must also have been
// down for at least MIN_DOWN_SEC before a recovery counts as a reboot.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getVerifiedMipsToken } from "../_shared/mipsTokenCache.ts";
import { getCachedMipsDevicesWithMeta } from "../_shared/mipsDeviceCache.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Heartbeat must be this stale before we believe a gate is really down. */
const STALE_HEARTBEAT_SEC = 360;
/** Shorter blips are jitter, never a reboot. */
const MIN_DOWN_SEC = 120;
/** Down and back within this window => the terminal rebooted. */
const RESTART_WINDOW_SEC = 15 * 60;
/** Dispatch traffic in this window before the drop is recorded as evidence. */
const BLAME_WINDOW_MIN = 10;
/** Storm detection window and thresholds (per gate). */
const STORM_WINDOW_MIN = 10;
const STORM_TOTAL_THRESHOLD = 12;
const STORM_PER_PERSON_THRESHOLD = 4;
/** Don't re-record the same storm / gap on every tick. */
const STORM_DEDUPE_MIN = 15;
/** Heartbeat age at poll time that means the gate has missed ≥2 beats. */
const GAP_MIN_SEC = 120;
/** MIPS server JVM timezone — timestamps arrive as bare wall-clock strings. */
const MIPS_TZ_OFFSET = "+05:30";

/** Parse "YYYY-MM-DD HH:mm:ss" (IST, no offset) or any ISO string to epoch ms. */
function parseMipsTime(raw: string): number {
  const s = raw.trim();
  if (/^\d+$/.test(s)) return Number(s) < 1e12 ? Number(s) * 1000 : Number(s);
  const iso = s.replace(" ", "T");
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso);
  return Date.parse(hasOffset ? iso : `${iso}${MIPS_TZ_OFFSET}`);
}



const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Auth + device roster now come from the shared caches in `_shared/` so this
// read-only worker no longer logs in or polls the heavy device-list endpoint
// on every tick.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPA_URL, SERVICE_KEY);

  try {
    const { data: connections, error: connErr } = await supabase
      .from("mips_connections")
      .select("branch_id, server_url, username, password")
      .eq("is_active", true);
    if (connErr) throw connErr;

    const nowIso = new Date().toISOString();
    const events: Array<Record<string, unknown>> = [];
    let checked = 0;
    let offline = 0;
    let recovered = 0;
    let restarts = 0;
    let storms = 0;
    let gaps = 0;


    for (const conn of connections || []) {
      const baseUrl = String(conn.server_url).replace(/\/+$/, "");
      let token: string;
      try {
        token = await getVerifiedMipsToken(supabase, conn.branch_id, {
          baseUrl,
          username: conn.username,
          password: conn.password,
        });
      } catch (e) {
        await supabase.from("access_device_health_events").insert({
          branch_id: conn.branch_id,
          event_type: "watchdog_error",
          details: { stage: "login", error: e instanceof Error ? e.message : String(e), base_url: baseUrl },
        });
        continue;
      }

      // Heartbeat ages are measured against the moment the roster was fetched
      // from MIPS (the shared cache may be up to 120 s old), never against now.
      const snapshot = await getCachedMipsDevicesWithMeta(supabase, conn.branch_id, baseUrl, token);
      const remote = snapshot.rows;
      const rosterAtMs = snapshot.fetchedAt;
      const remoteBySn = new Map<string, any>();
      for (const d of remote) {
        const sn = d.deviceKey || d.sn || d.serialNumber;
        if (sn) remoteBySn.set(String(sn), d);
      }

      const { data: locals } = await supabase
        .from("access_devices")
        .select("id, branch_id, serial_number, device_name, is_online, last_heartbeat, last_offline_at, restart_count")
        .eq("branch_id", conn.branch_id);

      for (const dev of locals || []) {
        const r = remoteBySn.get(String(dev.serial_number));
        if (!r) continue;
        checked++;

        // MIPS flips onlineFlag off after ONE missed 60s heartbeat — far too
        // twitchy. Trust the heartbeat clock instead: a gate is only down when
        // the server has not heard from it for two whole poll cycles.
        const flagOnline = r.onlineFlag === 1 || r.status === 1 || r.status === "1";
        const rawBeat = r.lastActiveTime || r.last_active_time || r.lastHeartbeat;
        // v1.2.0 — the MIPS server formats lastActiveTime in its JVM zone (IST,
        // e.g. "2026-09-21 20:49:40") with no offset. Parsing that bare string in
        // Deno treated it as UTC, pushing every heartbeat 5.5 h into the future,
        // so the age clamped to 0 and a gate could never be judged stale — the
        // reason the card read "Stable 24h" through a day of restarts.
        const beatMs = rawBeat ? parseMipsTime(String(rawBeat)) : NaN;
        const beatAgeSec = Number.isFinite(beatMs)
          ? Math.max(0, Math.round((rosterAtMs - beatMs) / 1000))
          : null;
        const heartbeatStale = beatAgeSec === null ? !flagOnline : beatAgeSec > STALE_HEARTBEAT_SEC;
        const isOnline = flagOnline || !heartbeatStale;
        // Gate beats every 60 s. Two missed beats at poll time is a real silence
        // window (a fast reboot lands here), even though it's too short to flip
        // the gate offline. Recorded as evidence, never as a restart.
        const missedBeats = beatAgeSec !== null && beatAgeSec >= GAP_MIN_SEC && beatAgeSec <= STALE_HEARTBEAT_SEC;

        const was = dev.is_online === true;
        const patch: Record<string, unknown> = {
          is_online: isOnline,
          last_reconcile_at: nowIso,
        };
        // Record the gate's OWN last heartbeat when the server gives us one, so
        // "last seen" in the fleet view is the terminal's truth, not our poll time.
        if (isOnline) patch.last_heartbeat = Number.isFinite(beatMs) ? new Date(beatMs).toISOString() : nowIso;

        if (was && !isOnline) {
          // ---- went down ----
          offline++;
          patch.last_offline_at = nowIso;

          const since = new Date(Date.now() - BLAME_WINDOW_MIN * 60_000).toISOString();
          const { count } = await supabase
            .from("mips_sync_attempts")
            .select("id", { count: "exact", head: true })
            .eq("device_id", dev.id)
            .gte("created_at", since);

          events.push({
            branch_id: dev.branch_id,
            device_id: dev.id,
            serial_number: dev.serial_number,
            device_name: dev.device_name,
            event_type: "offline",
            detected_at: nowIso,
            dispatches_before: count ?? 0,
            details: {
              blame_window_min: BLAME_WINDOW_MIN,
              last_heartbeat: dev.last_heartbeat,
              heartbeat_age_sec: beatAgeSec,
            },
          });
        } else if (!was && isOnline) {
          // ---- came back ----
          recovered++;
          const downSec = dev.last_offline_at
            ? Math.max(0, Math.round((Date.now() - Date.parse(String(dev.last_offline_at))) / 1000))
            : null;
          const looksLikeRestart =
            downSec !== null && downSec >= MIN_DOWN_SEC && downSec <= RESTART_WINDOW_SEC;


          const since = new Date(
            Date.parse(String(dev.last_offline_at || nowIso)) - BLAME_WINDOW_MIN * 60_000,
          ).toISOString();
          const { count } = await supabase
            .from("mips_sync_attempts")
            .select("id", { count: "exact", head: true })
            .eq("device_id", dev.id)
            .gte("created_at", since);

          events.push({
            branch_id: dev.branch_id,
            device_id: dev.id,
            serial_number: dev.serial_number,
            device_name: dev.device_name,
            event_type: looksLikeRestart ? "restart_suspected" : "recovered",
            detected_at: nowIso,
            offline_seconds: downSec,
            dispatches_before: count ?? 0,
            details: {
              went_offline_at: dev.last_offline_at,
              classification: looksLikeRestart
                ? "down and back within the reboot window — terminal restarted"
                : downSec !== null && downSec < MIN_DOWN_SEC
                  ? "brief blip — network jitter, not a reboot"
                  : "long outage — network or power, not a reboot",

            },
          });

          if (looksLikeRestart) {
            restarts++;
            patch.last_restart_at = nowIso;
            patch.restart_count = Number(dev.restart_count || 0) + 1;
            try {
              // NOTE: supabase.rpc() returns a PostgrestBuilder (thenable, no .catch)
              await supabase.rpc("log_error_event", {
                p_source: "mips_watchdog",
                p_severity: "warning",
                p_message: `Gate "${dev.device_name || dev.serial_number}" restarted (down ${downSec}s, ${count ?? 0} dispatches before)`,
                p_context: {
                  device_id: dev.id,
                  serial_number: dev.serial_number,
                  branch_id: dev.branch_id,
                  offline_seconds: downSec,
                  dispatches_before: count ?? 0,
                },
              });
            } catch (logErr) {
              console.warn("[mips-device-watchdog] log_error_event failed", logErr);
            }
          }
        }

        // ---- v1.2.0 missed-heartbeat evidence (gate still counted online) ----
        if (missedBeats && isOnline) {
          try {
            const dedupeSince = new Date(Date.now() - STORM_DEDUPE_MIN * 60_000).toISOString();
            const { count: already } = await supabase
              .from("access_device_health_events")
              .select("id", { count: "exact", head: true })
              .eq("device_id", dev.id)
              .eq("event_type", "heartbeat_gap")
              .gte("detected_at", dedupeSince);
            if (!already) {
              const blameSince = new Date(Date.now() - BLAME_WINDOW_MIN * 60_000).toISOString();
              const { count: cmds } = await supabase
                .from("mips_sync_attempts")
                .select("id", { count: "exact", head: true })
                .eq("device_id", dev.id)
                .eq("operation", "device_dispatch")
                .gte("created_at", blameSince);
              gaps++;
              events.push({
                branch_id: dev.branch_id,
                device_id: dev.id,
                serial_number: dev.serial_number,
                device_name: dev.device_name,
                event_type: "heartbeat_gap",
                detected_at: nowIso,
                offline_seconds: beatAgeSec,
                dispatches_before: cmds ?? 0,
                details: {
                  heartbeat_age_sec: beatAgeSec,
                  last_heartbeat: Number.isFinite(beatMs) ? new Date(beatMs).toISOString() : null,
                  server_online_flag: flagOnline,
                  classification: "gate missed 2+ heartbeats at poll time — consistent with a fast terminal-app restart",
                },
              });
            }
          } catch (gapErr) {
            console.warn("[mips-device-watchdog] gap detection failed (non-fatal)", gapErr);
          }
        }

        // ---- v1.2.0 command-storm detection (independent of online state) ----
        try {
          const stormSince = new Date(Date.now() - STORM_WINDOW_MIN * 60_000).toISOString();
          const { data: recent } = await supabase
            .from("mips_sync_attempts")
            .select("mips_person_id, entity_id, member_id, created_at")
            .eq("device_id", dev.id)
            .eq("operation", "device_dispatch")
            .gte("created_at", stormSince)
            .limit(500);
          const rows = (recent || []) as Array<{ mips_person_id: number | null; entity_id: string | null; member_id: string | null }>;
          if (rows.length) {
            const perPerson = new Map<string, number>();
            for (const r of rows) {
              const key = String(r.mips_person_id ?? r.member_id ?? r.entity_id ?? "?");
              perPerson.set(key, (perPerson.get(key) ?? 0) + 1);
            }
            let topKey = "";
            let topCount = 0;
            for (const [k, c] of perPerson) if (c > topCount) { topKey = k; topCount = c; }
            const isStorm = rows.length >= STORM_TOTAL_THRESHOLD || topCount >= STORM_PER_PERSON_THRESHOLD;
            if (isStorm) {
              const dedupeSince = new Date(Date.now() - STORM_DEDUPE_MIN * 60_000).toISOString();
              const { count: already } = await supabase
                .from("access_device_health_events")
                .select("id", { count: "exact", head: true })
                .eq("device_id", dev.id)
                .eq("event_type", "dispatch_storm")
                .gte("detected_at", dedupeSince);
              if (!already) {
                storms++;
                let topLabel = topKey;
                if (/^\d+$/.test(topKey)) {
                  const { data: who } = await supabase
                    .from("members")
                    .select("member_code, full_name")
                    .eq("mips_person_id", Number(topKey))
                    .maybeSingle();
                  if (who) topLabel = `${who.full_name ?? ""} (${who.member_code})`.trim();
                }
                events.push({
                  branch_id: dev.branch_id,
                  device_id: dev.id,
                  serial_number: dev.serial_number,
                  device_name: dev.device_name,
                  event_type: "dispatch_storm",
                  detected_at: nowIso,
                  dispatches_before: rows.length,
                  details: {
                    window_min: STORM_WINDOW_MIN,
                    total_commands: rows.length,
                    distinct_people: perPerson.size,
                    top_person: topLabel,
                    top_person_commands: topCount,
                    classification: "gate is being re-issued the same people repeatedly — this is what makes the terminal app restart",
                  },
                });
                try {
                  await supabase.rpc("log_error_event", {
                    p_source: "mips_watchdog",
                    p_severity: "warning",
                    p_message: `Gate "${dev.device_name || dev.serial_number}" command storm: ${rows.length} commands in ${STORM_WINDOW_MIN} min (top: ${topLabel} ×${topCount})`,
                    p_context: {
                      device_id: dev.id,
                      serial_number: dev.serial_number,
                      branch_id: dev.branch_id,
                      total_commands: rows.length,
                      top_person: topLabel,
                      top_person_commands: topCount,
                      window_min: STORM_WINDOW_MIN,
                    },
                  });
                } catch (logErr) {
                  console.warn("[mips-device-watchdog] storm log_error_event failed", logErr);
                }
              }
            }
          }
        } catch (stormErr) {
          console.warn("[mips-device-watchdog] storm detection failed (non-fatal)", stormErr);
        }

        await supabase.from("access_devices").update(patch).eq("id", dev.id);
      }
    }

    if (events.length) {
      const { error: insErr } = await supabase.from("access_device_health_events").insert(events);
      if (insErr) console.error("[mips-device-watchdog] health event insert failed:", insErr.message, events.map((e) => e.event_type));
    }

    console.log(
      `[mips-device-watchdog] checked=${checked} offline=${offline} recovered=${recovered} restarts=${restarts} storms=${storms} gaps=${gaps}`,
    );
    return json({ success: true, checked, offline, recovered, restarts, storms, gaps, events: events.length });
  } catch (e) {
    console.error("[mips-device-watchdog] fatal", e);
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
