import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function getBaseUrl(overrideUrl?: string): string {
  return (overrideUrl || Deno.env.get("MIPS_SERVER_URL")!).replace(/\/+$/, "");
}

async function login(baseUrl: string, user: string, pass: string): Promise<string> {
  const res = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "TENANT-ID": "1" },
    body: JSON.stringify({ username: user, password: pass }),
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { throw new Error(`Login non-JSON: ${text.slice(0, 200)}`); }
  const token = json.token || json.data?.token;
  if (!token) throw new Error(`Login failed: ${json.msg || text.slice(0, 200)}`);
  return token;
}

const authHeaders = (token: string) => ({
  "Content-Type": "application/json",
  "Authorization": `Bearer ${token}`,
  "TENANT-ID": "1",
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(SUPA_URL, SERVICE_KEY);

    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (bearer !== SERVICE_KEY) {
      const { data: userRes } = await supabase.auth.getUser(bearer);
      if (!userRes?.user?.id) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
    }

    const mipsUrl = Deno.env.get("MIPS_SERVER_URL") || "";
    const mipsUser = Deno.env.get("MIPS_USERNAME") || "";
    const mipsPass = Deno.env.get("MIPS_PASSWORD") || "";
    const baseUrl = getBaseUrl(mipsUrl);
    const token = await login(baseUrl, mipsUser, mipsPass);

    // Endpoint for manual person data modification (often used to clear invalid flags)
    const personList = await fetch(`${baseUrl}/personInfo/person/list?pageNum=1&pageSize=10`, {
      method: "GET",
      headers: authHeaders(token),
    }).then(r => r.json());

    // Check version
    const versionInfo = await fetch(`${baseUrl}/system/config/configKey/sys.index.sideTheme`, {
      method: "GET",
      headers: authHeaders(token),
    }).then(r => r.json()).catch(() => ({ error: "config endpoint failed" }));

    return new Response(JSON.stringify({
      server: baseUrl,
      version_hint: versionInfo,
      sample_persons: personList.rows?.slice(0, 2),
      message: "Diagnostics complete. Checking MIPS server API profile."
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
