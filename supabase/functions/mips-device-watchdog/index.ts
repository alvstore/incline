// mips-device-watchdog v1.0.0
//
// WHY: the Android turnstiles reboot silently. Nothing in the CRM ever noticed —
// `access_devices.is_online` was only refreshed when somebody pressed "Import
// devices". This worker polls the MIPS server device list, detects
// online → offline → online transitions, and writes an auditable restart trail
// to `access_device_health_events`.
//
// A gate that drops and comes back within RESTART_WINDOW_SEC is a REBOOT, not a
// network outage: the Android box goes down and the whole OS comes back in
// 60-180s. We also count how many person dispatches hit that gate in the
// minutes before it fell over, which is the evidence that links a reboot to a
// face-template rebuild storm.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Down and back within this window => the terminal rebooted. */
const RESTART_WINDOW_SEC = 15 * 60;
/** Dispatch traffic in this window before the drop is recorded as evidence. */
const BLAME_WINDOW_MIN = 10;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function login(baseUrl: string, username: string, password: string) {
  const res = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "TENANT-ID": "1" },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  const token = body.token || body.data?.token;
  if (!token) throw new Error(`MIPS login failed: ${body.msg || res.status}`);
  return token as string;
}

async function listDevices(baseUrl: string, token: string) {
  const res = await fetch(`${baseUrl}/through/device/list`, {
    headers: { Authorization: `Bearer ${token}`, "TENANT-ID": "1", Accept: "application/json" },
  });
  const body = await res.json();
  const rows: any[] = body.rows || body.data || [];
  return Array.isArray(rows) ? rows : [];
}

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

    for (const conn of connections || []) {
      const baseUrl = String(conn.server_url).replace(/\/+$/, "");
      let token: string;
      try {
        token = await login(baseUrl, conn.username, conn.password);
      } catch (e) {
        await supabase.from("access_device_health_events").insert({
          branch_id: conn.branch_id,
          event_type: "watchdog_error",
          details: { stage: "login", error: e instanceof Error ? e.message : String(e), base_url: baseUrl },
        });
        continue;
      }

      const remote = await listDevices(baseUrl, token);
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

        const isOnline = r.onlineFlag === 1 || r.status === 1 || r.status === "1";
        const was = dev.is_online === true;
        const patch: Record<string, unknown> = {
          is_online: isOnline,
          last_reconcile_at: nowIso,
        };
        if (isOnline) patch.last_heartbeat = nowIso;

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
            details: { blame_window_min: BLAME_WINDOW_MIN, last_heartbeat: dev.last_heartbeat },
          });
        } else if (!was && isOnline) {
          // ---- came back ----
          recovered++;
          const downSec = dev.last_offline_at
            ? Math.max(0, Math.round((Date.now() - Date.parse(String(dev.last_offline_at))) / 1000))
            : null;
          const looksLikeRestart = downSec !== null && downSec <= RESTART_WINDOW_SEC;

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
                : "long outage — network or power, not a reboot",
            },
          });

          if (looksLikeRestart) {
            restarts++;
            patch.last_restart_at = nowIso;
            patch.restart_count = Number(dev.restart_count || 0) + 1;
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
            }).catch(() => {});
          }
        }

        await supabase.from("access_devices").update(patch).eq("id", dev.id);
      }
    }

    if (events.length) {
      await supabase.from("access_device_health_events").insert(events);
    }

    console.log(
      `[mips-device-watchdog] checked=${checked} offline=${offline} recovered=${recovered} restarts=${restarts}`,
    );
    return json({ success: true, checked, offline, recovered, restarts, events: events.length });
  } catch (e) {
    console.error("[mips-device-watchdog] fatal", e);
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
