// v1.1.0 — Sarvam Voice Agents adapter.
//
// Single server-side boundary for every Sarvam call. Nothing else in the code
// base may talk to Sarvam directly. Endpoints below are the officially
// documented ones (docs.sarvam.ai/conversations/api/*) — never invent one.
//
//   Deployments        https://apps.sarvam.ai/api/app-authoring
//   Campaigns/Cohorts  https://apps.sarvam.ai/api/scheduling
//   Instant Outbound   https://apps.sarvam.ai/api/outbounds
//   Analytics          https://apps.sarvam.ai/api
//
// Auth header: X-API-Key. The key never leaves this module and is never logged.
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

export const BASE = {
  deployments: "https://apps.sarvam.ai/api/app-authoring",
  scheduling: "https://apps.sarvam.ai/api/scheduling",
  outbounds: "https://apps.sarvam.ai/api/outbounds",
  analytics: "https://apps.sarvam.ai/api",
} as const;

export interface SarvamConfig {
  org_id?: string;
  workspace_id?: string;
  app_id?: string;
  app_version?: number | null;
  connection_id?: string;
  agent_phone_number?: string;
  telephony_provider?: string;
  timezone?: string;
  window_start?: string;
  window_end?: string;
  max_concurrent_calls?: number;
  daily_call_cap?: number;
  retry_enabled?: boolean;
  test_phone?: string;
  webhook_token?: string;
}

/** Internal, provider-neutral error model. */
export class SarvamError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number = 502,
  ) {
    super(message);
  }
}

/** Strip anything that smells like a credential or a full phone number. */
export function redact(input: unknown): string {
  let s = typeof input === "string" ? input : JSON.stringify(input ?? "");
  if (!s) return "";
  s = s.replace(/(sk|sarvam)[-_a-z0-9]{8,}/gi, "***redacted***");
  s = s.replace(/(\+?\d{2})(\d{5,8})(\d{2})/g, "$1*****$3");
  return s.slice(0, 800);
}

export type Json = unknown;

export function maskKey(key: string | null | undefined): string {
  if (!key) return "";
  if (key.length <= 8) return "•".repeat(key.length);
  return `${"•".repeat(8)}${key.slice(-4)}`;
}

interface RequestOpts {
  method?: "GET" | "POST" | "PUT" | "PATCH";
  body?: unknown;
  timeoutMs?: number;
  /** Only GET/idempotent reads are retried. */
  retries?: number;
}

async function call(
  apiKey: string,
  url: string,
  opts: RequestOpts = {},
): Promise<Json> {
  const method = opts.method ?? "GET";
  const retries = method === "GET" ? (opts.retries ?? 1) : 0;
  const timeoutMs = opts.timeoutMs ?? 20_000;

  let lastErr: SarvamError | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        signal: ctrl.signal,
        headers: {
          "X-API-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      const text = await res.text();
      let parsed: Json = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = { raw: text.slice(0, 500) };
      }
      if (!res.ok) {
        const p = (parsed ?? {}) as Record<string, unknown>;
        const detail = redact(p.detail ?? p.message ?? p.raw ?? text);
        const err = new SarvamError(
          detail || `Sarvam returned HTTP ${res.status}`,
          res.status === 401 || res.status === 403
            ? "sarvam_auth_failed"
            : res.status === 404
            ? "sarvam_not_found"
            : res.status === 429
            ? "sarvam_rate_limited"
            : "sarvam_http_error",
          res.status,
        );
        // Only transient statuses are worth another read.
        if (attempt < retries && (res.status >= 500 || res.status === 429)) {
          lastErr = err;
          continue;
        }
        throw err;
      }
      return parsed;
    } catch (e) {
      if (e instanceof SarvamError) throw e;
      const msg = (e as Error)?.name === "AbortError"
        ? "Sarvam request timed out"
        : redact((e as Error)?.message || "Network error contacting Sarvam");
      lastErr = new SarvamError(msg, "sarvam_unreachable", 504);
      if (attempt < retries) continue;
      throw lastErr;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new SarvamError("Sarvam request failed", "sarvam_unknown");
}

export function requireScope(cfg: SarvamConfig) {
  if (!cfg.org_id || !cfg.workspace_id) {
    throw new SarvamError(
      "Organization ID and Workspace ID are required. Copy them from your Sarvam dashboard URL.",
      "config_incomplete",
      400,
    );
  }
}

/** GET /app-authoring/v1/orgs/{org}/workspaces/{ws}/deployments */
export async function listDeployments(apiKey: string, cfg: SarvamConfig, limit = 50) {
  requireScope(cfg);
  const url =
    `${BASE.deployments}/v1/orgs/${encodeURIComponent(cfg.org_id!)}/workspaces/${encodeURIComponent(cfg.workspace_id!)}/deployments?limit=${limit}`;
  const data = (await call(apiKey, url)) as { items?: unknown; total?: unknown } | null;
  const items = (Array.isArray(data?.items) ? data.items : []) as Array<Record<string, unknown>>;
  return {
    total: typeof data?.total === "number" ? data.total : items.length,
    items: items.map((d) => ({
      deployment_id: d.deployment_id,
      name: d.name ?? null,
      app_id: d.app_id,
      app_version: d.app_version,
      status: d.status ?? null,
      channel_direction: d.channel_direction ?? null,
      phone_numbers: Array.isArray(d.phone_numbers) ? d.phone_numbers : [],
      updated_at: d.updated_at ?? null,
    })),
  };
}

/** Credential + scope health check. Never asserts "agent deployed". */
export async function checkConnection(apiKey: string, cfg: SarvamConfig) {
  const { items, total } = await listDeployments(apiKey, cfg, 50);
  const matching = cfg.app_id ? items.filter((d) => d.app_id === cfg.app_id) : [];
  const active = matching.find((d) => d.status === "active") ?? matching[0] ?? null;
  return {
    ok: true,
    deployments_total: total,
    agent_found: cfg.app_id ? matching.length > 0 : null,
    deployment: active,
    deployments: items,
  };
}

/** POST /outbounds/v1/orgs/{org}/workspaces/{ws}/outbounds */
export async function createOutboundCall(
  apiKey: string,
  cfg: SarvamConfig,
  args: {
    to: string;
    agentVariables?: Record<string, unknown>;
    webhookUrl?: string;
    webhookMetadata?: Record<string, unknown>;
  },
): Promise<{ attempt_id: string }> {
  requireScope(cfg);
  if (!cfg.app_id) throw new SarvamError("Sarvam Agent ID (app_id) is not configured.", "config_incomplete", 400);
  if (!cfg.app_version) {
    throw new SarvamError(
      "Agent version is required by Sarvam's outbound API. Set it in the configuration.",
      "config_incomplete",
      400,
    );
  }
  if (!cfg.connection_id || !cfg.agent_phone_number) {
    throw new SarvamError(
      "Telephony connection ID and agent phone number are required. Copy them from Sarvam → Deploy → Phone Numbers.",
      "config_incomplete",
      400,
    );
  }
  const url =
    `${BASE.outbounds}/v1/orgs/${encodeURIComponent(cfg.org_id!)}/workspaces/${encodeURIComponent(cfg.workspace_id!)}/outbounds`;
  const body: Record<string, unknown> = {
    app_config: {
      app_id: cfg.app_id,
      app_version: cfg.app_version,
      app_type: "agent",
      connection_config: {
        connection_id: cfg.connection_id,
        agent_phone_number: cfg.agent_phone_number,
      },
      ...(args.agentVariables ? { agent_variables: args.agentVariables } : {}),
    },
    user_config: { user_phone_number: args.to },
    ...(args.webhookUrl
      ? { webhook_config: { url: args.webhookUrl, metadata: args.webhookMetadata ?? null } }
      : {}),
  };
  const data = (await call(apiKey, url, { method: "POST", body, timeoutMs: 25_000 })) as
    | { attempt_id?: unknown }
    | null;
  if (!data?.attempt_id) {
    throw new SarvamError("Sarvam accepted the request but returned no attempt_id.", "sarvam_bad_response");
  }
  return { attempt_id: String(data.attempt_id) };
}

/** GET /analytics/v1/{org}/{ws}/{app}/attempts */
export async function getAttempts(
  apiKey: string,
  cfg: SarvamConfig,
  startIso: string,
  endIso: string,
  limit = 50,
) {
  requireScope(cfg);
  if (!cfg.app_id) throw new SarvamError("Sarvam Agent ID (app_id) is not configured.", "config_incomplete", 400);
  const url =
    `${BASE.analytics}/analytics/v1/${encodeURIComponent(cfg.org_id!)}/${encodeURIComponent(cfg.workspace_id!)}/${encodeURIComponent(cfg.app_id)}/attempts?start_datetime=${encodeURIComponent(startIso)}&end_datetime=${encodeURIComponent(endIso)}&limit=${limit}`;
  return await call(apiKey, url);
}

/** Sarvam status → our ledger status. */
export function normalizeCallStatus(s: string | null | undefined): string {
  switch ((s || "").toLowerCase()) {
    case "connected":
      return "connected";
    case "no_answer":
      return "no_answer";
    case "busy":
      return "busy";
    case "failed":
      return "failed";
    default:
      return "failed";
  }
}
