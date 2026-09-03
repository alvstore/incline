// v1.1.0 — HOWBODY shared helpers (DB-backed creds with env fallback, token cache, signed headers)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

export interface HowbodyCreds {
  baseUrl: string;
  userName: string;
  appKey: string;
  source: "db" | "env";
}

let _credsCache: { value: HowbodyCreds; at: number } | null = null;
const CRED_TTL_MS = 60_000;

/**
 * Resolve HOWBODY credentials.
 * Priority: integration_settings (body_scanner / howbody, branch_id IS NULL) → env vars.
 */
export async function getHowbodyCreds(): Promise<HowbodyCreds> {
  if (_credsCache && Date.now() - _credsCache.at < CRED_TTL_MS) {
    return _credsCache.value;
  }
  let value: HowbodyCreds | null = null;
  try {
    const sb = admin();
    const { data } = await sb
      .from("integration_settings")
      .select("config, credentials, is_active")
      .eq("integration_type", "body_scanner")
      .eq("provider", "howbody")
      .is("branch_id", null)
      .maybeSingle();

    if (data && data.is_active) {
      const cfg = (data.config || {}) as Record<string, string>;
      const creds = (data.credentials || {}) as Record<string, string>;
      const baseUrl = (cfg.base_url || "").replace(/\/+$/, "");
      const userName = cfg.username || "";
      const appKey = creds.app_key || "";
      if (baseUrl && userName && appKey) {
        value = { baseUrl, userName, appKey, source: "db" };
      }
    }
  } catch (e) {
    console.warn("HOWBODY DB cred lookup failed, falling back to env:", e);
  }

  if (!value) {
    const baseUrl = (Deno.env.get("HOWBODY_BASE_URL") || "").replace(/\/+$/, "");
    const userName = Deno.env.get("HOWBODY_USERNAME") || "";
    const appKey = Deno.env.get("HOWBODY_APPKEY") || "";
    if (!baseUrl || !userName || !appKey) {
      throw new Error("HOWBODY credentials missing — configure them in Settings → Integrations → Body Scanner.");
    }
    value = { baseUrl, userName, appKey, source: "env" };
  }

  _credsCache = { value, at: Date.now() };
  return value;
}




export async function getCachedToken(): Promise<{ token: string; expires_at: string }> {
  const sb = admin();
  const cutoff = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  const { data: existing } = await sb
    .from("howbody_tokens")
    .select("token,expires_at")
    .gt("expires_at", cutoff)
    .order("expires_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.token) return existing as { token: string; expires_at: string };

  const { baseUrl, userName, appKey } = await getHowbodyCreds();
  const ts = Date.now();
  const resp = await fetch(`${baseUrl}/openApi/getToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userName, appKey, timeStamp: ts }),
  });
  const body = await resp.json().catch(() => ({}));
  if (body?.code !== 200 || !body?.data?.token) {
    // HOWBODY returns `msg` (not `message`) in production responses
    throw new Error(`HOWBODY getToken failed: ${body?.msg || body?.message || resp.status}`);
  }
  const token = body.data.token as string;
  const expiresAt = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();
  await sb.from("howbody_tokens").insert({ token, expires_at: expiresAt });
  return { token, expires_at: expiresAt };
}

export async function howbodyAuthedHeaders(): Promise<Record<string, string>> {
  const { token } = await getCachedToken();
  const { appKey } = await getHowbodyCreds();
  return {
    "Content-Type": "application/json",
    token,
    timestamp: String(Date.now()),
    appkey: appKey,
  };
}

/** Webhook auth — returns the expected app_key (DB-first, env fallback). */
export async function getExpectedWebhookAppKey(): Promise<string | null> {
  try {
    const { appKey } = await getHowbodyCreds();
    return appKey || null;
  } catch {
    return Deno.env.get("HOWBODY_APPKEY") || null;
  }
}

export async function logWebhook(
  endpoint: string,
  third_uid: string | null,
  data_key: string | null,
  status_code: number,
  message: string,
  raw_payload: unknown,
) {
  try {
    await admin().from("howbody_webhook_log").insert({
      endpoint, third_uid, data_key, status_code, message, raw_payload,
    });
  } catch (_) { /* best-effort */ }
}
