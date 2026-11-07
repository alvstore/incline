// v1.0.0 — Direct Firebase Cloud Messaging (HTTP v1) using a stored service account.
// Credentials come from push_provider_settings + push_provider_secrets (service-role only).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

export interface ServiceAccount { project_id: string; client_email: string; private_key: string }
export type ParseResult = { ok: true; value: ServiceAccount } | { ok: false; error: string };

export function parseServiceAccount(raw: unknown): ParseResult {
  let obj: unknown = raw;
  if (typeof raw === "string") { try { obj = JSON.parse(raw); } catch { return { ok: false, error: "File is not valid JSON" }; } }
  if (!obj || typeof obj !== "object") return { ok: false, error: "File is not a service account" };
  const o = obj as Record<string, unknown>;
  if (o.type !== "service_account") return { ok: false, error: "File is not a service account (type must be service_account)" };
  const project_id = typeof o.project_id === "string" ? o.project_id.trim() : "";
  const client_email = typeof o.client_email === "string" ? o.client_email.trim() : "";
  const private_key = typeof o.private_key === "string" ? o.private_key : "";
  if (!/^[a-z0-9-]{4,64}$/.test(project_id)) return { ok: false, error: "Missing or invalid project_id" };
  if (!/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(client_email)) return { ok: false, error: "Missing or invalid client_email" };
  if (!private_key.includes("-----BEGIN PRIVATE KEY-----") || !private_key.includes("-----END PRIVATE KEY-----")) return { ok: false, error: "Missing or invalid private_key" };
  return { ok: true, value: { project_id, client_email, private_key } };
}

export function buildJwtClaims(clientEmail: string, nowSec: number) {
  return { iss: clientEmail, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: nowSec, exp: nowSec + 3600 };
}

/** stale = delete token; retry = leave for queue backoff; fail = permanent failure. */
export function classifyFcmError(status: number, body: string): "stale" | "retry" | "fail" {
  if (status === 404 || (status === 400 && /UNREGISTERED|INVALID_ARGUMENT/.test(body))) return "stale";
  if (status === 429 || status >= 500) return "retry";
  return "fail";
}

const b64url = (data: Uint8Array | string) => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function signJwt(sa: ServiceAccount): Promise<string> {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify(buildJwtClaims(sa.client_email, Math.floor(Date.now() / 1000))));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`)));
  return `${header}.${claims}.${b64url(sig)}`;
}

let cached: { email: string; token: string; exp: number } | null = null;
export async function getAccessToken(sa: ServiceAccount): Promise<string> {
  if (cached && cached.email === sa.client_email && cached.exp > Date.now() + 60_000) return cached.token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: await signJwt(sa) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Google sign-in failed [${res.status}]: ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  cached = { email: sa.client_email, token: json.access_token, exp: Date.now() + (Number(json.expires_in) || 3300) * 1000 };
  return cached.token;
}
export function resetTokenCache() { cached = null; }

export interface FcmConfig { sa: ServiceAccount; enabled: boolean }
/** Returns null when no direct settings are saved (caller may fall back to the connector). */
export async function loadFcmConfig(db: SupabaseClient): Promise<FcmConfig | null> {
  const [{ data: s }, { data: k }] = await Promise.all([
    db.from("push_provider_settings").select("project_id,client_email,enabled").eq("id", true).maybeSingle(),
    db.from("push_provider_secrets").select("private_key").eq("id", true).maybeSingle(),
  ]);
  if (!s?.project_id || !s.client_email || !k?.private_key) return null;
  return { enabled: !!s.enabled, sa: { project_id: s.project_id, client_email: s.client_email, private_key: k.private_key } };
}

export async function sendFcm(sa: ServiceAccount, message: Record<string, unknown>, validateOnly = false) {
  const token = await getAccessToken(sa);
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(validateOnly ? { validate_only: true, message } : { message }),
  });
  return { ok: res.ok, status: res.status, body: res.ok ? "" : await res.text() };
}
