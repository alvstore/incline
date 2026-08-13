// mips-proxy v1.4.1
// v1.4.1 — normalize legacy host:port runtime values before constructing URLs.
// v1.4.0 — secure owner/admin connection management, draft credential testing,
// and credential-scoped token caching so password rotations take effect immediately.
// v1.3.0 — explicit timeouts + failure classification (auth_failed / unreachable /
// timeout / upstream_error) so the Device Command Center can tell a rejected
// password apart from a dead server instead of labelling everything "Unreachable".
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

async function generateHmacSha256(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(message);
  const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, msgData);
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const LOGIN_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 25_000;

export class MipsError extends Error {
  reason: "auth_failed" | "unreachable" | "timeout" | "upstream_error";
  constructor(reason: MipsError["reason"], message: string) {
    super(message);
    this.reason = reason;
  }
}

function classifyTransport(e: unknown): MipsError {
  const msg = e instanceof Error ? e.message : String(e);
  if (/timed? ?out|AbortError|deadline/i.test(msg)) {
    return new MipsError("timeout", `MIPS server did not respond in time (${msg})`);
  }
  return new MipsError("unreachable", `Cannot reach MIPS server: ${msg}`);
}

let cachedToken: string | null = null;
let tokenExpiry = 0;
let cachedCredentialKey = "";

function getBaseUrl(overrideUrl?: string): string {
  const raw = String(overrideUrl || Deno.env.get("MIPS_SERVER_URL") || "").trim();
  if (!raw) throw new MipsError("upstream_error", "No MIPS server URL configured.");
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return normalizeServerUrl(withScheme);
}

async function getRuoYiToken(baseUrl: string, username: string, password: string): Promise<string> {
  const credentialKey = `${baseUrl}\u0000${username}\u0000${password}`;
  if (cachedToken && Date.now() < tokenExpiry && cachedCredentialKey === credentialKey) return cachedToken;

  console.log(`RuoYi auth: POST ${baseUrl}/login`);

  if (!username || !password) {
    throw new MipsError("auth_failed", "No MIPS username/password configured for this branch.");
  }

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "TENANT-ID": "1" },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
    });
  } catch (e) {
    throw classifyTransport(e);
  }

  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new MipsError("upstream_error", `RuoYi login returned non-JSON: ${text.substring(0, 300)}`);
  }

  if (json.code !== 200 && json.code !== 0) {
    cachedToken = null;
    tokenExpiry = 0;
    cachedCredentialKey = "";
    // The RuoYi gateway answers a bad username/password with code 500 and a
    // "User does not exist/password error" message — that is a credential
    // problem, never a connectivity problem.
    throw new MipsError(
      "auth_failed",
      `MIPS login rejected: ${json.msg || JSON.stringify(json)}. Update the MIPS username/password in Device Setup.`,
    );
  }

  cachedToken = json.token || json.data?.token;
  if (!cachedToken) throw new MipsError("upstream_error", `No token in RuoYi login response: ${JSON.stringify(json)}`);
  tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
  cachedCredentialKey = credentialKey;
  return cachedToken!;
}

type ConnectionOperation = "get_connection" | "test_connection" | "save_and_test" | "repair_from_runtime";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeServerUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 500) throw new MipsError("upstream_error", "Enter a valid MIPS server URL.");
  const trimmed = value.trim();
  const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new MipsError("upstream_error", "MIPS server URL must use HTTP or HTTPS.");
  return parsed.toString().replace(/\/$/, "");
}

async function testCredentials(baseUrl: string, username: string, password: string) {
  const token = await getRuoYiToken(baseUrl, username, password);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/through/device/list?pageNum=1&pageSize=20`, {
      headers: { Authorization: `Bearer ${token}`, "TENANT-ID": "1", Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw classifyTransport(error);
  }
  const payload = await response.json().catch(() => ({}));
  const code = payload?.code;
  if (!response.ok || (code !== undefined && code !== 200 && code !== 0)) {
    throw new MipsError("upstream_error", payload?.msg || `MIPS device check failed (${response.status}).`);
  }
  const rows = Array.isArray(payload?.rows) ? payload.rows : Array.isArray(payload?.data) ? payload.data : [];
  return { device_count: Number(payload?.total ?? rows.length ?? 0) };
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ---- AUTH GATE (v1.1.0) ----
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
    const authClient = createClient(SUPA_URL, SERVICE_KEY);
    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "");
    const isService = bearer && bearer === SERVICE_KEY;
    let roleNames: string[] = isService ? ["service_role"] : [];
    if (!isService) {
      if (!bearer) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: userRes } = await authClient.auth.getUser(bearer);
      const uid = userRes?.user?.id;
      if (!uid) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: roles } = await authClient
        .from("user_roles").select("role").eq("user_id", uid);
      roleNames = (roles || []).map((role: { role: string }) => role.role);
      const allowed = new Set(["owner", "admin", "manager", "staff"]);
      const hasRole = roleNames.some((role) => allowed.has(role));
      if (!hasRole) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const body = await req.json();

    // ---- MIPS RELAY SIGNATURE CHECK (v1.5.0) ----
    const operation = body?.operation as ConnectionOperation | undefined;
    const isRelayOpen = operation === "relay_open" || operation === "remote_open";
    
    if (isRelayOpen && !isService) {
      const signature = req.headers.get("x-mips-signature");
      const timestamp = req.headers.get("x-mips-timestamp");
      const secret = Deno.env.get("MIPS_RELAY_SECRET");
      
      if (!secret || !signature || !timestamp) {
        return jsonResponse({ error: "Forbidden: Missing command signature" }, 403);
      }
      
      // Verify signature to prevent unauthorized door opening
      const msg = `${timestamp}.${JSON.stringify(body)}`;
      const expected = await generateHmacSha256(msg, secret);
      if (signature !== expected) {
        return jsonResponse({ error: "Forbidden: Invalid command signature" }, 403);
      }
      
      // Prevent replay attacks (5 min window)
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - parseInt(timestamp)) > 300) {
        return jsonResponse({ error: "Forbidden: Command expired" }, 403);
      }
    }

    if (operation) {
      if (operation === "repair_from_runtime" && !isService) return jsonResponse({ error: "Service authorization required." }, 403);
      if (!isService && !roleNames.some((role) => role === "owner" || role === "admin")) return jsonResponse({ error: "Only owners and admins can manage MIPS credentials." }, 403);
      const branchId = typeof body?.branch_id === "string" ? body.branch_id : "";
      if (!branchId) return jsonResponse({ error: "Select a branch first." }, 400);
      const { data: existing, error: lookupError } = await authClient.from("mips_connections")
        .select("id, branch_id, server_url, username, password, is_active").eq("branch_id", branchId).maybeSingle();
      if (lookupError) throw lookupError;
      if (operation === "get_connection") {
        return jsonResponse({ success: true, connection: existing ? {
          branch_id: existing.branch_id, server_url: existing.server_url, username: existing.username,
          is_active: existing.is_active, has_password: Boolean(existing.password),
        } : null });
      }
      if (operation === "repair_from_runtime") {
        const serverUrl = normalizeServerUrl(Deno.env.get("MIPS_SERVER_URL"));
        const username = String(Deno.env.get("MIPS_USERNAME") || "").trim();
        const password = String(Deno.env.get("MIPS_PASSWORD") || "");
        const test = await testCredentials(serverUrl, username, password);
        const { error: saveError } = await authClient.from("mips_connections").upsert({
          branch_id: branchId, server_url: serverUrl, username, password, is_active: true, updated_at: new Date().toISOString(),
        }, { onConflict: "branch_id" });
        if (saveError) throw saveError;
        return jsonResponse({ success: true, ...test, message: "Runtime MIPS credentials verified and applied to the branch." });
      }
      const credentials = body?.credentials ?? {};
      const serverUrl = normalizeServerUrl(credentials.server_url || existing?.server_url || Deno.env.get("MIPS_SERVER_URL"));
      const username = String(credentials.username || existing?.username || Deno.env.get("MIPS_USERNAME") || "").trim();
      const password = String(credentials.password || existing?.password || Deno.env.get("MIPS_PASSWORD") || "");
      if (!username || username.length > 200) return jsonResponse({ error: "Enter a valid MIPS username." }, 400);
      if (!password || password.length > 500) return jsonResponse({ error: "Enter the MIPS password." }, 400);
      const test = await testCredentials(serverUrl, username, password);
      if (operation === "save_and_test") {
        const { error: saveError } = await authClient.from("mips_connections").upsert({
          branch_id: branchId, server_url: serverUrl, username, password, is_active: true, updated_at: new Date().toISOString(),
        }, { onConflict: "branch_id" });
        if (saveError) throw saveError;
      }
      return jsonResponse({ success: true, ...test, message: `Connected to MIPS. Found ${test.device_count} device(s).` });
    }

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
        const { data: conn } = await authClient
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

    let mipsRes: Response;
    try {
      mipsRes = await fetch(url, { ...fetchOptions, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (e) {
      throw classifyTransport(e);
    }
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
    const reason = error instanceof MipsError ? error.reason : "upstream_error";
    console.error(`mips-proxy error [${reason}]:`, message);
    // Returned as HTTP 200 so the browser SDK surfaces the real reason instead of
    // the opaque "Edge Function returned a non-2xx status code".
    return new Response(JSON.stringify({
      success: false,
      status: 0,
      reason,
      error: message,
      data: { msg: message },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

