// v1.0.0 — Consolidated diagnostics endpoint.
// Replaces test-integration, test-ai-provider, test-ai-tool.
// Dispatched by body.kind: "integration" | "ai_provider" | "ai_tool".
// Each branch preserves the original handler's auth model and response shape.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  META_API_BASE,
  IG_API_BASE,
  metaFetchWithFallback,
} from "../_shared/meta-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const kind = body?.kind;
    const authHeader = req.headers.get("Authorization") || "";

    if (!kind) return json({ error: "Missing 'kind' in body. Expected one of: integration, ai_provider, ai_tool" }, 400);

    switch (kind) {
      case "integration":
        return await handleIntegration(req, authHeader, body);
      case "ai_provider":
        return await handleAiProvider(authHeader, body);
      case "ai_tool":
        return await handleAiTool(authHeader, body);
      default:
        return json({ error: `Unknown kind: ${kind}` }, 400);
    }
  } catch (e: any) {
    console.error("diagnostics error:", e);
    return json({ error: e?.message || "Unknown error" }, 500);
  }
});

// ════════════════════════════════════════════════════════════
// INTEGRATION (was test-integration v1.4.1)
// ════════════════════════════════════════════════════════════
async function handleIntegration(_req: Request, authHeader: string, body: any) {
  if (!authHeader.startsWith("Bearer ")) {
    return json({ success: false, error: "Unauthorized" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authClient = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user) {
    return json({ success: false, error: "Unauthorized" });
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceKey);

  const { data: roleData } = await adminClient
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .in("role", ["owner", "admin", "manager"]);
  if (!roleData?.length) {
    return json({ success: false, error: "Admin access required" });
  }

  const { type, provider, config, credentials, branch_id } = body;
  if (!type || !provider) {
    return json({ success: false, error: "Missing type or provider" });
  }

  let result: { success: boolean; message?: string; error?: string; warning?: string; detected_flow?: string; detected_account_id?: string };

  switch (type) {
    case "sms":
      result = await testSMS(provider, config, credentials);
      break;
    case "email":
      result = await testEmail(provider, config, credentials, user.email || "");
      break;
    case "whatsapp":
      result = await testWhatsApp(provider, config, credentials);
      break;
    case "instagram":
      result = await testInstagram(config, credentials);
      break;
    case "messenger":
    case "facebook_messenger":
      result = {
        success: false,
        error: "Messenger integration is not yet supported end-to-end. This provider has been temporarily disabled in the UI.",
      };
      break;
    case "google_business": {
      if (!branch_id) {
        result = { success: false, error: "Select a branch before testing Google Business." };
        break;
      }
      try {
        const brainResp = await fetch(`${supabaseUrl}/functions/v1/google-reviews-brain`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
            apikey: supabaseAnon,
          },
          body: JSON.stringify({ action: "list_accounts", branch_id }),
        });
        const brainData = await brainResp.json().catch(() => ({}));
        if (!brainResp.ok || brainData?.error || brainData?.ok === false) {
          result = { success: false, error: brainData?.reason || brainData?.error || `Google Business test failed (HTTP ${brainResp.status})` };
        } else {
          const visibleAccounts = Array.isArray(brainData?.items) ? brainData.items : brainData?.accounts;
          const count = Array.isArray(visibleAccounts) ? visibleAccounts.length : 0;
          result = count > 0
            ? { success: true, message: `Connected — ${count} Google Business account(s) visible` }
            : { success: false, error: "Connected to Google, but no Business Profile accounts are visible for this user." };
        }
      } catch (e: any) {
        result = { success: false, error: e?.message || "Failed to reach google-reviews-brain" };
      }
      break;
    }
    default:
      result = { success: false, error: `Unsupported type: ${type}` };
  }

  return json(result);
}

function formatMetaError(error: string, platform: "whatsapp" | "instagram"): string {
  const lower = error.toLowerCase();
  if (lower.includes("appsecret_proof")) {
    return platform === "whatsapp"
      ? "Meta rejected app secret proof. Verify your access token and app secret belong to the same WhatsApp Meta app."
      : "Meta rejected app secret proof. Verify your access token and app secret belong to the same Instagram/Meta app.";
  }
  if (lower.includes("does not exist")) {
    return platform === "whatsapp"
      ? "Invalid WhatsApp Business Account ID. Check the WABA ID in your Meta configuration."
      : "Invalid Instagram/Page ID. Check the Instagram business account ID or linked Facebook Page ID.";
  }
  if (lower.includes("permission") || lower.includes("oauth") || lower.includes("token")) {
    return platform === "whatsapp"
      ? "Meta token was rejected or lacks permission. Re-enter the access token and confirm the app has WhatsApp permissions."
      : "Meta token was rejected or lacks permission. Re-enter the access token and confirm the app has Instagram/Page permissions.";
  }
  return error;
}

async function testSMS(provider: string, config: any, credentials: any) {
  switch (provider) {
    case "msg91": {
      if (!credentials?.auth_key) return { success: false, error: "Auth Key is required" };
      try {
        const resp = await fetch("https://control.msg91.com/api/v5/flow/", {
          method: "GET",
          headers: { authkey: credentials.auth_key },
        });
        return resp.status !== 401
          ? { success: true, message: "MSG91 credentials verified ✓" }
          : { success: false, error: "Invalid MSG91 Auth Key" };
      } catch (e) {
        return { success: false, error: `MSG91 connection failed: ${(e as Error).message}` };
      }
    }
    case "roundsms": {
      const base = config?.api_base_url || "http://voice.roundsms.co/api";
      const endpoint = config?.balance_endpoint || "/checkbalance.php";
      const url = `${base}${endpoint}?user=${encodeURIComponent(credentials?.username || "")}&pass=${encodeURIComponent(credentials?.password || "")}`;
      try {
        const resp = await fetch(url);
        const text = await resp.text();
        if (text.toLowerCase().includes("error") || text.toLowerCase().includes("invalid")) {
          return { success: false, error: `RoundSMS: ${text.trim()}` };
        }
        return { success: true, message: `RoundSMS connected ✓ Balance: ${text.trim()}` };
      } catch (e) {
        return { success: false, error: `RoundSMS connection failed: ${(e as Error).message}` };
      }
    }
    case "twilio": {
      const sid = credentials?.account_sid;
      const token = credentials?.auth_token;
      if (!sid || !token) return { success: false, error: "Account SID and Auth Token required" };
      try {
        const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
          headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}` },
        });
        return resp.ok
          ? { success: true, message: "Twilio credentials verified ✓" }
          : { success: false, error: "Invalid Twilio credentials" };
      } catch (e) {
        return { success: false, error: `Twilio connection failed: ${(e as Error).message}` };
      }
    }
    default:
      return { success: false, error: `No test available for SMS provider: ${provider}` };
  }
}

async function testEmail(provider: string, config: any, credentials: any, adminEmail: string) {
  switch (provider) {
    case "sendgrid": {
      if (!credentials?.api_key) return { success: false, error: "API Key is required" };
      try {
        const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${credentials.api_key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: adminEmail }] }],
            from: { email: config?.from_email || "test@test.com", name: config?.from_name || "Incline Fitness" },
            subject: "🧪 Test Email — Incline Fitness",
            content: [{ type: "text/html", value: "<h2>✅ Email integration is working!</h2><p>This is a test email from Incline Fitness CRM.</p>" }],
          }),
        });
        return resp.ok || resp.status === 202
          ? { success: true, message: `Test email sent to ${adminEmail} ✓` }
          : { success: false, error: `SendGrid error: ${resp.status}` };
      } catch (e) {
        return { success: false, error: `SendGrid failed: ${(e as Error).message}` };
      }
    }
    case "mailgun": {
      if (!credentials?.api_key || !config?.domain) return { success: false, error: "API Key and Domain are required" };
      try {
        const resp = await fetch(`https://api.mailgun.net/v3/${config.domain}/messages`, {
          method: "POST",
          headers: { Authorization: `Basic ${btoa(`api:${credentials.api_key}`)}` },
          body: new URLSearchParams({
            from: `${config.from_name || "Test"} <${config.from_email || `test@${config.domain}`}>`,
            to: adminEmail,
            subject: "🧪 Test Email — Incline Fitness",
            html: "<h2>✅ Email integration is working!</h2><p>This is a test email from Incline Fitness CRM.</p>",
          }),
        });
        return resp.ok
          ? { success: true, message: `Test email sent to ${adminEmail} ✓` }
          : { success: false, error: `Mailgun error: ${resp.status}` };
      } catch (e) {
        return { success: false, error: `Mailgun failed: ${(e as Error).message}` };
      }
    }
    case "smtp":
      if (!config?.host || !credentials?.username) {
        return { success: false, error: "SMTP Host and Username are required" };
      }
      return { success: true, message: "SMTP configuration looks valid ✓ (send a test email to fully verify)" };
    case "ses":
      if (!credentials?.access_key_id) return { success: false, error: "AWS Access Key ID is required" };
      return { success: true, message: "AWS SES configuration saved ✓ (ensure your domain is verified in AWS)" };
    default:
      return { success: false, error: `No test available for email provider: ${provider}` };
  }
}

async function testWhatsApp(provider: string, config: any, credentials: any) {
  switch (provider) {
    case "meta_cloud": {
      if (!credentials?.access_token || !config?.business_account_id) {
        return { success: false, error: "Access Token and WABA ID are required" };
      }
      const result = await fetchMetaGraph(
        `${META_API_BASE}/${config.business_account_id}/message_templates?limit=1`,
        credentials.access_token,
        credentials.app_secret,
      );
      if (!result.ok) {
        if (result.error?.includes("does not exist")) {
          return { success: false, error: "Invalid WABA ID. Please check your WhatsApp Business Account ID." };
        }
        return { success: false, error: formatMetaError(result.error || "Meta WhatsApp API test failed", "whatsapp") };
      }
      const usedFallback = result.usedFallback && !!credentials?.app_secret;
      return {
        success: true,
        message: usedFallback
          ? "Meta WhatsApp API connected ✓ (verified without app secret proof)"
          : "Meta WhatsApp API connected ✓",
        warning: usedFallback
          ? "App Secret was provided but Meta rejected the proof. Calls that require appsecret_proof will fail later. Verify your app secret matches the one in Meta Dashboard → App Settings → Basic, or remove it to disable proof."
          : undefined,
      };
    }
    case "wati": {
      if (!credentials?.access_token || !config?.api_endpoint_url) {
        return { success: false, error: "API Endpoint and Access Token are required" };
      }
      try {
        const resp = await fetch(`${config.api_endpoint_url}/api/v1/getTemplates`, {
          headers: { Authorization: `Bearer ${credentials.access_token}` },
        });
        return resp.ok
          ? { success: true, message: "WATI connected ✓" }
          : { success: false, error: `WATI error: ${resp.status}` };
      } catch (e) {
        return { success: false, error: `WATI failed: ${(e as Error).message}` };
      }
    }
    case "aisensy": {
      if (!credentials?.api_key) return { success: false, error: "API Key is required" };
      return { success: true, message: "AiSensy API Key configured ✓" };
    }
    default:
      return { success: false, error: `No test available for WhatsApp provider: ${provider}` };
  }
}

async function testInstagram(config: any, credentials: any) {
  const accessToken: string | undefined =
    credentials?.access_token || credentials?.page_access_token;
  if (!accessToken) return { success: false, error: "Access Token is required" };

  const isInstagramLogin = accessToken.trim().startsWith("IGAA");

  if (isInstagramLogin) {
    const meResp = await metaFetchWithFallback(
      `${IG_API_BASE}/me?fields=user_id,username,name,account_type`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const meData = await meResp.json().catch(() => ({}));
    if (!meResp.ok || meData?.error) {
      const msg = meData?.error?.message || `HTTP ${meResp.status}`;
      return {
        success: false,
        error: `Instagram Login API: ${formatMetaError(msg, "instagram")}\n` +
          `Token detected as Instagram Login (IGAA…). Make sure your Meta app has ` +
          `permissions: instagram_business_basic, instagram_business_manage_messages, instagram_manage_comments. ` +
          `If you used "API setup with Facebook login", regenerate as a Page Access Token (EAA…) instead.`,
      };
    }

    const expectedAccount = config?.instagram_account_id;
    const actualAccount = String(meData?.user_id || meData?.id || "");
    if (expectedAccount && expectedAccount !== actualAccount) {
      return {
        success: false,
        error: `Instagram Login token is for IG account ${actualAccount} (@${meData?.username || "?"}), ` +
          `but Integration is configured for ${expectedAccount}. Update "Instagram Account ID" to ${actualAccount}.`,
      };
    }

    const accountType = String(meData?.account_type || "").toUpperCase();
    const isMessagingCapable = accountType === "BUSINESS";
    return {
      success: true,
      message: `Instagram Login connected ✓ @${meData?.username || meData?.name || actualAccount}` +
        (accountType ? ` · ${accountType}` : "") +
        (!isMessagingCapable ? " ⚠ Convert IG account to BUSINESS to send DMs" : ""),
      detected_flow: "instagram_login",
      detected_account_id: actualAccount,
      warning: !isMessagingCapable
        ? `Your Instagram account is "${accountType}". The Instagram Messaging API only works for BUSINESS accounts. Convert in IG Settings → Account → Switch to Professional → Business.`
        : undefined,
    };
  }

  const pageId = config?.page_id || config?.instagram_account_id;
  if (!pageId) {
    return {
      success: false,
      error: "Facebook Page ID is required when using a Facebook Login token (EAA…). " +
        "Paste the linked Page ID into the Page ID field.",
    };
  }

  const entity = await fetchMetaGraph(
    `${META_API_BASE}/${pageId}?fields=id,name,instagram_business_account{id,username,name}`,
    accessToken,
    credentials?.app_secret,
  );
  if (!entity.ok) {
    return {
      success: false,
      error: `Meta API: ${formatMetaError(entity.error || "Instagram test failed", "instagram")}\n` +
        `Token detected as Facebook Login (EAA…). Verify the Page Access Token belongs to the Page that owns the IG Business account.`,
    };
  }

  const ig = entity.data?.instagram_business_account;
  if (!ig?.id) {
    return {
      success: false,
      error: `Page "${entity.data?.name || pageId}" has no linked Instagram Business account. ` +
        `Link the IG account in Meta Business Suite → Settings → Instagram Accounts.`,
    };
  }

  if (config?.instagram_account_id && String(config.instagram_account_id) !== String(ig.id)) {
    return {
      success: false,
      error: `Page is linked to IG account ${ig.id} (@${ig.username}), but Integration has ${config.instagram_account_id}. Update it.`,
    };
  }

  const usedFallback = entity.usedFallback && !!credentials?.app_secret;
  return {
    success: true,
    message: `Instagram (Facebook Login) connected ✓ @${ig.username || ig.name || ig.id} via Page "${entity.data?.name}"` +
      (usedFallback ? " — without appsecret_proof" : ""),
    detected_flow: "facebook_login",
    detected_account_id: ig.id,
    warning: usedFallback
      ? "App Secret was provided but Meta rejected the proof. Outbound DMs may fail later. Verify the App Secret matches Meta App → Settings → Basic."
      : undefined,
  };
}

async function fetchMetaGraph(
  baseUrl: string,
  accessToken: string,
  appSecret?: string,
): Promise<{ ok: boolean; data?: any; error?: string; usedFallback?: boolean }> {
  const proof = appSecret ? await hmacSha256(appSecret, accessToken) : "";
  const urls = [
    `${baseUrl}${proof ? `${baseUrl.includes("?") ? "&" : "?"}appsecret_proof=${proof}` : ""}`,
  ];
  if (proof) urls.push(baseUrl);

  let lastError: string | undefined;
  for (let i = 0; i < urls.length; i++) {
    try {
      const resp = await fetch(urls[i], {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await resp.json();
      if (data?.error) {
        lastError = data.error.message || "Meta API request failed";
        if (i === 0 && lastError && /appsecret_proof/i.test(lastError)) continue;
        return { ok: false, error: lastError, usedFallback: i > 0 };
      }
      return { ok: true, data, usedFallback: i > 0 };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Meta API request failed";
    }
  }
  return { ok: false, error: lastError || "Meta API request failed" };
}

async function hmacSha256(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ════════════════════════════════════════════════════════════
// AI PROVIDER (was test-ai-provider)
// ════════════════════════════════════════════════════════════
const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function handleAiProvider(authHeader: string, body: any) {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  if (!authHeader) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: authData } = await userClient.auth.getUser();
  if (!authData?.user) return json({ error: "Unauthorized" }, 401);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", authData.user.id);
  if (!roles?.some((r: any) => ["owner", "admin"].includes(r.role))) {
    return json({ error: "Forbidden" }, 403);
  }

  const { provider, base_url, api_key_secret_name, default_model } = body;
  if (!provider || !default_model) {
    return json({ error: "provider and default_model are required" }, 400);
  }

  let endpoint = base_url;
  if (!endpoint) {
    switch (provider) {
      case "lovable": endpoint = LOVABLE_GATEWAY; break;
      case "openrouter": endpoint = "https://openrouter.ai/api/v1/chat/completions"; break;
      case "deepseek": endpoint = "https://api.deepseek.com/v1/chat/completions"; break;
      case "google": endpoint = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"; break;
      case "groq": endpoint = "https://api.groq.com/openai/v1/chat/completions"; break;
      case "together": endpoint = "https://api.together.xyz/v1/chat/completions"; break;
      case "mistral": endpoint = "https://api.mistral.ai/v1/chat/completions"; break;
      default: return json({ error: "base_url is required for this provider" }, 400);
    }
  }

  let apiKey: string | null = null;
  let pasted_raw_key = false;
  if (api_key_secret_name) {
    const looksLikeRawKey =
      /^(sk-|sk_|aiza|gsk_|tgp_|key-|or-)/i.test(api_key_secret_name) ||
      (/[a-z]/.test(api_key_secret_name) && api_key_secret_name.length > 25 && !/^[A-Z0-9_]+$/.test(api_key_secret_name));
    if (looksLikeRawKey) {
      apiKey = api_key_secret_name;
      pasted_raw_key = true;
    } else {
      apiKey = Deno.env.get(api_key_secret_name) ?? null;
    }
  }
  if (!apiKey && provider === "lovable") {
    apiKey = Deno.env.get("LOVABLE_API_KEY") ?? null;
  }
  if (!apiKey && provider !== "ollama") {
    return json({
      error: `Secret '${api_key_secret_name}' is not set in Cloud → Settings → Secrets. Either add it there using this exact name, or paste the actual API key value into this field for a one-off test.`,
      secret_missing: true,
    }, 400);
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://incline.lovable.app";
    headers["X-Title"] = "Incline CRM";
  }

  const start = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30_000);
  let success = false;
  let errorMsg = "";
  let sampleReply = "";

  const usesCompletionTokens = provider === "openai";
  const reqBody: Record<string, any> = {
    model: default_model,
    messages: [{ role: "user", content: "Reply with the single word: pong" }],
    stream: false,
  };
  if (usesCompletionTokens) reqBody.max_completion_tokens = 10;
  else reqBody.max_tokens = 10;

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(reqBody),
      signal: ac.signal,
    });
    if (!resp.ok) {
      errorMsg = `HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`;
    } else {
      const j = await resp.json();
      sampleReply = j?.choices?.[0]?.message?.content ?? "(no content)";
      success = true;
    }
  } catch (e) {
    errorMsg = e instanceof Error ? e.message : String(e);
  } finally {
    clearTimeout(timer);
  }

  const latency_ms = Date.now() - start;

  return json({
    success,
    latency_ms,
    sample_reply: sampleReply,
    error: errorMsg || undefined,
    endpoint,
    model: default_model,
    pasted_raw_key,
  });
}

// ════════════════════════════════════════════════════════════
// AI TOOL (was test-ai-tool v1.0.0)
// ════════════════════════════════════════════════════════════
async function handleAiTool(authHeader: string, body: any) {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);

  const staffRoles = ["owner", "admin", "manager", "staff"];
  const hasAccess = roles?.some((r: any) => staffRoles.includes(r.role));
  if (!hasAccess) {
    return json({ error: "Insufficient permissions" }, 403);
  }

  const { tool_name, arguments: args } = body;
  if (!tool_name) {
    return json({ error: "tool_name is required" }, 400);
  }

  let result: Record<string, any> = {};

  switch (tool_name) {
    case "get_membership_status": {
      const memberId = args?.member_id;
      if (!memberId) { result = { error: "member_id required in arguments" }; break; }
      const { data } = await supabase
        .from("memberships")
        .select("id, status, start_date, end_date, plan_id, membership_plans(name, price)")
        .eq("member_id", memberId)
        .order("end_date", { ascending: false })
        .limit(3);
      result = { memberships: data || [] };
      break;
    }

    case "get_benefit_balance": {
      const memberId = args?.member_id;
      if (!memberId) { result = { error: "member_id required in arguments" }; break; }
      const { data: membership } = await supabase
        .from("memberships")
        .select("id, plan_id")
        .eq("member_id", memberId)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      if (!membership) { result = { message: "No active membership" }; break; }
      const { data: benefits } = await supabase
        .from("plan_benefits")
        .select("benefit_type, limit_count, frequency, benefit_types(name, code)")
        .eq("plan_id", membership.plan_id);
      result = { benefits: benefits || [] };
      break;
    }

    case "get_available_slots": {
      const facilityType = args?.facility_type;
      const date = args?.date || new Date().toISOString().split("T")[0];
      let query = supabase
        .from("benefit_slots")
        .select("id, slot_date, start_time, end_time, capacity, booked_count, benefit_type, facilities(name)")
        .eq("slot_date", date)
        .eq("is_active", true);
      if (facilityType) {
        query = query.ilike("benefit_type", `%${facilityType}%`);
      }
      const { data } = await query.order("start_time").limit(20);
      result = { slots: data || [] };
      break;
    }

    case "get_pt_balance": {
      const memberId = args?.member_id;
      if (!memberId) { result = { error: "member_id required in arguments" }; break; }
      const { data } = await supabase
        .from("member_pt_packages")
        .select("id, sessions_total, sessions_remaining, expiry_date, status, pt_packages(name)")
        .eq("member_id", memberId)
        .in("status", ["active"]);
      result = { packages: data || [] };
      break;
    }

    default:
      result = { error: `Tool '${tool_name}' is not available for manual testing. Only read-only tools are supported.` };
  }

  return json(result);
}
