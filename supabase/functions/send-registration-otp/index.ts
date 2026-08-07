// send-registration-otp v1.0.0
// Split out of `register-member` purely for latency. register-member imports
// pdf-lib (waiver generation), which dominates its cold start — the OTP step
// paid that cost on every /register attempt. This function imports nothing
// heavy, runs its pre-checks in parallel, and answers as soon as the code is
// persisted; WhatsApp/email delivery finishes in the background via the
// canonical dispatch-communication funnel.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { captureEdgeError } from "../_shared/capture-edge-error.ts";
import { phoneVariants, normalizePhone } from "../_shared/phone.ts";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function backgroundTask(p: Promise<unknown>) {
  const safe = p.catch((e) => captureEdgeError("send-registration-otp", e, { route: "background_task" }));
  try {
    (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
      .EdgeRuntime?.waitUntil?.(safe);
  } catch {
    /* runtime without waitUntil — best effort */
  }
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function genOtp(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0] % 1_000_000).padStart(6, "0");
}

async function isExistingMember(phone: string): Promise<boolean> {
  const variants = phoneVariants(phone);
  if (variants.length === 0) return false;
  const { data } = await admin
    .from("profiles")
    .select("id, members:members!inner(id)")
    .in("phone", variants)
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

async function isRateLimited(phone: string): Promise<boolean> {
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const { count } = await admin
    .from("otp_verifications")
    .select("id", { count: "exact", head: true })
    .eq("phone", phone)
    .gte("created_at", since);
  return (count ?? 0) >= 3;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const phone = normalizePhone(String(body.phone || ""));
    const email = body.email ? String(body.email).trim().toLowerCase() : null;
    if (!/^\+\d{10,15}$/.test(phone)) return json(400, { error: "invalid_phone" });

    // All four pre-flight reads are independent — run them together instead of
    // serially, which is where most of the perceived OTP delay came from.
    const [existing, limited, branchRes, tplRes] = await Promise.all([
      isExistingMember(phone),
      isRateLimited(phone),
      admin.from("branches").select("id").eq("is_active", true)
        .order("created_at", { ascending: true }).limit(1).maybeSingle(),
      admin.from("templates").select("id, content")
        .eq("type", "whatsapp")
        .eq("trigger_event", "otp_verification")
        .eq("meta_template_status", "APPROVED")
        .order("updated_at", { ascending: false })
        .limit(1).maybeSingle(),
    ]);

    if (existing) {
      return json(200, { status: "already_member", message: "This number is already registered. Please log in." });
    }
    if (limited) {
      return json(429, { status: "rate_limited", message: "Too many requests. Try again in 10 minutes." });
    }

    const branch_id = branchRes.data?.id;
    if (!branch_id) return json(500, { error: "no_active_branch" });

    const code = genOtp();
    const code_hash = await sha256Hex(code);
    const expires_at = new Date(Date.now() + 5 * 60_000).toISOString();

    const { error: insErr } = await admin
      .from("otp_verifications")
      .insert({ phone, code_hash, expires_at });
    if (insErr) {
      await captureEdgeError("send-registration-otp", insErr, { route: "persist" });
      return json(500, { error: "otp_persist_failed" });
    }

    const otpTpl = tplRes.data;
    const dedupe_key = `otp:${phone}:${Date.now()}`;
    const fallbackBody = `Your Incline verification code is *${code}*. It expires in 5 minutes. Do not share this code.`;

    const deliveries: Promise<unknown>[] = [
      admin.functions.invoke("dispatch-communication", {
        body: {
          branch_id,
          channel: "whatsapp",
          category: "transactional",
          recipient: phone,
          template_id: otpTpl?.id ?? null,
          payload: {
            body: otpTpl?.content || fallbackBody,
            variables: { code, otp: code, expires_in: "5", "1": code },
          },
          dedupe_key,
          force: true,
        },
      }).catch((e) => captureEdgeError("send-registration-otp", e, { route: "whatsapp" })),
    ];

    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      deliveries.push(admin.functions.invoke("dispatch-communication", {
        body: {
          branch_id,
          channel: "email",
          category: "transactional",
          recipient: email,
          payload: {
            subject: "Your Incline verification code",
            body: `<p>Hi,</p><p>Your verification code is <strong style="font-size:24px;letter-spacing:4px">${code}</strong></p><p>It expires in 5 minutes. Do not share this code.</p>`,
            variables: { code },
          },
          dedupe_key: `${dedupe_key}:email`,
          force: true,
        },
      }).catch((e) => captureEdgeError("send-registration-otp", e, { route: "email" })));
    }

    backgroundTask(Promise.allSettled(deliveries));

    return json(200, {
      status: "sent",
      expires_in_seconds: 300,
      channels: email ? ["whatsapp", "email"] : ["whatsapp"],
      template_used: !!otpTpl?.id,
    });
  } catch (e) {
    await captureEdgeError("send-registration-otp", e, { route: "fatal" });
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
