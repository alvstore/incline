// mips-face-parity v1.0.0
// Reconciles FACE (photo) enrolment across every MIPS device of a branch.
//
// Problem it solves: the MIPS server holds N persons with photos, but each
// turnstile can end up with a different face count (e.g. Gate 1 = 41,
// Gate 2 = 31) when a syncPerson dispatch silently failed for one device.
//
// Actions:
//   { action: "report", branch_id? }  → per-device persons/faces + server photo count
//   { action: "resync", branch_id?, device_ids?: number[] }
//        → re-dispatch every person that HAS a photo to the given devices
//          (defaults to all devices on the branch).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function login(baseUrl: string, username: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "TENANT-ID": "1" },
    body: JSON.stringify({ username, password }),
  });
  const text = await res.text();
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error(`MIPS login non-JSON: ${text.slice(0, 200)}`); }
  const token = j.token || j.data?.token;
  if (!token) throw new Error(`MIPS login failed: ${j.msg || text.slice(0, 200)}`);
  return token;
}

const authHeaders = (token: string) => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${token}`,
  "TENANT-ID": "1",
});

async function getJson(url: string, token: string) {
  const res = await fetch(url, { method: "GET", headers: authHeaders(token) });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(SUPA_URL, SERVICE_KEY);

    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (bearer !== SERVICE_KEY) {
      if (!bearer) return json({ error: "Unauthorized" }, 401);
      const { data: userRes } = await supabase.auth.getUser(bearer);
      const uid = userRes?.user?.id;
      if (!uid) return json({ error: "Unauthorized" }, 401);
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", uid);
      const allowed = new Set(["owner", "admin", "manager"]);
      if (!(roles || []).some((r: any) => allowed.has(r.role))) return json({ error: "Forbidden" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const { action = "report", branch_id, device_ids } = body as {
      action?: "report" | "resync";
      branch_id?: string;
      device_ids?: number[];
    };

    // Resolve MIPS connection (branch-scoped, env fallback)
    let serverUrl = Deno.env.get("MIPS_SERVER_URL") || "";
    let username = Deno.env.get("MIPS_USERNAME") || "";
    let password = Deno.env.get("MIPS_PASSWORD") || "";
    if (branch_id) {
      const { data: conn } = await supabase
        .from("mips_connections")
        .select("server_url, username, password")
        .eq("branch_id", branch_id)
        .eq("is_active", true)
        .maybeSingle();
      if (conn) {
        serverUrl = conn.server_url;
        username = conn.username;
        password = conn.password;
      }
    }
    if (!serverUrl) return json({ error: "No MIPS server configured" }, 400);
    const baseUrl = serverUrl.replace(/\/+$/, "");
    const token = await login(baseUrl, username, password);

    // 1. Device inventory from the MIPS server
    const devJson = await getJson(`${baseUrl}/through/device/list`, token);
    const devRows: any[] = devJson?.rows || devJson?.data || [];
    const devices = devRows.map((d) => ({
      id: Number(d.id ?? d.deviceId),
      sn: String(d.deviceKey || d.sn || d.serialNumber || ""),
      name: d.deviceName || d.name || "",
      persons: Number(d.personCount ?? d.personNum ?? 0),
      faces: Number(d.photoCount ?? d.faceCount ?? d.faceNum ?? 0),
      online: d.onlineFlag === 1 || d.status === 1 || d.status === "1",
    })).filter((d) => !isNaN(d.id));

    // 2. All persons on the server, keeping only those that carry a photo
    const persons: Array<{ id: number; personSn: string; name: string; hasPhoto: boolean }> = [];
    for (let page = 1; page <= 20; page++) {
      const pj = await getJson(
        `${baseUrl}/personInfo/person/list?pageNum=${page}&pageSize=100`,
        token,
      );
      const rows: any[] = pj?.rows || pj?.data?.rows || pj?.data || [];
      if (!Array.isArray(rows) || rows.length === 0) break;
      for (const p of rows) {
        persons.push({
          id: Number(p.id ?? p.personId),
          personSn: String(p.personSn || p.personNo || ""),
          name: p.personName || p.name || "",
          hasPhoto: Boolean(p.photoUri || p.havePhoto || p.photoUrl),
        });
      }
      if (rows.length < 100) break;
    }
    const withPhoto = persons.filter((p) => p.hasPhoto && !isNaN(p.id));

    if (action === "report") {
      const maxFaces = devices.reduce((m, d) => Math.max(m, d.faces), 0);
      return json({
        success: true,
        server_persons: persons.length,
        server_persons_with_photo: withPhoto.length,
        devices: devices.map((d) => ({
          ...d,
          faces_missing: Math.max(withPhoto.length - d.faces, 0),
          lagging: d.faces < maxFaces,
        })),
      });
    }

    // 3. Re-dispatch every photo-bearing person to the target devices
    const targets = (device_ids && device_ids.length ? device_ids : devices.map((d) => d.id))
      .map(Number)
      .filter((n) => !isNaN(n));
    if (targets.length === 0) return json({ error: "No target devices" }, 400);

    let ok = 0;
    let failed = 0;
    const errors: string[] = [];
    for (const p of withPhoto) {
      try {
        const res = await fetch(`${baseUrl}/through/device/syncPerson`, {
          method: "POST",
          headers: authHeaders(token),
          body: JSON.stringify({ personId: p.id, deviceIds: targets, deviceNumType: "4" }),
        });
        const text = await res.text();
        let j: any;
        try { j = JSON.parse(text); } catch { j = { raw: text }; }
        if (res.ok && (j.code === 200 || j.code === 0 || j.raw)) ok++;
        else {
          failed++;
          if (errors.length < 10) errors.push(`${p.personSn}: ${j.msg || text.slice(0, 120)}`);
        }
      } catch (e) {
        failed++;
        if (errors.length < 10) errors.push(`${p.personSn}: ${e instanceof Error ? e.message : String(e)}`);
      }
      // gentle pacing so the server queue does not drop dispatches
      await new Promise((r) => setTimeout(r, 60));
    }

    return json({
      success: true,
      dispatched: ok,
      failed,
      total_with_photo: withPhoto.length,
      target_device_ids: targets,
      errors,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
