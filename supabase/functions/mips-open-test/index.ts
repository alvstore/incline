import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const body = await req.json();
  const { device_id, branch_id } = body;

  const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPA_URL, SERVICE_KEY);

  let mipsServerUrl = Deno.env.get("MIPS_SERVER_URL")!;
  let mipsUsername = Deno.env.get("MIPS_USERNAME")!;
  let mipsPassword = Deno.env.get("MIPS_PASSWORD")!;

  if (branch_id) {
    const { data: conn } = await supabase
      .from("mips_connections")
      .select("server_url, username, password")
      .eq("branch_id", branch_id)
      .eq("is_active", true)
      .maybeSingle();
    if (conn) {
      mipsServerUrl = conn.server_url;
      mipsUsername = conn.username;
      mipsPassword = conn.password;
    }
  }

  const baseUrl = mipsServerUrl.replace(/\/+$/, "");

  const loginRes = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "TENANT-ID": "1" },
    body: JSON.stringify({ username: mipsUsername, password: mipsPassword }),
  });
  const loginJson = await loginRes.json();
  const token = loginJson.token || loginJson.data?.token;

  if (!token) {
    return new Response(JSON.stringify({ error: "Auth failed", loginRes: loginJson }), { status: 500, headers: corsHeaders });
  }

  // Try standard POST control first
  const controlRes = await fetch(`${baseUrl}/through/device/control`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "TENANT-ID": "1",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ deviceId: device_id, command: "open" })
  });
  const controlJson = await controlRes.json();

  // Try legacy GET openDoor second
  const legacyRes = await fetch(`${baseUrl}/through/device/openDoor/${device_id}`, {
    method: "GET",
    headers: { "Authorization": `Bearer ${token}`, "TENANT-ID": "1" }
  });
  const legacyJson = await legacyRes.json();

  return new Response(JSON.stringify({
    deviceId: device_id,
    control: controlJson,
    legacy: legacyJson
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
