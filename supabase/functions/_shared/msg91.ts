// v1.0.0 — MSG91 SMS helpers (server-only). Contracts verified against
// docs.msg91.com/sms/*.openapi.yml on 4 Nov 2026:
//   POST /api/v5/flow                    (send, JSON, recipients[{mobiles, VAR1..}])
//   POST /api/v5/sms/addTemplate         (multipart: template, sender_id, template_name, dlt_template_id, smsType)
//   POST /api/v5/sms/addTemplateVersion  (multipart: template_id, sender_id, template, dlt_template_id)
//   POST /api/v5/sms/getTemplateVersions (JSON: template_id)
//   GET  /api/v5/sms/markActive?id=&template_id=
//   GET  /api/v5/flows                   (list templates — read-only connection test)
// MSG91 registration is NOT DLT approval; DLT IDs and MSG91 IDs are never mixed.

export const MSG91_HOST = "https://control.msg91.com";
const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** One slot per placeholder occurrence, in content order (matches DLT {#var#} order). */
export function varOrder(content: string): string[] {
  return [...String(content || "").matchAll(VAR_RE)].map((m) => m[1]);
}

/** Incline {{named}} → MSG91 ##VAR1##, ##VAR2## … (keys used in the Flow recipients object). */
export function toMsg91Content(content: string): string {
  let i = 0;
  return String(content || "").replace(VAR_RE, () => `##VAR${++i}##`);
}

export function smsTypeFor(content: string): "NORMAL" | "UNICODE" {
  return /[^\x00-\x7F]/.test(content) ? "UNICODE" : "NORMAL";
}

export async function contentHash(t: { content: string; dlt_header: string; dlt_template_id: string }): Promise<string> {
  const raw = JSON.stringify([t.content, t.dlt_header, t.dlt_template_id, varOrder(t.content), smsTypeFor(t.content)]);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildAddTemplateForm(t: { name: string; content: string; dlt_header: string; dlt_template_id: string }): FormData {
  const f = new FormData();
  f.append("template", toMsg91Content(t.content));
  f.append("sender_id", t.dlt_header);
  f.append("template_name", t.name);
  f.append("dlt_template_id", t.dlt_template_id);
  f.append("smsType", smsTypeFor(t.content));
  return f;
}

/** 91XXXXXXXXXX or null. */
export function toIndianMobile(phone: string): string | null {
  const d = String(phone || "").replace(/\D/g, "").replace(/^0+/, "");
  const ten = d.length === 12 && d.startsWith("91") ? d.slice(2) : d;
  return /^[6-9]\d{9}$/.test(ten) ? `91${ten}` : null;
}

/** Ordered VARn values; fails closed when any slot is missing. brand_name defaults to Incline. */
export function mapVariables(content: string, vars: Record<string, unknown> | undefined) {
  const v = { brand_name: "Incline", ...(vars || {}) } as Record<string, unknown>;
  const out: Record<string, string> = {};
  const missing: string[] = [];
  varOrder(content).forEach((key, i) => {
    const val = v[key];
    if (val === undefined || val === null || String(val).trim() === "") missing.push(key);
    else out[`VAR${i + 1}`] = String(val);
  });
  return { values: out, missing: [...new Set(missing)] };
}

export function buildFlowBody(templateId: string, mobile: string, values: Record<string, string>) {
  return { template_id: templateId, realTimeResponse: "1", recipients: [{ mobiles: mobile, ...values }] };
}

export interface Msg91Tpl {
  type: string; is_active: boolean; content: string;
  dlt_template_id: string | null; dlt_header: string | null;
  msg91_template_id: string | null; msg91_sync_status: string | null; msg91_synced_content_hash: string | null;
}

/** Returns a reason the template must not be sent via MSG91, or null. */
export async function sendBlocker(t: Msg91Tpl | null): Promise<string | null> {
  if (!t || t.type !== "sms") return "SMS template not found";
  if (!t.is_active) return "SMS template is turned off";
  if (!t.dlt_template_id) return "SMS template has no DLT Template ID";
  if (!t.dlt_header) return "SMS template has no approved header";
  if (!t.msg91_template_id) return "Template is not registered in MSG91";
  if (t.msg91_sync_status !== "synced") return `MSG91 mapping is ${t.msg91_sync_status || "not_synced"} — resync first`;
  const h = await contentHash({ content: t.content, dlt_header: t.dlt_header, dlt_template_id: t.dlt_template_id });
  if (h !== t.msg91_synced_content_hash) return "Template changed since MSG91 sync — resync first";
  return null;
}

/** Branch integration wins over global. */
export function pickIntegration<T extends { branch_id: string | null }>(rows: T[], branchId?: string | null): T | undefined {
  return (branchId && rows.find((r) => r.branch_id === branchId)) || rows.find((r) => r.branch_id === null) || rows[0];
}

export function redact(text: string, secret?: string | null): string {
  const s = String(text ?? "");
  return secret && secret.length >= 4 ? s.split(secret).join("[redacted]") : s;
}

/** Fixed-host MSG91 request; auth key goes only in the header and is scrubbed from errors. */
export async function msg91Fetch(
  authKey: string, path: string, init: RequestInit = {}, fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number; data: any; error?: string }> {
  if (!path.startsWith("/api/v5/")) throw new Error("Invalid MSG91 path");
  try {
    const resp = await fetchFn(`${MSG91_HOST}${path}`, {
      ...init,
      headers: { accept: "application/json", ...(init.headers || {}), authkey: authKey },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await resp.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
    const failed = !resp.ok || data?.hasError === true || data?.type === "error" || data?.status === "fail" || data?.status === "error";
    const err = failed ? redact(JSON.stringify(data?.errors ?? data?.message ?? data).slice(0, 400), authKey) : undefined;
    return { ok: !failed, status: resp.status, data, error: err };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: redact((e as Error).message, authKey) };
  }
}

/**
 * MSG91 Flow send. Template sends need a synced MSG91 mapping (sendBlocker).
 * Without template_id, the legacy single Flow template ID in settings is used
 * only when the caller supplies VAR1..VARn values explicitly.
 */
export async function sendMSG91(
  phone: string, config: Record<string, string>, credentials: Record<string, string>,
  tpl: Msg91Tpl | null | undefined, variables: Record<string, unknown> | undefined, fetchFn: typeof fetch = fetch,
): Promise<{ success: boolean; message_id?: string; error?: string }> {
  const authKey = credentials.auth_key || "";
  if (!authKey) return { success: false, error: "MSG91 Auth Key is not configured" };
  const mobile = toIndianMobile(phone);
  if (!mobile) return { success: false, error: "Invalid Indian mobile number" };
  let templateId: string; let values: Record<string, string>;
  if (tpl !== undefined) {
    const block = await sendBlocker(tpl);
    if (block) return { success: false, error: block };
    const mapped = mapVariables(tpl!.content, variables);
    if (mapped.missing.length) return { success: false, error: `Missing SMS variables: ${mapped.missing.join(", ")}` };
    templateId = tpl!.msg91_template_id!; values = mapped.values;
  } else {
    if (!config.template_id) return { success: false, error: "MSG91 needs a synced SMS template (no legacy fallback template set)" };
    values = Object.fromEntries(Object.entries(variables || {}).filter(([k]) => /^VAR\d+$/.test(k)).map(([k, v]) => [k, String(v)]));
    if (!Object.keys(values).length) return { success: false, error: "Legacy MSG91 fallback needs VAR1..VARn values" };
    templateId = config.template_id;
  }
  const r = await msg91Fetch(authKey, "/api/v5/flow", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildFlowBody(templateId, mobile, values)),
  }, fetchFn);
  return r.ok ? { success: true, message_id: r.data?.message || r.data?.request_id } : { success: false, error: `MSG91: ${r.error}` };
}

