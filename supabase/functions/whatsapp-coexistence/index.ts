// whatsapp-coexistence v1.0.0
// Reads coexistence state for the connected WhatsApp number and can request a
// one-time chat-history sync from the WhatsApp Business phone app.
//
// Actions:
//   status              -> GET  /{phone_number_id}?fields=...
//   request_history_sync-> POST /{phone_number_id}/smb_app_data
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  META_API_BASE,
  computeAppSecretProof,
  appendAppSecretProof,
} from "../_shared/meta-config.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type Integration = {
  id: string;
  branch_id: string | null;
  config: Record<string, unknown> | null;
  credentials: Record<string, unknown> | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function requireStaff(req: Request): Promise<{ userId: string } | Response> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Not authenticated" }, 401);

  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData?.user) return json({ error: "Not authenticated" }, 401);

  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id);

  const allowed = new Set(["owner", "admin", "manager"]);
  const ok = (roles ?? []).some((r: { role: string }) => allowed.has(r.role));
  if (!ok) return json({ error: "Not allowed" }, 403);

  return { userId: userData.user.id };
}

async function loadIntegration(branchId: string | null): Promise<Integration | null> {
  let query = supabase
    .from("integration_settings")
    .select("id, branch_id, config, credentials")
    .eq("integration_type", "whatsapp")
    .eq("is_active", true);

  if (branchId) query = query.or(`branch_id.eq.${branchId},branch_id.is.null`);

  const { data } = await query.limit(5);
  const rows = (data ?? []) as Integration[];
  if (rows.length === 0) return null;
  return rows.find((r) => r.branch_id === branchId) ?? rows[0];
}

async function metaCall(
  integration: Integration,
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const accessToken = integration.credentials?.access_token as string | undefined;
  const appSecret = (integration.credentials?.app_secret as string | undefined) ?? null;
  if (!accessToken) return { ok: false, status: 400, body: { error: "WhatsApp access token missing" } };

  const proof = await computeAppSecretProof(accessToken, appSecret);
  const url = appendAppSecretProof(`${META_API_BASE}${path}`, proof);

  const resp = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const text = await resp.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (!resp.ok) console.error(`[whatsapp-coexistence] Meta ${path} failed [${resp.status}]: ${text}`);
  return { ok: resp.ok, status: resp.status, body };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const guard = await requireStaff(req);
    if (guard instanceof Response) return guard;

    const payload = await req.json().catch(() => ({}));
    const action = String(payload?.action ?? "status");
    const branchId: string | null = payload?.branch_id ?? null;

    const integration = await loadIntegration(branchId);
    if (!integration) return json({ error: "No active WhatsApp connection for this branch" }, 404);

    const phoneNumberId = integration.config?.phone_number_id as string | undefined;
    if (!phoneNumberId) return json({ error: "WhatsApp phone number is not configured" }, 400);

    if (action === "status") {
      const fields = [
        "display_phone_number",
        "verified_name",
        "quality_rating",
        "platform_type",
        "is_on_biz_app",
        "code_verification_status",
      ].join(",");
      const res = await metaCall(integration, `/${phoneNumberId}?fields=${fields}`);
      if (!res.ok) return json({ error: "Could not read the WhatsApp number", details: res.body }, res.status);

      const info = res.body as Record<string, unknown>;
      const stored = (integration.config?.coexistence ?? {}) as Record<string, unknown>;

      // Persist last-seen coexistence state so the UI has history even offline.
      await supabase
        .from("integration_settings")
        .update({
          config: {
            ...(integration.config ?? {}),
            coexistence: {
              ...stored,
              is_on_biz_app: info.is_on_biz_app ?? false,
              platform_type: info.platform_type ?? null,
              checked_at: new Date().toISOString(),
            },
          },
        })
        .eq("id", integration.id);

      return json({
        success: true,
        phone_number_id: phoneNumberId,
        display_phone_number: info.display_phone_number ?? null,
        verified_name: info.verified_name ?? null,
        quality_rating: info.quality_rating ?? null,
        platform_type: info.platform_type ?? null,
        coexistence_enabled: Boolean(info.is_on_biz_app),
        linked_at: stored.linked_at ?? null,
        history_sync: stored.history_sync ?? null,
      });
    }

    if (action === "request_history_sync") {
      const res = await metaCall(integration, `/${phoneNumberId}/smb_app_data`, {
        method: "POST",
        body: JSON.stringify({ messaging_product: "whatsapp", sync_type: "history" }),
      });

      const historySync = {
        requested_at: new Date().toISOString(),
        ok: res.ok,
        status: res.status,
        details: res.ok ? null : res.body,
      };

      await supabase
        .from("integration_settings")
        .update({
          config: {
            ...(integration.config ?? {}),
            coexistence: {
              ...((integration.config?.coexistence ?? {}) as Record<string, unknown>),
              history_sync: historySync,
            },
          },
        })
        .eq("id", integration.id);

      if (!res.ok) {
        return json(
          { error: "WhatsApp refused the history sync request", status: res.status, details: res.body },
          res.status,
        );
      }
      return json({ success: true, history_sync: historySync });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error("[whatsapp-coexistence] crashed:", err);
    return json({ error: (err as Error)?.message ?? "Unexpected error" }, 500);
  }
});
