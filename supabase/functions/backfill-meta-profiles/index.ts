// v1.0.0 — One-shot backfill of Instagram contact name + avatar for existing chats.
// Iterates distinct IG sender IDs in whatsapp_messages that have no contact_name
// or no matching avatar in whatsapp_chat_settings, resolves them via Graph API,
// and persists via upsert_meta_contact_profile RPC.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  META_API_BASE,
  IG_API_BASE,
  detectMetaHost,
  metaFetchWithFallback,
} from "../_shared/meta-config.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function resolveIg(igUserId: string, accessToken: string) {
  const { isInstagramLogin } = detectMetaHost(accessToken);
  const primary = isInstagramLogin ? IG_API_BASE : META_API_BASE;
  const fallback = isInstagramLogin ? META_API_BASE : IG_API_BASE;
  const fields = "name,username,profile_pic_url";
  async function attempt(base: string) {
    const url = `${base}/${encodeURIComponent(igUserId)}?fields=${fields}&access_token=${encodeURIComponent(accessToken)}`;
    try {
      const r = await metaFetchWithFallback(url);
      const data = await r.json().catch(() => ({}));
      return { ok: r.ok, data };
    } catch {
      return { ok: false, data: {} as any };
    }
  }
  let res = await attempt(primary);
  if (!res.ok) res = await attempt(fallback);
  if (!res.ok) return { name: null as string | null, avatar_url: null as string | null };
  const username = res.data.username ? `@${res.data.username}` : null;
  return {
    name: res.data.name || username || null,
    avatar_url: res.data.profile_pic_url || null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    // Find distinct IG sender IDs that need enrichment
    const { data: msgs, error } = await supabase
      .from("whatsapp_messages")
      .select("phone_number, branch_id, integration_id")
      .eq("platform", "instagram")
      .or("contact_name.is.null,contact_avatar_url.is.null")
      .limit(2000);
    if (error) throw error;

    const seen = new Set<string>();
    const targets: { ig: string; branch_id: string | null; integration_id: string | null }[] = [];
    for (const m of msgs ?? []) {
      const k = `${m.branch_id ?? ""}|${m.phone_number}`;
      if (seen.has(k)) continue;
      seen.add(k);
      targets.push({ ig: m.phone_number, branch_id: m.branch_id, integration_id: (m as any).integration_id ?? null });
    }

    // Load Meta integrations once
    const { data: integrations } = await supabase
      .from("integration_settings")
      .select("id, branch_id, credentials")
      .in("integration_type", ["meta", "instagram", "facebook"])
      .eq("is_active", true);

    function tokenFor(branch_id: string | null): string | null {
      const match =
        integrations?.find((i: any) => i.branch_id === branch_id) ||
        integrations?.find((i: any) => i.branch_id === null) ||
        integrations?.[0];
      return (match as any)?.credentials?.access_token || (match as any)?.credentials?.page_access_token || null;
    }

    let resolved = 0;
    let failed = 0;
    for (const t of targets) {
      const token = tokenFor(t.branch_id);
      if (!token) { failed++; continue; }
      const prof = await resolveIg(t.ig, token);
      if (!prof.name && !prof.avatar_url) { failed++; continue; }
      const { error: rpcErr } = await supabase.rpc("upsert_meta_contact_profile", {
        p_branch_id: t.branch_id,
        p_phone: t.ig,
        p_platform: "instagram",
        p_contact_name: prof.name,
        p_avatar_url: prof.avatar_url,
      });
      if (rpcErr) { failed++; console.warn("rpc fail", t.ig, rpcErr.message); continue; }
      // also update messages rows so chat list reflects immediately
      await supabase
        .from("whatsapp_messages")
        .update({ contact_name: prof.name, contact_avatar_url: prof.avatar_url })
        .eq("platform", "instagram")
        .eq("phone_number", t.ig);
      resolved++;
    }

    return new Response(JSON.stringify({ ok: true, scanned: targets.length, resolved, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
