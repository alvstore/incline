import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

let cachedToken: string | null = null;
let tokenExpiry = 0;
let cachedBaseUrl = "";

function getBaseUrl(overrideUrl?: string): string {
  return (overrideUrl || Deno.env.get("MIPS_SERVER_URL")!).replace(/\/+$/, "");
}

async function getRuoYiToken(baseUrl: string, username: string, password: string): Promise<string> {
  // Simple cache — only valid if same server
  if (cachedToken && Date.now() < tokenExpiry && cachedBaseUrl === baseUrl) return cachedToken;

  console.log(`RuoYi auth: POST ${baseUrl}/login`);

  const res = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "TENANT-ID": "1" },
    body: JSON.stringify({ username, password }),
  });

  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`RuoYi login returned non-JSON: ${text.substring(0, 300)}`);
  }

  if (json.code !== 200 && json.code !== 0) {
    throw new Error(`RuoYi login failed (code=${json.code}): ${json.msg || JSON.stringify(json)}`);
  }

  cachedToken = json.token || json.data?.token;
  if (!cachedToken) throw new Error(`No token in RuoYi login response: ${JSON.stringify(json)}`);
  tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
  cachedBaseUrl = baseUrl;
  return cachedToken!;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ---- AUTH GATE (v1.1.0) ----
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "");
    const isService = bearer && bearer === SERVICE_KEY;
    if (!isService) {
      if (!bearer) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const authClient = createClient(SUPA_URL, SERVICE_KEY);
      const { data: userRes } = await authClient.auth.getUser(bearer);
      const uid = userRes?.user?.id;
      if (!uid) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: roles } = await authClient
        .from("user_roles").select("role").eq("user_id", uid);
      const allowed = new Set(["owner", "admin", "manager", "staff"]);
      const hasRole = (roles || []).some((r: any) => allowed.has(r.role));
      if (!hasRole) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const body = await req.json();

    const { endpoint, method = "GET", params, data, branch_id } = body as {
      endpoint: string;
      method?: string;
      params?: Record<string, string>;
      data?: Record<string, unknown>;
      branch_id?: string;
    };

    if (!endpoint) {
      return new Response(JSON.stringify({ error: "Missing endpoint" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // v1.2.0 — SSRF guard: endpoint must be a relative path, no host overrides.
    if (typeof endpoint !== "string" || !endpoint.startsWith("/") || /@|\.\.|\/\/|https?:/i.test(endpoint)) {
      return new Response(JSON.stringify({ error: "Invalid endpoint — must be a relative path starting with /" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    // Look up per-branch MIPS connection (fall back to env vars)
    let mipsServerUrl = Deno.env.get("MIPS_SERVER_URL")!;
    let mipsUsername = Deno.env.get("MIPS_USERNAME")!;
    let mipsPassword = Deno.env.get("MIPS_PASSWORD")!;

    if (branch_id) {
      try {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );
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
      } catch (e) {
        console.warn("Failed to look up mips_connections, using env defaults:", e);
      }
    }

    const baseUrl = getBaseUrl(mipsServerUrl);
    const token = await getRuoYiToken(baseUrl, mipsUsername, mipsPassword);

    let url = `${baseUrl}${endpoint}`;
    if (params) {
      const searchParams = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) searchParams.set(k, v);
      url += `?${searchParams.toString()}`;
    }

    const upperMethod = method.toUpperCase();

    const fetchOptions: RequestInit = {
      method: upperMethod,
      headers: {
        "Authorization": `Bearer ${token}`,
        "TENANT-ID": "1",
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
    };

    if (data && ["POST", "PUT", "PATCH", "DELETE"].includes(upperMethod)) {
      fetchOptions.body = JSON.stringify(data);
    }

    console.log(`MIPS proxy: ${upperMethod} ${url}`);

    const mipsRes = await fetch(url, fetchOptions);
    const responseText = await mipsRes.text();

    let responseJson: unknown;
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      responseJson = { raw: responseText };
    }

    return new Response(JSON.stringify({
      success: mipsRes.ok,
      status: mipsRes.status,
      data: responseJson,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("mips-proxy error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
