// v1.0.0 — Password-reset fallback.
// Generates a recovery link server-side and sends it through our own mail
// engine (dispatch-communication → send-email) when the built-in auth mailer
// fails or silently drops the message.
// Never reveals whether an account exists.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_BASE = Deno.env.get("APP_BASE_URL") || "https://theincline.in";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? "").trim().toLowerCase();
    const redirectTo = String(body?.redirect_to ?? `${APP_BASE}/auth/reset-password`);

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json({ error: "invalid_email" }, 400);
    }

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Generate the recovery link without sending the built-in email.
    const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });

    if (linkErr || !linkData?.properties?.action_link) {
      // Unknown address (or auth error) — do not leak account existence.
      console.warn("[request-password-reset] generateLink failed:", linkErr?.message);
      return json({ ok: true, sent: false });
    }

    const actionLink = linkData.properties.action_link;
    const userId = linkData.user?.id ?? null;

    // Resolve a branch for the dispatcher (member's branch, else default).
    let branchId: string | null = null;
    let fullName: string | null = null;
    if (userId) {
      const { data: prof } = await sb
        .from("profiles")
        .select("full_name")
        .eq("id", userId)
        .maybeSingle();
      fullName = prof?.full_name ?? null;
      const { data: mem } = await sb
        .from("members")
        .select("branch_id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      branchId = mem?.branch_id ?? null;
    }
    if (!branchId) {
      const { data: br } = await sb
        .from("branches")
        .select("id")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      branchId = br?.id ?? null;
    }
    if (!branchId) return json({ ok: true, sent: false, reason: "no_branch" });

    const greeting = fullName ? `Hi ${fullName},` : "Hi,";
    const html = `
      <p>${greeting}</p>
      <p>We received a request to reset your password for your Incline account.</p>
      <p><a href="${actionLink}" style="display:inline-block;padding:12px 20px;background:#4f46e5;color:#ffffff;border-radius:10px;text-decoration:none;font-weight:600;">Reset my password</a></p>
      <p>Or paste this link into your browser:<br /><span style="word-break:break-all;">${actionLink}</span></p>
      <p>This link expires shortly. If you didn't request it, you can safely ignore this email.</p>
      <p>— The Incline Life by Incline</p>
    `;

    const { data: dispatch, error: dispatchErr } = await sb.functions.invoke(
      "dispatch-communication",
      {
        body: {
          branch_id: branchId,
          channel: "email",
          category: "transactional",
          recipient: email,
          user_id: userId,
          payload: {
            subject: "Reset your Incline password",
            body: html,
            use_branded_template: true,
          },
          dedupe_key: `password_reset:${email}:${Date.now()}:email`,
          force: true,
        },
      },
    );

    if (dispatchErr) {
      console.error("[request-password-reset] dispatch failed:", dispatchErr.message);
      return json({ ok: false, error: "send_failed" }, 500);
    }

    return json({ ok: true, sent: true, dispatch });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[request-password-reset]", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
