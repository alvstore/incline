// v1.1.0 — Server-side image fetcher: staff-only, SSRF-hardened, bucket hardcoded
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALLOWED = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
const ALLOWED_BUCKET = "product-images"; // hardcoded — never trust client
const STAFF_ROLES = ["owner", "admin", "manager", "staff"];

// Block private/internal/metadata addresses (SSRF defense)
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (
    h === "localhost" ||
    h === "metadata.google.internal" ||
    h === "metadata" ||
    h.endsWith(".internal") ||
    h.endsWith(".local")
  ) return true;

  // IPv4 literal
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [parseInt(m[1]), parseInt(m[2])];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local + AWS/GCP metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true; // multicast/reserved
  }
  // IPv6 literal — block all literals to be safe
  if (h.includes(":")) return true;
  return false;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    // Staff-only authorization
    const admin = createClient(url, svcKey);
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .in("role", STAFF_ROLES);
    if (!roles?.length) return json({ error: "Insufficient permissions" }, 403);

    const { imageUrl } = await req.json();
    if (!imageUrl || typeof imageUrl !== "string") return json({ error: "imageUrl is required" }, 400);

    let parsed: URL;
    try { parsed = new URL(imageUrl); } catch { return json({ error: "Invalid URL" }, 400); }
    if (!["http:", "https:"].includes(parsed.protocol)) return json({ error: "Only http/https URLs allowed" }, 400);
    if (isBlockedHost(parsed.hostname)) return json({ error: "Host not allowed" }, 400);

    // Fetch (no redirect-following so the destination can't bounce to an internal host)
    const resp = await fetch(parsed.toString(), { redirect: "manual" });
    if (!resp.ok || resp.status >= 300) {
      return json({ error: `Fetch failed: ${resp.status} ${resp.statusText}` }, 400);
    }

    const ct = (resp.headers.get("content-type") || "").toLowerCase().split(";")[0].trim();
    if (!ALLOWED.includes(ct)) {
      return json({ error: `Unsupported content type: ${ct || "unknown"}. Allowed: JPEG, PNG, WebP, GIF` }, 400);
    }

    const buf = await resp.arrayBuffer();
    if (buf.byteLength > 10 * 1024 * 1024) return json({ error: "Image too large (max 10 MB)" }, 400);

    const ext = ct.split("/")[1].replace("jpeg", "jpg");
    const filename = `${crypto.randomUUID()}.${ext}`;

    const { error: upErr } = await admin.storage.from(ALLOWED_BUCKET).upload(filename, buf, {
      contentType: ct,
      upsert: false,
    });
    if (upErr) return json({ error: `Upload failed: ${upErr.message}` }, 500);

    const { data: pub } = admin.storage.from(ALLOWED_BUCKET).getPublicUrl(filename);
    return json({ success: true, url: pub.publicUrl, path: filename, contentType: ct, bytes: buf.byteLength });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("fetch-image-url error:", msg);
    return json({ error: msg }, 500);
  }
});
