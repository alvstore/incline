// mips-callback-audit v1.0.0 — TEMPORARY diagnostic.
// Reports (and optionally repairs) the per-device callback upload URLs on the
// MIPS middleware. Never returns secret values — URLs are redacted to
// host+path plus a boolean for "token query param present".
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function redact(url: unknown): string {
  if (typeof url !== "string" || !url) return "";
  try {
    const u = new URL(url);
    const hasToken = u.searchParams.has("token");
    return `${u.origin}${u.pathname}${hasToken ? " [+token]" : " [NO TOKEN]"}`;
  } catch {
    return String(url).slice(0, 60);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const secret = Deno.env.get("MIPS_WEBHOOK_SECRET") || "";
  const supabase = createClient(SUPA_URL, SERVICE_KEY);
  const fix = new URL(req.url).searchParams.get("fix") === "1";

  try {
    const { data: conns } = await supabase
      .from("mips_connections")
      .select("server_url, username, password, branch_id")
      .eq("is_active", true);

    const list = (conns ?? []).length
      ? conns!
      : [{
        server_url: Deno.env.get("MIPS_SERVER_URL")!,
        username: Deno.env.get("MIPS_USERNAME")!,
        password: Deno.env.get("MIPS_PASSWORD")!,
        branch_id: null,
      }];

    const out: unknown[] = [];
    for (const c of list) {
      const baseUrl = String(c.server_url).replace(/\/+$/, "");
      const loginJson = await (await fetch(`${baseUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "TENANT-ID": "1" },
        body: JSON.stringify({ username: c.username, password: c.password }),
      })).json();
      const token = loginJson.token || loginJson.data?.token;
      if (!token) { out.push({ server: baseUrl, error: "login failed" }); continue; }

      const listJson = await (await fetch(`${baseUrl}/through/device/list`, {
        headers: { Authorization: `Bearer ${token}`, "TENANT-ID": "1", Accept: "application/json" },
      })).json();
      const rows: any[] = listJson.rows || listJson.data || [];

      for (const r of rows) {
        const id = r.id ?? r.deviceId;
        if (id == null) continue;
        const detail = await (await fetch(`${baseUrl}/through/device/${id}`, {
          headers: { Authorization: `Bearer ${token}`, "TENANT-ID": "1", Accept: "application/json" },
        })).json();
        const dev = detail?.data;
        if (!dev) continue;
        const before = {
          record: redact(dev.sevUploadRecRecordUrl),
          heartbeat: redact(dev.sevUploadDevHeartbeatUrl),
          regPerson: redact(dev.sevUploadRegPersonUrl),
        };
        let after = before;
        if (fix && secret) {
          const base = `${SUPA_URL}/functions/v1/mips-webhook-receiver?token=${encodeURIComponent(secret)}`;
          delete dev.deviceRegion;
          dev.sevUploadRecRecordUrl = `${base}&event=record`;
          dev.sevUploadDevHeartbeatUrl = `${base}&event=heartbeat`;
          dev.sevUploadRegPersonUrl = `${base}&event=regPerson`;
          await fetch(`${baseUrl}/through/device`, {
            method: "PUT",
            headers: { Authorization: `Bearer ${token}`, "TENANT-ID": "1", "Content-Type": "application/json" },
            body: JSON.stringify(dev),
          });
          const verify = await (await fetch(`${baseUrl}/through/device/${id}`, {
            headers: { Authorization: `Bearer ${token}`, "TENANT-ID": "1", Accept: "application/json" },
          })).json();
          const v = verify?.data ?? {};
          after = {
            record: redact(v.sevUploadRecRecordUrl),
            heartbeat: redact(v.sevUploadDevHeartbeatUrl),
            regPerson: redact(v.sevUploadRegPersonUrl),
          };
        }
        out.push({
          server: baseUrl,
          device: r.deviceName || r.name,
          mips_device_id: id,
          online: r.onlineStatus ?? r.online ?? null,
          before,
          after,
        });
      }
    }

    return new Response(JSON.stringify({ secret_configured: Boolean(secret), fixed: fix, devices: out }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
