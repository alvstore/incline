// v1.2.0 — IG avatar persistence: backfill and single-refresh actions now
//          download Meta CDN images into Storage (avatars/meta/instagram/…),
//          flag consent-blocked contacts, and a new `refresh_all_ig_avatars`
//          action upgrades existing meta_cdn rows to permanent storage URLs.
// v1.1.0 — Unified Meta admin function.
// Replaces: meta-subscribe + meta-diagnose.
// Body: { action, ...action-specific fields }
//   subscribe:             { branch_id?, integration_type: "instagram"|"instagram_login"|"messenger" }
//   diagnose:              { integration_id }
//   refresh_page_token:    { integration_id } — calls /me/accounts and persists
//                          credentials.page_access_token for the configured page_id.
//                          Required for IG-via-FB-Page profile resolution.
//   backfill_ig_profiles:  { integration_id, limit? } — re-resolves name/avatar
//                          for IG contacts where contact_name/contact_avatar_url is NULL.
//   refresh_all_ig_avatars:{ branch_id?, limit? } — re-resolves and persists IG
//                          avatars whose source is meta_cdn / missing / stale.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  META_API_BASE,
  IG_API_BASE,
  detectMetaHost,
  metaFetchWithFallback,
} from "../_shared/meta-config.ts";
import { persistMetaAvatar, isConsentBlockedError } from "../_shared/metaAvatar.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PAGE_FIELDS = [
  "messages", "messaging_postbacks", "messaging_optins",
  "message_deliveries", "message_reads", "messaging_referrals",
];
const IG_FIELDS = [
  "messages", "messaging_postbacks", "messaging_seen",
  "comments", "mentions", "story_insights", "messaging_referral",
];

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ──────────────── SUBSCRIBE ────────────────
async function handleSubscribe(body: any) {
  const { branch_id = null, integration_type = "instagram" } = body || {};

  const candidates = integration_type === "instagram"
    ? ["instagram_login", "instagram"]
    : [integration_type];

  let integration: any = null;
  for (const it of candidates) {
    let q = supabase
      .from("integration_settings")
      .select("id, integration_type, config, credentials, branch_id")
      .eq("integration_type", it)
      .eq("is_active", true)
      .limit(1);
    q = branch_id ? q.eq("branch_id", branch_id) : q.is("branch_id", null);
    const { data } = await q.maybeSingle();
    if (data) { integration = data; break; }
  }

  if (!integration) {
    return json({ error: `No active ${integration_type} integration found` }, 404);
  }

  const accessToken = integration.credentials?.access_token || integration.credentials?.page_access_token;
  if (!accessToken) {
    return json({ error: "Missing access_token" }, 400);
  }

  const pageId = integration.config?.page_id;
  const igId = integration.config?.instagram_account_id;
  const { isInstagramLogin } = detectMetaHost(accessToken);

  const results: any[] = [];

  if (isInstagramLogin && igId) {
    const url = `${IG_API_BASE}/${igId}/subscribed_apps?subscribed_fields=${IG_FIELDS.join(",")}`;
    const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });
    const d = await r.json().catch(() => ({}));
    results.push({ target: "instagram_login", id: igId, status: r.status, ok: r.ok, data: d });
  }

  if (!isInstagramLogin && pageId) {
    const url = `${META_API_BASE}/${pageId}/subscribed_apps?subscribed_fields=${PAGE_FIELDS.join(",")}`;
    const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });
    const d = await r.json().catch(() => ({}));
    results.push({ target: "page", id: pageId, status: r.status, ok: r.ok, data: d });

    if (igId) {
      const url2 = `${META_API_BASE}/${igId}/subscribed_apps?subscribed_fields=${IG_FIELDS.join(",")}`;
      const r2 = await fetch(url2, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });
      const d2 = await r2.json().catch(() => ({}));
      results.push({ target: "instagram_via_page", id: igId, status: r2.status, ok: r2.ok, data: d2 });
    }
  }

  const verifyId = isInstagramLogin ? igId : pageId;
  const verifyBase = isInstagramLogin ? IG_API_BASE : META_API_BASE;
  let currentSubs: any = null;
  if (verifyId) {
    const vr = await fetch(`${verifyBase}/${verifyId}/subscribed_apps`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    currentSubs = await vr.json().catch(() => ({}));
  }

  const allOk = results.every((r) => r.ok && !r.data?.error);
  return json({
    success: allOk,
    integration_type: integration.integration_type,
    page_id: pageId,
    instagram_account_id: igId,
    results,
    current_subscriptions: currentSubs,
    hint: allOk
      ? "Subscribed. Send a fresh DM to test — it should appear in Live Feed within seconds."
      : "Subscription failed. Check token scopes (instagram_business_manage_messages, pages_messaging) and that the IG account is a Business account.",
  }, allOk ? 200 : 400);
}

// ──────────────── DIAGNOSE ────────────────
type Check = { id: string; label: string; ok: boolean; detail: string };

async function handleDiagnose(body: any) {
  const integrationId: string | undefined = body?.integration_id;
  if (!integrationId) return json({ error: "integration_id required" }, 400);

  const { data: integ, error } = await supabase
    .from("integration_settings")
    .select("id, integration_type, config, credentials, is_active, branch_id")
    .eq("id", integrationId)
    .maybeSingle();
  if (error || !integ) return json({ error: "Integration not found" }, 404);

  const checks: Check[] = [];
  const cfg: any = integ.config || {};
  const creds: any = integ.credentials || {};
  const token: string = creds.access_token || creds.page_access_token || "";
  const appSecret: string = creds.app_secret || "";
  const verifyToken: string = cfg.webhook_verify_token || "";

  checks.push({
    id: "verify_token",
    label: "Webhook verify token saved",
    ok: !!verifyToken,
    detail: verifyToken
      ? `Configured (${verifyToken.slice(0, 8)}…). Paste this same value in Meta → ${integ.integration_type === "instagram_login" ? "Instagram product → Configure webhooks" : "Webhooks panel"}.`
      : "MISSING — generate a verify token and paste it in Meta Dashboard webhooks panel.",
  });

  const { base: _base, isInstagramLogin } = detectMetaHost(token);
  checks.push({
    id: "token_format",
    label: "Access token format",
    ok: !!token,
    detail: !token
      ? "MISSING — paste an access token."
      : `Detected ${isInstagramLogin ? "Instagram Login (IGAA…) — graph.instagram.com" : "Facebook/Page (EAA…) — graph.facebook.com"}`,
  });

  const secretShape = /^[a-f0-9]{32}$/i.test(appSecret);
  const expectedSecret = isInstagramLogin
    ? "Instagram App Secret (Meta → Instagram product → API setup with Instagram login)"
    : "Basic App Secret (Meta → Settings → Basic)";
  checks.push({
    id: "app_secret",
    label: "App Secret",
    ok: !!appSecret && secretShape,
    detail: !appSecret
      ? `MISSING — webhook signature verification will fail. Use the ${expectedSecret}.`
      : !secretShape
      ? `Format looks wrong (expected 32 hex chars). Make sure you pasted the ${expectedSecret}.`
      : `Saved (prefix ${appSecret.slice(0, 6)}…). Must be the ${expectedSecret}.`,
  });

  if (token) {
    try {
      const meUrl = isInstagramLogin
        ? `${IG_API_BASE}/me?fields=id,username,account_type&access_token=${encodeURIComponent(token)}`
        : `${META_API_BASE}/me?fields=id,name&access_token=${encodeURIComponent(token)}`;
      const r = await metaFetchWithFallback(meUrl);
      const j = await r.json();
      if (r.ok && j.id) {
        checks.push({
          id: "token_validity",
          label: "Token is valid",
          ok: true,
          detail: `Authenticated as ${j.username || j.name || j.id} (${j.account_type || "page"})`,
        });
      } else {
        checks.push({
          id: "token_validity",
          label: "Token is valid",
          ok: false,
          detail: `Meta rejected the token: ${j?.error?.message || r.statusText}`,
        });
      }
    } catch (e) {
      checks.push({
        id: "token_validity",
        label: "Token is valid",
        ok: false,
        detail: `Network error calling Meta: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  const igAccountId = cfg.instagram_account_id || cfg.page_id;
  if (token && igAccountId) {
    try {
      const subUrl = isInstagramLogin
        ? `${IG_API_BASE}/${igAccountId}/subscribed_apps?access_token=${encodeURIComponent(token)}`
        : `${META_API_BASE}/${igAccountId}/subscribed_apps?access_token=${encodeURIComponent(token)}`;
      const r = await metaFetchWithFallback(subUrl);
      const j = await r.json();
      const apps = Array.isArray(j?.data) ? j.data : [];
      const fields: string[] = apps[0]?.subscribed_fields || [];
      const required = ["messages", "messaging_postbacks", "comments", "mentions"];
      const missing = required.filter((f) => !fields.includes(f));
      checks.push({
        id: "subscribed_apps",
        label: "App subscribed to webhook fields",
        ok: apps.length > 0 && missing.length === 0,
        detail:
          apps.length === 0
            ? "App is NOT subscribed to this account. Click 'Subscribe Page & IG to Webhook Events' first."
            : missing.length === 0
            ? `Subscribed to: ${fields.join(", ")}`
            : `Subscribed but missing fields: ${missing.join(", ")}. Re-subscribe and ensure those fields are checked in Meta → Instagram → Webhooks.`,
      });
    } catch (e) {
      checks.push({
        id: "subscribed_apps",
        label: "App subscribed to webhook fields",
        ok: false,
        detail: `Could not fetch subscribed apps: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: msgCount } = await supabase
    .from("whatsapp_messages")
    .select("id", { count: "exact", head: true })
    .eq("platform", "instagram")
    .gte("created_at", since);
  const { count: failCount } = await supabase
    .from("webhook_failures")
    .select("id", { count: "exact", head: true })
    .eq("source", "meta-webhook")
    .gte("created_at", since);
  const { data: recentIngress } = await supabase
    .from("webhook_ingress_log")
    .select("object_type, fields, messaging_count, signature_verified, sample, created_at")
    .eq("source", "meta-webhook")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5);
  const { data: recentProcessing } = await supabase
    .from("webhook_processing_log")
    .select("event_kind, status, reason, meta_error_message, platform_message_id, created_at")
    .eq("source", "meta-webhook")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(10);

  const ingressCount = recentIngress?.length || 0;
  const droppedCount = (recentProcessing || []).filter(
    (r: any) => r.status === "dropped" || r.status === "resolve_failed",
  ).length;
  const placeholderCount = (recentProcessing || []).filter((r: any) => r.status === "placeholder_stored").length;
  const storedCount = (recentProcessing || []).filter((r: any) => r.status === "stored").length;

  checks.push({
    id: "recent_traffic",
    label: "Webhook traffic in the last 24h",
    ok: (msgCount || 0) > 0 && droppedCount === 0,
    detail:
      (msgCount || 0) > 0 && droppedCount === 0
        ? `${msgCount} Instagram message(s) stored. ${ingressCount} webhook delivery(ies). ${failCount || 0} signature failure(s).`
        : (failCount || 0) > 0
        ? `0 messages but ${failCount} failures recorded — likely WRONG APP SECRET. Use the ${expectedSecret}.`
        : ingressCount > 0
        ? `Meta IS delivering (${ingressCount} payload(s) accepted). But processing summary: stored=${storedCount}, placeholder=${placeholderCount}, dropped=${droppedCount}. Check 'meta_error_message' in webhook_processing_log for the exact reason.`
        : "0 messages and 0 deliveries — Meta has not delivered ANY webhook. Most common cause: your personal IG account is not added as an Instagram Tester in Meta App Roles (required while app is in Dev mode), or 'Include Values' is OFF in the webhook subscription configuration.",
  });

  if (recentIngress && recentIngress.length > 0) {
    const last = recentIngress[0] as any;
    const lastEvent = last?.sample?.messaging?.[0] || last?.sample?.changes?.[0] || null;
    const eventKind = lastEvent?.message ? "message" :
                      lastEvent?.message_edit ? "message_edit (no text)" :
                      lastEvent?.field ? `changes:${lastEvent.field}` :
                      "unknown";
    checks.push({
      id: "last_payload_shape",
      label: "Most recent Meta payload shape",
      ok: true,
      detail: `${eventKind} at ${last.created_at} (signature_verified=${last.signature_verified}). Fields=${(last.fields || []).join(",") || "-"}, messaging_count=${last.messaging_count}.`,
    });
  }

  if (recentProcessing && recentProcessing.length > 0) {
    const last = recentProcessing[0] as any;
    checks.push({
      id: "last_processing_result",
      label: "Most recent processing result",
      ok: last.status === "stored" || last.status === "deduped",
      detail: `${last.event_kind} → ${last.status}${last.reason ? " (" + last.reason + ")" : ""}${last.meta_error_message ? " · Meta: " + last.meta_error_message : ""} at ${last.created_at}`,
    });
  }

  const allOk = checks.every((c) => c.ok);
  return json({ ok: allOk, checks });
}

// ──────────────── REFRESH PAGE TOKEN ────────────────
// IG-via-FB-Page profile lookup (/{IGSID}?fields=name,username,profile_pic_url)
// requires a PAGE access token, not the User access token that the OAuth
// flow initially persists. This action calls /me/accounts and stores the
// matching page's access_token so the webhook can resolve names + avatars.
async function handleRefreshPageToken(body: any) {
  const integrationId: string | undefined = body?.integration_id;
  if (!integrationId) return json({ error: "integration_id required" }, 400);

  const { data: integ, error } = await supabase
    .from("integration_settings")
    .select("id, integration_type, config, credentials")
    .eq("id", integrationId)
    .maybeSingle();
  if (error || !integ) return json({ error: "Integration not found" }, 404);

  const userToken = (integ.credentials as any)?.access_token;
  const pageId = (integ.config as any)?.page_id;
  if (!userToken) return json({ error: "Missing credentials.access_token" }, 400);
  if (!pageId) return json({ error: "Missing config.page_id — this action is for IG-via-FB-Page setups only." }, 400);

  const url = `${META_API_BASE}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(userToken)}`;
  const resp = await fetch(url);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data?.error) {
    return json({ error: data?.error?.message || `Graph returned ${resp.status}`, raw: data }, 400);
  }
  const pages = Array.isArray(data?.data) ? data.data : [];
  const match = pages.find((p: any) => String(p.id) === String(pageId));
  if (!match?.access_token) {
    return json({
      error: `No page access_token returned for page_id=${pageId}. Either the user token lacks 'pages_show_list'/'pages_manage_metadata' scope or the user isn't an admin of that page.`,
      pages_seen: pages.map((p: any) => ({ id: p.id, name: p.name })),
    }, 400);
  }

  await supabase
    .from("integration_settings")
    .update({
      credentials: { ...(integ.credentials as any), page_access_token: match.access_token },
      updated_at: new Date().toISOString(),
    })
    .eq("id", integ.id);

  return json({
    success: true,
    page_id: pageId,
    page_name: match.name,
    hint: "Page access token saved. New inbound IG DMs will now resolve username + avatar. Run 'backfill_ig_profiles' to fill in existing contacts.",
  });
}

// ──────────────── BACKFILL IG PROFILES ────────────────
// Re-resolves contact_name / contact_avatar_url for IG (and messenger) contacts
// where they are currently NULL. Uses the same resolver as the webhook.
async function handleBackfillIgProfiles(body: any) {
  const integrationId: string | undefined = body?.integration_id;
  const limit: number = Math.min(Number(body?.limit) || 100, 500);
  if (!integrationId) return json({ error: "integration_id required" }, 400);

  const { data: integ, error } = await supabase
    .from("integration_settings")
    .select("id, integration_type, branch_id, config, credentials")
    .eq("id", integrationId)
    .maybeSingle();
  if (error || !integ) return json({ error: "Integration not found" }, 404);

  // Inline a slim version of the IG profile resolver to avoid importing the
  // webhook module (its top-level Deno.serve() would conflict with this one).
  // Returns the raw CDN URL — caller persists it into Storage.
  async function resolveIgProfile(igUserId: string): Promise<{ name: string | null; avatar_url: string | null; consent_blocked: boolean }> {
    const empty = { name: null, avatar_url: null, consent_blocked: false };
    const creds: any = integ.credentials || {};
    const token = creds.page_access_token || creds.access_token;
    if (!token) return empty;
    const { isInstagramLogin } = detectMetaHost(token);
    const primary = isInstagramLogin ? IG_API_BASE : META_API_BASE;
    const fallback = isInstagramLogin ? META_API_BASE : IG_API_BASE;
    const fields = "name,username,profile_pic_url";
    const tryFetch = async (base: string): Promise<{ name: string | null; avatar_url: string | null; consent_blocked: boolean } | null> => {
      const url = `${base}/${encodeURIComponent(igUserId)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;
      try {
        const r = await metaFetchWithFallback(url);
        const d = await r.json().catch(() => ({}));
        if (isConsentBlockedError(d)) return { name: null, avatar_url: null, consent_blocked: true };
        const meaningful = d && (d.id || d.name || d.username || d.profile_pic_url);
        if (!r.ok || d?.error || !meaningful) return null;
        const username = d.username ? `@${d.username}` : null;
        return { name: d.name || username || null, avatar_url: d.profile_pic_url || null, consent_blocked: false };
      } catch { return null; }
    };
    return (await tryFetch(primary)) || (await tryFetch(fallback)) || empty;
  }


  // Pull IG/messenger settings rows with no name yet.
  let q = supabase
    .from("whatsapp_chat_settings")
    .select("phone_number, platform, branch_id")
    .in("platform", ["instagram", "messenger"])
    .is("contact_name", null)
    .eq("avatar_consent_blocked", false)
    .limit(limit);
  if (integ.branch_id) q = q.eq("branch_id", integ.branch_id);

  const { data: rows, error: rowsErr } = await q;
  if (rowsErr) return json({ error: rowsErr.message }, 500);

  const results = { scanned: rows?.length || 0, resolved: 0, failed: 0, skipped_test_ids: 0, consent_blocked: 0 };
  for (const row of rows || []) {
    if (/^IG_(USER_)?(PHASE_E_)?TEST/i.test(row.phone_number) || /^999000111222/.test(row.phone_number)) {
      results.skipped_test_ids++;
      continue;
    }
    const profile = await resolveIgProfile(row.phone_number);
    if (profile.consent_blocked) {
      try {
        await supabase.rpc("upsert_meta_contact_profile", {
          p_branch_id: row.branch_id,
          p_phone: row.phone_number,
          p_platform: row.platform,
          p_external_id: row.phone_number,
          p_display_name: null,
          p_avatar_url: null,
          p_avatar_source: null,
          p_avatar_synced_at: null,
          p_avatar_consent_blocked: true,
        });
      } catch { /* swallow */ }
      results.consent_blocked++;
      continue;
    }
    if (!profile.name && !profile.avatar_url) {
      results.failed++;
      continue;
    }
    // Persist CDN → Storage so the URL survives.
    let storedUrl = profile.avatar_url;
    let source: "storage" | "meta_cdn" | null = null;
    let syncedAt: string | null = null;
    if (profile.avatar_url) {
      const persisted = await persistMetaAvatar({
        scopedId: row.phone_number,
        platform: "instagram",
        cdnUrl: profile.avatar_url,
        serviceClient: supabase,
      });
      storedUrl = persisted.publicUrl;
      source = persisted.source === "storage" ? "storage" : "meta_cdn";
      syncedAt = persisted.syncedAt;
    }
    try {
      await supabase.rpc("upsert_meta_contact_profile", {
        p_branch_id: row.branch_id,
        p_phone: row.phone_number,
        p_platform: row.platform,
        p_external_id: row.phone_number,
        p_display_name: profile.name,
        p_avatar_url: storedUrl,
        p_avatar_source: source,
        p_avatar_synced_at: syncedAt,
        p_avatar_consent_blocked: false,
      });
      results.resolved++;
    } catch (e) {
      console.warn(`[backfill] upsert failed for ${row.phone_number}:`, e instanceof Error ? e.message : e);
      results.failed++;
    }
  }

  return json({ success: true, ...results });
}

// ──────────────── REFRESH ALL IG AVATARS ────────────────
// Bulk upgrade existing rows whose avatar lives on Meta's CDN (expiring) or
// whose Storage copy is older than 20 days.
async function handleRefreshAllIgAvatars(body: any) {
  const branchId: string | null = body?.branch_id || null;
  const limit: number = Math.min(Number(body?.limit) || 200, 500);

  // Find an IG integration to source the access token.
  const integrations = await loadIgIntegrations(branchId);
  const integ = (integrations || []).find((r: any) => r.branch_id === branchId) || (integrations || [])[0];
  if (!integ) return json({ error: "No active Instagram integration found." }, 404);
  const creds: any = integ.credentials || {};
  const token = creds.page_access_token || creds.access_token;
  if (!token) return json({ error: "Integration has no access token." }, 400);
  const { isInstagramLogin } = detectMetaHost(token);
  const primary = isInstagramLogin ? IG_API_BASE : META_API_BASE;
  const fallback = isInstagramLogin ? META_API_BASE : IG_API_BASE;
  const fields = "name,username,profile_pic_url";

  let q = supabase
    .from("whatsapp_chat_settings")
    .select("phone_number, platform, branch_id, avatar_source, avatar_synced_at")
    .eq("platform", "instagram")
    .eq("avatar_consent_blocked", false)
    .or(`avatar_source.is.null,avatar_source.eq.meta_cdn,avatar_synced_at.lt.${new Date(Date.now() - 20 * 86400_000).toISOString()}`)
    .limit(limit);
  if (branchId) q = q.eq("branch_id", branchId);

  const { data: rows, error: rErr } = await q;
  if (rErr) return json({ error: rErr.message }, 500);

  const results = { scanned: rows?.length || 0, upgraded: 0, failed: 0, consent_blocked: 0 };

  for (const row of rows || []) {
    if (/^IG_(USER_)?(PHASE_E_)?TEST/i.test(row.phone_number)) continue;
    const tryFetch = async (base: string) => {
      const url = `${base}/${encodeURIComponent(row.phone_number)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;
      try {
        const r = await metaFetchWithFallback(url);
        const d = await r.json().catch(() => ({}));
        return { ok: r.ok && !d?.error && (d.id || d.profile_pic_url), data: d };
      } catch { return { ok: false, data: {} }; }
    };
    let res = await tryFetch(primary);
    if (!res.ok) res = await tryFetch(fallback);
    if (isConsentBlockedError(res.data)) {
      await supabase.rpc("upsert_meta_contact_profile", {
        p_branch_id: row.branch_id,
        p_phone: row.phone_number,
        p_platform: "instagram",
        p_external_id: row.phone_number,
        p_display_name: null, p_avatar_url: null,
        p_avatar_source: null, p_avatar_synced_at: null,
        p_avatar_consent_blocked: true,
      });
      results.consent_blocked++;
      continue;
    }
    const cdn = res.data?.profile_pic_url as string | undefined;
    if (!cdn) {
      // No profile pic returned (private/no-consent/deleted IGSID). Mark as
      // blocked so we stop re-scanning the same row on every sweep.
      await supabase.rpc("upsert_meta_contact_profile", {
        p_branch_id: row.branch_id,
        p_phone: row.phone_number,
        p_platform: "instagram",
        p_external_id: row.phone_number,
        p_display_name: res.data?.name || (res.data?.username ? `@${res.data.username}` : null),
        p_avatar_url: null,
        p_avatar_source: null,
        p_avatar_synced_at: null,
        p_avatar_consent_blocked: true,
      });
      results.consent_blocked++;
      continue;
    }
    const persisted = await persistMetaAvatar({
      scopedId: row.phone_number,
      platform: "instagram",
      cdnUrl: cdn,
      serviceClient: supabase,
    });
    try {
      await supabase.rpc("upsert_meta_contact_profile", {
        p_branch_id: row.branch_id,
        p_phone: row.phone_number,
        p_platform: "instagram",
        p_external_id: row.phone_number,
        p_display_name: res.data?.name || (res.data?.username ? `@${res.data.username}` : null),
        p_avatar_url: persisted.publicUrl,
        p_avatar_source: persisted.source === "storage" ? "storage" : "meta_cdn",
        p_avatar_synced_at: persisted.syncedAt,
        p_avatar_consent_blocked: false,
      });
      results.upgraded++;
    } catch (e) {
      console.warn(`[refresh_all] upsert failed ${row.phone_number}:`, e instanceof Error ? e.message : e);
      results.failed++;
    }
  }

  return json({ success: true, ...results });
}
// ──────────────── LIST IG ACCOUNTS / MEDIA / TEST MATCH ────────────────
// Used by the IG Comment-to-DM admin UI to populate dropdowns and simulate matches.

async function loadIgIntegrations(branchId: string | null) {
  // Accept every provider/integration_type the IG settings UI saves IG creds under.
  let q = supabase
    .from("integration_settings")
    .select("id, integration_type, provider, config, credentials, branch_id")
    .or(
      [
        "integration_type.in.(instagram,instagram_login,instagram_meta)",
        "provider.in.(instagram,instagram_login,instagram_meta,meta,facebook_page)",
      ].join(","),
    )
    .eq("is_active", true);
  if (branchId) q = q.or(`branch_id.eq.${branchId},branch_id.is.null`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

function pickIgToken(integ: any): { token: string | null; igId: string | null; pageId: string | null } {
  const creds = (integ?.credentials || {}) as any;
  const cfg = (integ?.config || {}) as any;
  const token =
    creds.page_access_token || creds.ig_access_token || creds.access_token || null;
  // Include `instagram_account_id` — that's the key the Integrations UI persists.
  const igId =
    cfg.ig_user_id ||
    cfg.instagram_business_account_id ||
    cfg.instagram_account_id ||
    cfg.ig_account_id ||
    null;
  const pageId = cfg.page_id || null;
  return { token, igId, pageId };
}

// Resolve a page access token on-demand if creds only have the user token.
// Persists it back to integration_settings so we only pay this round-trip once.
async function ensurePageToken(
  integ: any,
): Promise<{ token: string | null; integration: any; error?: string }> {
  const creds = (integ?.credentials || {}) as any;
  if (creds.page_access_token) return { token: creds.page_access_token, integration: integ };
  const userToken = creds.access_token;
  const pageId = (integ?.config || {}).page_id;
  if (!userToken || !pageId) return { token: creds.access_token || null, integration: integ };

  const url = `${META_API_BASE}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(userToken)}`;
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.error) {
    return { token: userToken, integration: integ, error: j?.error?.message || `Graph ${r.status}` };
  }
  const match = (j?.data || []).find((p: any) => String(p.id) === String(pageId));
  if (!match?.access_token) {
    return {
      token: userToken,
      integration: integ,
      error: `No page token returned for page_id=${pageId}. Token likely missing 'pages_show_list' / 'pages_manage_metadata'.`,
    };
  }
  // Persist & return enriched integration so callers can reuse without re-querying.
  const newCreds = { ...creds, page_access_token: match.access_token };
  await supabase
    .from("integration_settings")
    .update({ credentials: newCreds, updated_at: new Date().toISOString() })
    .eq("id", integ.id);
  return { token: match.access_token, integration: { ...integ, credentials: newCreds } };
}

async function handleListIgAccounts(body: any) {
  const branchId: string | null = body?.branch_id ?? null;
  const integrations = await loadIgIntegrations(branchId);
  const out: any[] = [];
  for (const integ of integrations) {
    const { token, igId } = pickIgToken(integ);
    if (!token || !igId) {
      out.push({ integration_id: integ.id, ig_account_id: igId, error: "missing token or ig id" });
      continue;
    }
    const url = `${IG_API_BASE}/${igId}?fields=id,username,name,profile_picture_url&access_token=${encodeURIComponent(token)}`;
    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    out.push({
      integration_id: integ.id,
      branch_id: integ.branch_id,
      ig_account_id: igId,
      username: j?.username || null,
      name: j?.name || null,
      profile_picture_url: j?.profile_picture_url || null,
      error: j?.error?.message || null,
    });
  }
  return json({ accounts: out });
}

async function handleListIgMedia(body: any) {
  const integrationId: string | undefined = body?.integration_id;
  const limit = Math.min(Number(body?.limit) || 24, 50);
  if (!integrationId) return json({ error: "integration_id required" }, 400);

  const { data: integ0, error } = await supabase
    .from("integration_settings")
    .select("id, config, credentials")
    .eq("id", integrationId)
    .maybeSingle();
  if (error || !integ0) return json({ error: "Integration not found" }, 404);

  // Try to get a page access token (no-op if already present or not applicable).
  const { integration: integ, error: pageTokErr } = await ensurePageToken(integ0);
  const { token, igId } = pickIgToken(integ);
  if (!igId) {
    return json({
      error: "Instagram account id missing on this integration. Open Settings → Integrations → Instagram and save `instagram_account_id` (your IG Business Account id).",
    }, 400);
  }
  if (!token) {
    return json({ error: pageTokErr || "Missing IG access token on this integration." }, 400);
  }

  const fields = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";
  const url = `${IG_API_BASE}/${igId}/media?fields=${fields}&limit=${limit}&access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.error) {
    const msg = j?.error?.message || `Graph ${r.status}`;
    const code = j?.error?.code;
    const sub = j?.error?.error_subcode;
    const type = j?.error?.type;
    return json({
      error: `${msg}${code ? ` (code ${code}${sub ? `/${sub}` : ""}${type ? `, ${type}` : ""})` : ""}`,
      raw: j,
      hint: pageTokErr || undefined,
    }, 400);
  }
  return json({ media: j?.data || [] });
}

async function handleTestIgCommentMatch(body: any) {
  const branchId: string | null = body?.branch_id ?? null;
  const text: string = String(body?.text || "");
  const mediaId: string | null = body?.ig_media_id || null;
  const accountId: string | null = body?.ig_account_id || null;
  if (!branchId || !text) return json({ error: "branch_id and text required" }, 400);

  let q = supabase
    .from("ig_comment_campaigns")
    .select("id, name, keywords, match_type, case_sensitive, ig_media_id, ig_account_id, is_active, reply_mode, dm_template, fallback_message, delay_seconds, ai_instruction, ai_tone")
    .eq("branch_id", branchId)
    .eq("is_active", true);
  const { data: campaigns, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const { matchKeyword, renderTemplate, generateAiReplyEphemeral } =
    await import("../_shared/ig-comment-automation.ts");

  const results = await Promise.all((campaigns || []).map(async (c: any) => {
    let skip: string | null = null;
    if (c.ig_media_id && mediaId && c.ig_media_id !== mediaId) skip = "media_id mismatch";
    if (!skip && c.ig_account_id && accountId && c.ig_account_id !== accountId) skip = "account_id mismatch";
    const matched = skip ? null : matchKeyword(text, c);

    let preview: string | null = null;
    if (matched) {
      if (c.reply_mode === "template" && c.dm_template) {
        preview = renderTemplate(c.dm_template, {
          first_name: "Alex", username: "@alex", keyword: matched, campaign_name: c.name, post_link: "",
        });
      } else if (c.reply_mode === "ai" || c.reply_mode === "hybrid") {
        preview = await generateAiReplyEphemeral({
          comment: text, username: "@alex",
          campaignName: c.name, instruction: c.ai_instruction, tone: c.ai_tone,
        });
        if (!preview && c.reply_mode === "hybrid" && c.dm_template) {
          preview = renderTemplate(c.dm_template, {
            first_name: "Alex", username: "@alex", keyword: matched, campaign_name: c.name, post_link: "",
          });
        }
        if (!preview && c.fallback_message) preview = c.fallback_message;
      }
    }
    return {
      campaign_id: c.id,
      name: c.name,
      would_fire: !!matched,
      matched_keyword: matched,
      skip_reason: skip,
      reply_mode: c.reply_mode,
      delay_seconds: c.delay_seconds,
      preview,
    };
  }));
  return json({ tested_at: new Date().toISOString(), results });
}


// ──────────────── REFRESH SINGLE IG PROFILE ────────────────
// Per-conversation rescue used by the chat ⋯ menu. Resolves name+avatar for one
// IGSID/PSID and upserts whatsapp_chat_settings.contact_name/contact_avatar_url.
async function handleRefreshIgProfile(body: any) {
  const phone: string | undefined = body?.phone_number;
  const branchId: string | null = body?.branch_id || null;
  const platform: string = body?.platform === 'messenger' ? 'messenger' : 'instagram';
  if (!phone) return json({ error: 'phone_number required' }, 400);

  // Find an active IG/Meta integration for this branch (or global fallback).
  let iq = supabase
    .from('integration_settings')
    .select('id, credentials, branch_id')
    .or([
      'integration_type.in.(instagram,instagram_login,instagram_meta)',
      'provider.in.(instagram,instagram_login,instagram_meta,meta,facebook_page)',
    ].join(','))
    .eq('is_active', true);
  if (branchId) iq = iq.or(`branch_id.eq.${branchId},branch_id.is.null`);
  const { data: integrations, error: iErr } = await iq;
  if (iErr) return json({ error: iErr.message }, 500);
  const integ = (integrations || []).find((r: any) => r.branch_id === branchId) || (integrations || [])[0];
  if (!integ) return json({ error: 'No active Instagram integration found for this branch.' }, 404);

  const creds: any = integ.credentials || {};
  const token = creds.page_access_token || creds.access_token;
  if (!token) return json({ error: 'Integration has no access token configured.' }, 400);

  const { isInstagramLogin } = detectMetaHost(token);
  const primary = isInstagramLogin ? IG_API_BASE : META_API_BASE;
  const fallback = isInstagramLogin ? META_API_BASE : IG_API_BASE;
  const fields = 'name,username,profile_pic_url';
  const tryFetch = async (base: string) => {
    const url = `${base}/${encodeURIComponent(phone)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;
    try {
      const r = await metaFetchWithFallback(url);
      const d = await r.json().catch(() => ({}));
      if (isConsentBlockedError(d)) return { ok: false, consent: true, err: 'User consent is required' };
      if (!r.ok || d?.error) return { ok: false, err: d?.error?.message || `HTTP ${r.status}` };
      const meaningful = d && (d.id || d.name || d.username || d.profile_pic_url);
      if (!meaningful) return { ok: false, err: 'empty body' };
      const username = d.username ? `@${d.username}` : null;
      return { ok: true, name: d.name || username || null, avatar_url: d.profile_pic_url || null };
    } catch (e) { return { ok: false, err: e instanceof Error ? e.message : String(e) }; }
  };
  let res: any = await tryFetch(primary);
  if (!res.ok && !res.consent) res = await tryFetch(fallback);
  if (res.consent) {
    await supabase.rpc('upsert_meta_contact_profile', {
      p_branch_id: branchId, p_phone: phone, p_platform: platform, p_external_id: phone,
      p_display_name: null, p_avatar_url: null,
      p_avatar_source: null, p_avatar_synced_at: null, p_avatar_consent_blocked: true,
    });
    return json({ success: false, consent_blocked: true, error: 'User consent is required — this contact has not initiated a DM. Marked as consent-blocked; will not retry.' }, 200);
  }
  if (!res.ok) return json({ success: false, error: `Meta lookup failed: ${res.err}. Check that the page access token has instagram_basic + pages_messaging scopes.` }, 200);

  // Persist Meta CDN avatar → Storage so the URL never expires.
  let storedUrl: string | null = res.avatar_url;
  let source: 'storage' | 'meta_cdn' | null = null;
  let syncedAt: string | null = null;
  if (res.avatar_url) {
    const persisted = await persistMetaAvatar({
      scopedId: phone, platform: 'instagram', cdnUrl: res.avatar_url, serviceClient: supabase,
    });
    storedUrl = persisted.publicUrl;
    source = persisted.source === 'storage' ? 'storage' : 'meta_cdn';
    syncedAt = persisted.syncedAt;
  }
  try {
    await supabase.rpc('upsert_meta_contact_profile', {
      p_branch_id: branchId,
      p_phone: phone,
      p_platform: platform,
      p_external_id: phone,
      p_display_name: res.name,
      p_avatar_url: storedUrl,
      p_avatar_source: source,
      p_avatar_synced_at: syncedAt,
      p_avatar_consent_blocked: false,
    });
  } catch (e) {
    return json({ success: false, error: `Upsert failed: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }
  return json({ success: true, name: res.name, avatar_url: storedUrl, source });
}

// ──────────────── DISPATCHER ────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    switch (action) {
      case "subscribe":            return await handleSubscribe(body);
      case "diagnose":             return await handleDiagnose(body);
      case "refresh_page_token":   return await handleRefreshPageToken(body);
      case "backfill_ig_profiles": return await handleBackfillIgProfiles(body);
      case "refresh_all_ig_avatars": return await handleRefreshAllIgAvatars(body);
      case "refresh_ig_profile":   return await handleRefreshIgProfile(body);
      case "list_ig_accounts":     return await handleListIgAccounts(body);
      case "list_ig_media":        return await handleListIgMedia(body);
      case "test_ig_comment_match":return await handleTestIgCommentMatch(body);
      default:
        return json({ error: `Unknown action: ${action}.` }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
