// mips-import-devices v1.1.0 — bulk-upsert MIPS server devices into access_devices,
// Safe to run repeatedly (cron-friendly). Never overwrites branch_id/door_role/public_ip
// if already set by an admin. Called by MIPSDevicesTab "Import all" button.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
  const supabase = createClient(SUPA_URL, SERVICE_KEY);

  // Auth gate: allow service-role OR any staff-role JWT
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (bearer !== SERVICE_KEY) {
    if (!bearer) return json({ error: "Unauthorized" }, 401);
    const { data: userRes } = await supabase.auth.getUser(bearer);
    const uid = userRes?.user?.id;
    if (!uid) return json({ error: "Unauthorized" }, 401);
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", uid);
    const allowed = new Set(["owner", "admin", "manager", "staff"]);
    if (!(roles || []).some((r: any) => allowed.has(r.role))) return json({ error: "Forbidden" }, 403);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const branchId: string | undefined = body.branch_id;

    // Resolve per-branch MIPS connection
    let serverUrl = Deno.env.get("MIPS_SERVER_URL")!;
    let username = Deno.env.get("MIPS_USERNAME")!;
    let password = Deno.env.get("MIPS_PASSWORD")!;
    if (branchId) {
      const { data: conn } = await supabase
        .from("mips_connections")
        .select("server_url, username, password")
        .eq("branch_id", branchId).eq("is_active", true).maybeSingle();
      if (conn) { serverUrl = conn.server_url; username = conn.username; password = conn.password; }
    }
    const baseUrl = serverUrl.replace(/\/+$/, "");

    // Login
    const loginRes = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "TENANT-ID": "1" },
      body: JSON.stringify({ username, password }),
    });
    const loginJson = await loginRes.json();
    const token = loginJson.token || loginJson.data?.token;
    if (!token) return json({ error: `MIPS login failed: ${loginJson.msg}` }, 502);

    // List devices
    const listRes = await fetch(`${baseUrl}/through/device/list`, {
      headers: { "Authorization": `Bearer ${token}`, "TENANT-ID": "1", "Accept": "application/json" },
    });
    const listJson = await listRes.json();
    const rows: any[] = listJson.rows || listJson.data || [];
    if (!Array.isArray(rows)) return json({ error: "MIPS returned no device list" }, 502);

    // Callback URLs (record upload / heartbeat / person registration) are wiped
    // by a device factory reset. We re-assert them here on every import so the
    // fleet self-heals — and we report which gates still refuse to keep them,
    // because on firmware 1.42.x these fields are owned by the terminal's own
    // settings screen and the server-side PUT is silently ignored.
    // The receiver requires the shared secret, so the URL we push MUST carry
    // `?token=` — without it every forwarded scan is rejected with 401.
    const webhookSecret = Deno.env.get("MIPS_WEBHOOK_SECRET") || "";
    const callbackBase = `${SUPA_URL}/functions/v1/mips-webhook-receiver${
      webhookSecret ? `?token=${encodeURIComponent(webhookSecret)}&` : "?"
    }`;
    const callbacks: Array<Record<string, unknown>> = [];

    let imported = 0, updated = 0, skipped = 0;

    for (const d of rows) {
      const sn: string = d.deviceKey || d.sn || d.serialNumber || "";
      if (!sn) { skipped++; continue; }
      const name = d.deviceName || d.name || sn;
      const ip = d.ip || d.ipAddress || "0.0.0.0";
      const online = d.onlineFlag === 1 || d.status === 1 || d.status === "1";
      const mipsId = d.id ?? d.deviceId ?? null;

      // Does it exist?
      const { data: existing } = await supabase
        .from("access_devices")
        .select("id, branch_id")
        .eq("serial_number", sn)
        .maybeSingle();

      if (existing) {
        await supabase.from("access_devices").update({
          device_name: name,
          mips_device_id: mipsId,
          is_online: online,
          last_heartbeat: online ? new Date().toISOString() : null,
          last_reconcile_at: new Date().toISOString(),
        }).eq("id", existing.id);
        updated++;
      } else if (branchId) {
        const { error } = await supabase.from("access_devices").insert({
          branch_id: branchId,
          serial_number: sn,
          device_name: name,
          ip_address: ip,
          mips_device_id: mipsId,
          is_online: online,
          door_role: "both",
          last_heartbeat: online ? new Date().toISOString() : null,
          last_reconcile_at: new Date().toISOString(),
        });
        if (error) { console.warn("insert failed", sn, error.message); skipped++; }
        else imported++;
      } else {
        skipped++; // no branch — cannot insert
      }
      // Re-assert the device callbacks and verify they stuck.
      if (mipsId != null) {
        try {
          const detail = await (await fetch(`${baseUrl}/through/device/${mipsId}`, {
            headers: { "Authorization": `Bearer ${token}`, "TENANT-ID": "1", "Accept": "application/json" },
          })).json();
          const dev = detail?.data;
          if (dev) {
            delete dev.deviceRegion;
            dev.sevUploadRecRecordUrl = `${callbackBase}?event=record`;
            dev.sevUploadDevHeartbeatUrl = `${callbackBase}?event=heartbeat`;
            dev.sevUploadRegPersonUrl = `${callbackBase}?event=regPerson`;
            await fetch(`${baseUrl}/through/device`, {
              method: "PUT",
              headers: { "Authorization": `Bearer ${token}`, "TENANT-ID": "1", "Content-Type": "application/json" },
              body: JSON.stringify(dev),
            });
            const after = await (await fetch(`${baseUrl}/through/device/${mipsId}`, {
              headers: { "Authorization": `Bearer ${token}`, "TENANT-ID": "1", "Accept": "application/json" },
            })).json();
            const persisted = !!after?.data?.sevUploadRegPersonUrl;
            callbacks.push({
              device: name,
              mips_device_id: mipsId,
              configured: persisted,
              hint: persisted
                ? undefined
                : "This firmware keeps callback URLs on the terminal itself — set them in the device's on-screen settings. Access events still arrive via record reconciliation.",
            });
          }
        } catch (e) {
          callbacks.push({ device: name, mips_device_id: mipsId, configured: false, error: String(e) });
        }
      }
    }

    return json({ success: true, imported, updated, skipped, total: rows.length, callbacks });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("mips-import-devices error:", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
