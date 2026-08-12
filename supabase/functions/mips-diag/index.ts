import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPA_URL, SERVICE_KEY);

  try {
    const { data: devices, error: devErr } = await supabase
      .from("access_devices")
      .select("id, device_name, mips_device_id, is_online, branch_id");
    
    if (devErr) throw devErr;

    const { data: connections, error: connErr } = await supabase
      .from("mips_connections")
      .select("branch_id, server_url, is_active");
    
    if (connErr) throw connErr;

    const { data: recentErrors, error: errErr } = await supabase
      .from("mips_sync_attempts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);

    if (errErr) throw errErr;

    return new Response(JSON.stringify({
      devices,
      connections,
      recentErrors,
      env: {
        MIPS_SERVER_URL: Deno.env.get("MIPS_SERVER_URL"),
        MIPS_USERNAME: Deno.env.get("MIPS_USERNAME") ? "SET" : "MISSING"
      }
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
