// google-reviews-brain v6.1.0 — Places lane now auto-drafts on arrival (plus a
// pending backfill), new `draft_reply` action with tone control, opener
// de-duplication and a style guard that retries robotic/empty drafts.
// v6.0.0 — Places-only discovery (legacy list_accounts /
// list_locations removed), honest rate-limit copy, human-sounding reply drafts
// (event_key=review_request, member_name/branch_name/review_link variables).
// v5.0.0 — Reply-path hardening: business_profile source tagging, gbp_review_name
// persistence, Places→GBP duplicate promotion, draft persistence, real Google errors.
// v4.1.0 — Author matching without FK aliases + token-aware name scoring; AI
// classification accepts tool-call OR JSON body, with a JSON-mode retry.
// v3.0.0 — Lane-aware Google Reviews: Places (New) quick-connect + Business Profile full access
// v2.0.0 — SSOT: classification/draft routed via ai-runtime (purpose='review_reply')
// v1.3.0 — Adds masked client_id diagnostic to oauth_start
// Actions: test_connection | list_accounts | list_locations | fetch_reviews | classify | reply | request_member_review
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateOnce } from "../_shared/ai-runtime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// AI provider/key resolved via ai-runtime → ai-dispatcher per active provider config.
const APP_BASE = Deno.env.get("APP_BASE_URL") || "https://incline.lovable.app";
const GOOGLE_OAUTH_REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-reviews-brain`;

type Action =
  | "test_connection"
  | "oauth_start"
  | "list_accounts"
  | "list_locations"
  | "fetch_reviews"
  | "fetch_reviews_places"
  | "search_places"
  | "diagnose"
  | "classify"
  | "reply"
  | "save_draft"
  | "request_member_review";

interface Body {
  action: Action;
  branch_id?: string;
  account_id?: string; // for list_locations
  query?: string; // for search_places
  inbound_id?: string;
  reply_text?: string;
  draft?: string;
  // for request_member_review (legacy shim)
  feedback_id?: string;
  channel?: "whatsapp" | "sms" | "email" | "in_app";
}

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const supa = () => createClient(SUPABASE_URL, SERVICE_ROLE);

function htmlResponse(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;color:#0f172a}.card{background:#fff;border-radius:16px;padding:32px;max-width:520px;box-shadow:0 18px 45px -25px rgba(15,23,42,.35)}h1{margin:0 0 12px;font-size:22px}p{margin:8px 0;color:#475569;line-height:1.5}a{color:#4f46e5;text-decoration:none;font-weight:700}</style></head><body><div class="card">${body}</div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

const redirect = (url: string) => new Response(null, { status: 302, headers: { Location: url } });

// ─── Credential resolver ───
async function getGoogleConfig(branch_id: string) {
  const sb = supa();
  const { data } = await sb
    .from("integration_settings")
    .select("config, credentials, is_active")
    .eq("integration_type", "google_business")
    .eq("provider", "google_business")
    .eq("branch_id", branch_id)
    .maybeSingle();
  if (!data || !data.is_active) return null;
  const cfg = (data.config ?? {}) as Record<string, string>;
  const cred = (data.credentials ?? {}) as Record<string, string>;
  return {
    account_id: cfg.account_id,
    location_id: cfg.location_id,
    place_id: cfg.place_id,
    place_name: cfg.place_name,
    auto_fetch: cfg.auto_fetch_reviews === "true",
    client_id: cred.client_id,
    client_secret: cred.client_secret,
    api_key: cred.api_key,
    places_api_key: cred.places_api_key || cred.api_key,
    access_token: cred.access_token,
    refresh_token: cred.refresh_token,
    token_expires_at: cred.token_expires_at,
    _config: cfg,
  };
}

/** Merge patch into integration_settings.config for a branch. */
async function patchGoogleConfig(branch_id: string, patch: Record<string, unknown>) {
  const sb = supa();
  const { data } = await sb
    .from("integration_settings")
    .select("id, config")
    .eq("integration_type", "google_business")
    .eq("provider", "google_business")
    .eq("branch_id", branch_id)
    .maybeSingle();
  if (!data) return;
  await sb
    .from("integration_settings")
    .update({ config: { ...((data.config as any) ?? {}), ...patch } })
    .eq("id", data.id);
}

function googleCredentialsForPersist(cfg: any, updates: Record<string, unknown>) {
  const base: Record<string, unknown> = {};
  for (const key of ["client_id", "client_secret", "api_key", "places_api_key", "access_token", "refresh_token", "token_expires_at", "scope"]) {
    if (cfg?.[key] !== undefined) base[key] = cfg[key];
  }
  return { ...base, ...updates };
}

async function startGoogleOAuth(branch_id: string) {
  const cfg = await getGoogleConfig(branch_id);
  if (!cfg) return json({ ok: false, reason: "Save and enable Google Business settings for this branch first." }, 200);
  if (!cfg.client_id || !cfg.client_secret) {
    return json({ ok: false, reason: "Save OAuth Client ID and Client Secret before connecting Google." }, 200);
  }
  const params = new URLSearchParams({
    client_id: cfg.client_id,
    redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/business.manage",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: branch_id,
  });
  const cidStr = String(cfg.client_id || "");
  const masked_client_id = cidStr.length > 14
    ? `${cidStr.slice(0, 8)}…${cidStr.slice(-12)}`
    : cidStr;
  return json({
    ok: true,
    auth_url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
    masked_client_id,
  });
}

async function handleGoogleOAuthCallback(url: URL) {
  const code = url.searchParams.get("code");
  const branchId = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  if (error) {
    return htmlResponse("Google authorization failed", `<h1>Authorization failed</h1><p>${error}</p><p><a href="${APP_BASE}/settings?tab=integrations">Back to Integrations</a></p>`, 400);
  }
  if (!code || !branchId) {
    return htmlResponse("Invalid Google callback", `<h1>Missing callback data</h1><p>This URL must be opened by Google after authorization.</p><p><a href="${APP_BASE}/settings?tab=integrations">Back to Integrations</a></p>`, 400);
  }
  const cfg = await getGoogleConfig(branchId);
  if (!cfg?.client_id || !cfg?.client_secret) {
    return htmlResponse("Google app not configured", `<h1>OAuth credentials missing</h1><p>Save the OAuth Client ID and Client Secret for this branch, then connect again.</p><p><a href="${APP_BASE}/settings?tab=integrations">Back to Integrations</a></p>`, 400);
  }
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.client_id,
      client_secret: cfg.client_secret,
      code,
      grant_type: "authorization_code",
      redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
    }),
  });
  const tokenData = await tokenResp.json().catch(() => ({}));
  if (!tokenResp.ok || !tokenData?.access_token) {
    console.error("Google OAuth exchange failed", tokenData);
    const err = String(tokenData?.error || "");
    const desc = String(tokenData?.error_description || "");
    let hint = "Confirm the redirect URI in Google Cloud matches this callback URL exactly.";
    if (err === "deleted_client" || /deleted_client/i.test(desc)) {
      hint = "The OAuth client was deleted in Google Cloud. Open Google Auth Platform → Clients, create a new <strong>Web application</strong> client, save its Client ID + Secret in Incline, then click Connect Google again.";
    } else if (err === "invalid_client" || /invalid_client/i.test(desc)) {
      hint = "Google rejected the Client ID/Secret pair. Re-copy both from Google Auth Platform → Clients (no spaces, full string) and save them in Incline before reconnecting.";
    } else if (err === "redirect_uri_mismatch" || /redirect_uri_mismatch/i.test(desc)) {
      hint = `In Google Cloud, add this exact Authorized redirect URI: <code>${GOOGLE_OAUTH_REDIRECT_URI}</code>`;
    } else if (err === "invalid_grant" || /invalid_grant/i.test(desc)) {
      hint = "The authorization code expired or was already used. Click Connect Google again to retry.";
    } else if (err === "access_denied") {
      hint = "You cancelled the Google consent screen. Click Connect Google to try again and grant the requested permissions.";
    }
    return htmlResponse(
      "Google token exchange failed",
      `<h1>Token exchange failed</h1><p>${desc || err || "Google refused the authorization code."}</p><p>${hint}</p><p><a href="${APP_BASE}/settings?tab=integrations">Back to Integrations</a></p>`,
      400,
    );
  }
  const expiresAt = new Date(Date.now() + Number(tokenData.expires_in ?? 3600) * 1000).toISOString();
  const sb = supa();
  await sb.from("integration_settings").update({
    credentials: googleCredentialsForPersist(cfg, {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token ?? cfg.refresh_token,
      token_expires_at: expiresAt,
      scope: tokenData.scope,
    }),
    is_active: true,
    updated_at: new Date().toISOString(),
  }).eq("integration_type", "google_business").eq("provider", "google_business").eq("branch_id", branchId);
  return redirect(`${APP_BASE}/settings?tab=integrations&google_oauth=success`);
}

async function refreshAccessToken(branch_id: string, cfg: any): Promise<string | null> {
  if (!cfg.refresh_token || !cfg.client_id || !cfg.client_secret) return cfg.access_token ?? null;
  // Skip refresh if token still valid for >2min
  if (cfg.access_token && cfg.token_expires_at && new Date(cfg.token_expires_at).getTime() > Date.now() + 120_000) {
    return cfg.access_token;
  }
  const params = new URLSearchParams({
    client_id: cfg.client_id,
    client_secret: cfg.client_secret,
    refresh_token: cfg.refresh_token,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    console.error("OAuth refresh failed", await res.text());
    return null;
  }
  const j = await res.json();
  const newAccess = j.access_token as string;
  const expiresAt = new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString();
  // Persist
  const sb = supa();
  await sb
    .from("integration_settings")
    .update({
      credentials: googleCredentialsForPersist(cfg, {
        access_token: newAccess,
        token_expires_at: expiresAt,
      }),
    })
    .eq("integration_type", "google_business")
    .eq("provider", "google_business")
    .eq("branch_id", branch_id);
  return newAccess;
}

// ─── Action: test_connection (lane-aware) ───
// Lane A = Places API (New): read-only, works without Business Profile quota.
// Lane B = Business Profile v4: full history + reply posting.
async function testConnection(branch_id: string) {
  const cfg = await getGoogleConfig(branch_id);
  if (!cfg) return json({ ok: false, reason: "Google Business integration not configured for this branch" }, 200);

  const lanes: Array<{ lane: string; ok: boolean; reason?: string }> = [];

  // Lane A
  const placesKey = await resolvePlacesKey(branch_id);
  if (!placesKey) {
    lanes.push({ lane: "places", ok: false, reason: "No Places API key saved for this branch." });
  } else {
    const p = await fetchPlacesReviewsForBranch(branch_id);
    lanes.push({
      lane: "places",
      ok: !(p as any).reason,
      reason: (p as any).reason ? String((p as any).reason) : undefined,
    });
  }

  // Lane B
  if (!cfg.account_id || !cfg.location_id) {
    lanes.push({ lane: "business_profile", ok: false, reason: "Account / location not selected yet." });
  } else {
    const token = await refreshAccessToken(branch_id, cfg);
    if (!token) {
      lanes.push({ lane: "business_profile", ok: false, reason: "Could not obtain access token. Reconnect Google." });
    } else {
      const url = `https://mybusiness.googleapis.com/v4/accounts/${cfg.account_id}/locations/${cfg.location_id}/reviews?pageSize=1`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      lanes.push(
        res.ok
          ? { lane: "business_profile", ok: true }
          : { lane: "business_profile", ok: false, reason: friendlyGoogleError(res.status, await res.text()) },
      );
    }
  }

  const anyOk = lanes.some((l) => l.ok);
  return json({
    ok: anyOk,
    lanes,
    reason: anyOk ? undefined : lanes.map((l) => `${l.lane}: ${l.reason}`).join(" · "),
  });
}

// v6 — legacy `list_accounts` / `list_locations` discovery removed. Account and
// location IDs are only needed for the reply lane and are set during OAuth; the
// read lane is Places-only.

// ─── Places API (New) fallback ───────────────────────────────────────────────
// The Business Profile v4 reviews endpoint requires an *approved* quota request
// and the legacy "Google My Business API" enabled on the Cloud project. Until
// that lands (or whenever it errors), we read the public review snippet Google
// exposes through Places API (New) — rating, review count and up to 5 recent
// reviews. Read-only: no replies, no full history, but the dashboard is live.
const ENV_PLACES_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY") ?? "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const GATEWAY_PLACES = "https://connector-gateway.lovable.dev/google_maps/places";

/**
 * Places key resolution order:
 *   1. Google Maps connector key `GOOGLE_MAPS_API_KEY` (routed via the Lovable gateway) —
 *      managed, always enabled for Places API (New), no referrer/IP restrictions.
 *   2. per-branch `credentials.places_api_key` (or legacy `credentials.api_key`) as fallback.
 */
async function resolvePlacesKey(branch_id?: string): Promise<string> {
  if (ENV_PLACES_KEY && LOVABLE_API_KEY) return ENV_PLACES_KEY;
  if (branch_id) {
    const cfg = await getGoogleConfig(branch_id);
    if (cfg?.places_api_key) return String(cfg.places_api_key);
  }
  return ENV_PLACES_KEY;
}


/**
 * The connector key is a *gateway connection key*, not a Google API key — calling
 * places.googleapis.com with it directly always 403s. Route those calls through the
 * Lovable connector gateway; use direct Google calls only for a branch-pasted key.
 */
async function placesFetch(
  key: string,
  path: string, // e.g. "/v1/places:searchText"
  init: { method?: string; fieldMask: string; body?: unknown },
): Promise<Response> {
  const viaGateway = key === ENV_PLACES_KEY && !!ENV_PLACES_KEY && !!LOVABLE_API_KEY;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Goog-FieldMask": init.fieldMask,
  };
  if (viaGateway) {
    headers["Authorization"] = `Bearer ${LOVABLE_API_KEY}`;
    headers["X-Connection-Api-Key"] = key;
  } else {
    headers["X-Goog-Api-Key"] = key;
  }
  return await fetch(`${viaGateway ? GATEWAY_PLACES : "https://places.googleapis.com"}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}


/** Turn a raw Google error body into something an owner can act on. */
function friendlyGoogleError(status: number, body: string): string {
  const b = body || "";
  if (/has not been used in project|is disabled/i.test(b)) {
    return "Google says the Business Profile APIs are disabled for your Google Cloud project. Enable 'My Business Account Management API', 'My Business Business Information API' and 'Google My Business API', then retry.";
  }
  if (status === 403 && /quota|rate/i.test(b)) {
    return "Google has not granted review-API quota to your Cloud project yet. Submit the Business Profile API quota request form — approval usually takes a few days.";
  }
  if (status === 403) return "Google returned 403 Forbidden. The connected Google account may not manage this location, or the APIs are not enabled.";
  if (status === 429) return "Google rate-limited this Business Profile call. Reading reviews still works through Places — only posting replies is affected.";
  if (status === 401) return "Google rejected the access token. Reconnect the Google account.";
  return `Google returned HTTP ${status}.`;
}


function extractPlaceIdFromLink(link?: string | null): string | null {
  if (!link) return null;
  const m = link.match(/[?&]place_id=([^&]+)/) ?? link.match(/placeid=([^&]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Free-text place search used by the "Find my listing" picker. */
async function searchPlaces(branch_id: string | undefined, query: string) {
  const key = await resolvePlacesKey(branch_id);
  if (!key) return json({ ok: false, reason: "No Places API key saved. Add one in Step 1 of the Google drawer." }, 200);
  const res = await placesFetch(key, "/v1/places:searchText", {
    method: "POST",
    fieldMask: "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount",
    body: { textQuery: query, maxResultCount: 8 },
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error("places searchText failed", res.status, txt.slice(0, 300));
    return json({ ok: false, reason: friendlyPlacesError(res.status, txt) }, 200);
  }
  const j = await res.json();
  const items = ((j.places ?? []) as any[]).map((p) => ({
    place_id: p.id,
    name: p.displayName?.text ?? p.id,
    address: p.formattedAddress ?? "",
    rating: p.rating ?? null,
    total_ratings: p.userRatingCount ?? null,
  }));
  return json({ ok: true, items });
}

function friendlyPlacesError(status: number, body: string): string {
  const b = body || "";
  if (/API key not valid|API_KEY_INVALID/i.test(b)) return "That Places API key is not valid. Copy it again from Google Cloud → Credentials.";
  if (/REQUEST_DENIED|referer|referrer/i.test(b)) return "Google rejected the key — remove HTTP-referrer restrictions (server-side calls send no referer) or restrict by IP instead.";
  if (/has not been used in project|SERVICE_DISABLED/i.test(b)) return "Enable 'Places API (New)' in Google Cloud for this project, then retry.";
  if (status === 429) return "Places API rate limit hit — try again in a minute.";
  return `Places API ${status}: ${b.slice(0, 160)}`;
}

async function resolvePlaceId(branch_id: string, cfg: any): Promise<string | null> {
  if (cfg?.place_id) return String(cfg.place_id);
  const sb = supa();
  const key = await resolvePlacesKey(branch_id);
  const { data: branch } = await sb
    .from("branches")
    .select("name, address, city, google_review_link")
    .eq("id", branch_id)
    .maybeSingle();
  const fromLink = extractPlaceIdFromLink(branch?.google_review_link);
  if (fromLink) return fromLink;
  if (!key || !branch?.name) return null;
  const query = [branch.name, branch.address, branch.city].filter(Boolean).join(", ");
  const res = await placesFetch(key, "/v1/places:searchText", {
    method: "POST",
    fieldMask: "places.id,places.displayName",
    body: { textQuery: query, maxResultCount: 1 },
  });

  if (!res.ok) {
    console.error("places searchText failed", res.status, (await res.text()).slice(0, 300));
    return null;
  }
  const j = await res.json();
  return j?.places?.[0]?.id ?? null;
}

/**
 * Reads a place record (rating, count, reviews).
 * The managed Google Maps connector key blocks `Places.GetPlace`, so we try the
 * details endpoint first and fall back to `places:searchText`, which returns the
 * same review payload and IS allowed on the managed key.
 */
async function fetchPlaceRecord(
  key: string,
  placeId: string,
  textQuery: string,
): Promise<{ ok: true; place: any } | { ok: false; status: number; body: string }> {
  const details = await placesFetch(key, `/v1/places/${encodeURIComponent(placeId)}?languageCode=en`, {
    fieldMask: "id,displayName,rating,userRatingCount,googleMapsUri,reviews",
  });
  if (details.ok) return { ok: true, place: await details.json() };
  const detailsBody = await details.text();

  if (textQuery) {
    const search = await placesFetch(key, "/v1/places:searchText", {
      method: "POST",
      fieldMask:
        "places.id,places.displayName,places.rating,places.userRatingCount,places.googleMapsUri,places.reviews",
      body: { textQuery, maxResultCount: 5, languageCode: "en" },
    });

    if (search.ok) {
      const j = await search.json();
      const list = (j.places ?? []) as any[];
      const match = list.find((p) => p.id === placeId) ?? list[0];
      if (match) return { ok: true, place: match };
    }
  }
  return { ok: false, status: details.status, body: detailsBody };
}

async function fetchPlacesReviewsForBranch(branch_id: string) {
  const key = await resolvePlacesKey(branch_id);
  if (!key) return { branch_id, fetched: 0, source: "places", reason: "no_places_api_key" };
  const sb = supa();
  const cfg = (await getGoogleConfig(branch_id)) ?? {};
  const placeId = await resolvePlaceId(branch_id, cfg);
  if (!placeId) return { branch_id, fetched: 0, source: "places", reason: "place_id_unresolved" };

  const { data: branch } = await sb
    .from("branches")
    .select("name, address, city")
    .eq("id", branch_id)
    .maybeSingle();
  const textQuery = [cfg?.place_name, branch?.name, branch?.address, branch?.city]
    .filter(Boolean)
    .join(", ");

  const result = await fetchPlaceRecord(key, placeId, textQuery);
  if (!result.ok) {
    console.error("places details failed", result.status, result.body.slice(0, 300));
    return {
      branch_id,
      fetched: 0,
      source: "places",
      reason: `places_${result.status}`,
      detail: friendlyPlacesError(result.status, result.body),
    };
  }
  const j = result.place;

  const reviews = (j.reviews ?? []) as any[];
  // Deep link staff can open to reply manually while GBP quota is pending.
  const placeUri: string | null =
    j.googleMapsUri ?? (placeId ? `https://search.google.com/local/reviews?placeid=${placeId}` : null);
  let upserted = 0;
  for (const r of reviews) {
    const row = {
      branch_id,
      google_review_id: String(r.name ?? "").split("/").pop() ?? r.name,
      author_name: r.authorAttribution?.displayName ?? null,
      author_photo_url: r.authorAttribution?.photoUri ?? null,
      rating: typeof r.rating === "number" ? Math.round(r.rating) : null,
      review_text: r.originalText?.text ?? r.text?.text ?? null,
      posted_at: r.publishTime ?? null,
      relative_time: r.relativePublishTimeDescription ?? null,
      review_permalink: r.googleMapsUri ?? placeUri,
      source: "places",
      raw: r,
    };
    const { error } = await sb
      .from("google_reviews_inbound")
      .upsert(row, { onConflict: "google_review_id", ignoreDuplicates: false });
    if (error) console.error("places upsert error", error.message);
    else upserted++;
  }

  // Persist the aggregate so dashboards show the true rating, not the mean of 5 rows.
  await patchGoogleConfig(branch_id, {
    place_id: placeId,
    place_name: j.displayName?.text ?? (cfg as any)?.place_name ?? null,
    place_rating: j.rating ?? null,
    place_rating_count: j.userRatingCount ?? null,
    place_uri: placeUri,
    last_places_sync: new Date().toISOString(),
  });

  // The Places lane has no classification step of its own, so freshly imported
  // rows used to sit at "AI pending" with an empty draft until someone clicked
  // Re-analyse. Draft them here (and backfill older pending rows) best-effort.
  let classified = 0;
  try {
    const { data: pending } = await sb
      .from("google_reviews_inbound")
      .select("id, ai_draft_reply, ai_classified_at")
      .eq("branch_id", branch_id)
      .order("posted_at", { ascending: false })
      .limit(25);
    const todo = (pending ?? [])
      .filter((p: any) => !p.ai_classified_at || !String(p.ai_draft_reply ?? "").trim())
      .slice(0, 8);
    for (const p of todo) {
      try {
        await classifyOne(p.id);
        classified++;
      } catch (e) {
        console.error("auto-classify failed", p.id, e);
      }
    }
  } catch (e) {
    console.error("auto-classify sweep failed", e);
  }



  return {
    branch_id,
    fetched: upserted,
    drafted: classified,
    source: "places",
    rating: j.rating ?? null,
    total_ratings: j.userRatingCount ?? null,
    place_id: placeId,
    place_uri: placeUri,
  };

}

async function recordFetchError(branch_id: string, reason: string | null) {
  const sb = supa();
  const cfg = await getGoogleConfig(branch_id);
  if (!cfg) return;
  await sb
    .from("integration_settings")
    .update({
      credentials: googleCredentialsForPersist(cfg, {
        last_fetch_error: reason,
        last_fetch_at: new Date().toISOString(),
      }),
    })
    .eq("integration_type", "google_business")
    .eq("provider", "google_business")
    .eq("branch_id", branch_id);
}

async function fetchReviewsForBranch(branch_id: string) {
  const sb = supa();
  const cfg = await getGoogleConfig(branch_id);
  if (!cfg || !cfg.account_id || !cfg.location_id) {
    return await fetchPlacesReviewsForBranch(branch_id);
  }
  const token = await refreshAccessToken(branch_id, cfg);
  if (!token) return { branch_id, fetched: 0, reason: "no_token" };

  const url = `https://mybusiness.googleapis.com/v4/accounts/${cfg.account_id}/locations/${cfg.location_id}/reviews?pageSize=50`;
  // Pacing + backoff: Google's v4 reviews endpoint is quota-starved by default.
  let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  for (let attempt = 1; attempt <= 2 && (res.status === 429 || res.status >= 500); attempt++) {
    await new Promise((r) => setTimeout(r, attempt * 1500 + Math.random() * 500));
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  }
  if (!res.ok) {
    const txt = await res.text();
    console.error("fetch reviews failed", branch_id, res.status, txt.slice(0, 300));
    await recordFetchError(branch_id, friendlyGoogleError(res.status, txt));
    // Fall back to the public Places snapshot so the dashboard stays alive.
    const places = await fetchPlacesReviewsForBranch(branch_id);
    return { ...places, gbp_reason: `api_${res.status}`, gbp_error: friendlyGoogleError(res.status, txt) };
  }
  await recordFetchError(branch_id, null);

  const body = await res.json();
  const reviews = (body.reviews ?? []) as any[];
  let inserted = 0;
  const newIds: string[] = [];
  for (const r of reviews) {
    const ratingMap: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
    const reviewName = r.name ?? `accounts/${cfg.account_id}/locations/${cfg.location_id}/reviews/${r.reviewId}`;
    const row = {
      branch_id,
      google_review_id: r.reviewId ?? r.name,
      author_name: r.reviewer?.displayName ?? null,
      author_photo_url: r.reviewer?.profilePhotoUrl ?? null,
      rating: ratingMap[r.starRating] ?? null,
      review_text: r.comment ?? null,
      posted_at: r.createTime ?? null,
      google_reply_text: r.reviewReply?.comment ?? null,
      google_reply_updated_at: r.reviewReply?.updateTime ?? null,
      // v5 — mark the lane and keep the reply target so replies always resolve.
      source: "business_profile",
      gbp_review_name: reviewName,
      raw: r,
    };
    const { data: up, error } = await sb
      .from("google_reviews_inbound")
      .upsert(row, { onConflict: "google_review_id", ignoreDuplicates: false })
      .select("id, ai_classification")
      .maybeSingle();
    if (error) {
      console.error("upsert error", error);
      continue;
    }
    if (up) await promotePlacesDuplicate(branch_id, up.id, row);
    if (up && (up.ai_classification === "pending" || !up.ai_classification)) {
      newIds.push(up.id);
      inserted++;
    }
  }
  // classify new ones inline (best effort)
  for (const id of newIds.slice(0, 10)) {
    try { await classifyOne(id); } catch (e) { console.error("classify err", id, e); }
  }
  return { branch_id, fetched: reviews.length, classified: newIds.length, source: "business_profile" };
}

/**
 * The Places lane stores the same review under a different Google id. When the
 * Business Profile lane later ingests it, fold the older read-only row into the
 * replyable one (keeping any draft the staff already typed) and delete the dupe.
 */
async function promotePlacesDuplicate(
  branch_id: string,
  gbpRowId: string,
  gbp: { author_name: string | null; review_text: string | null; posted_at: string | null },
) {
  if (!gbp.author_name && !gbp.review_text) return;
  const sb = supa();
  const { data: dupes } = await sb
    .from("google_reviews_inbound")
    .select("id, author_name, review_text, posted_at, reply_text, ai_draft_reply, draft_reply, reply_status")
    .eq("branch_id", branch_id)
    .eq("source", "places")
    .neq("id", gbpRowId)
    .limit(50);
  const norm = (s?: string | null) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const day = (s?: string | null) => (s ? new Date(s).toISOString().slice(0, 10) : "");
  for (const d of dupes ?? []) {
    const sameAuthor = norm(d.author_name) === norm(gbp.author_name);
    const sameText = norm(d.review_text).slice(0, 120) === norm(gbp.review_text).slice(0, 120);
    const sameDay = day(d.posted_at) === day(gbp.posted_at);
    if (!sameAuthor || !(sameText || sameDay)) continue;
    // Carry the staff's unsent work forward onto the replyable row.
    const carry = d.draft_reply || d.reply_text || null;
    if (carry) {
      await sb.from("google_reviews_inbound").update({ draft_reply: carry }).eq("id", gbpRowId);
    }
    await sb.from("google_reviews_inbound").delete().eq("id", d.id);
    console.log(`merged places duplicate ${d.id} into business_profile row ${gbpRowId}`);
  }
}


async function fetchReviews(branch_id?: string) {
  const sb = supa();
  let branches: { id: string }[] = [];
  if (branch_id) {
    branches = [{ id: branch_id }];
  } else {
    const { data } = await sb
      .from("integration_settings")
      .select("branch_id, config, is_active")
      .eq("integration_type", "google_business")
      .eq("provider", "google_business")
      .eq("is_active", true);
    branches = (data ?? [])
      .filter((d: any) => (d.config ?? {}).auto_fetch_reviews === "true" && d.branch_id)
      .map((d: any) => ({ id: d.branch_id }));
  }
  const results = [];
  for (const b of branches) results.push(await fetchReviewsForBranch(b.id));
  return json({ ok: true, results });
}

// ─── Author matching ───
async function findAuthorMatch(branch_id: string, author_name: string | null) {
  if (!author_name) return { match_type: "none", evidence: {} };
  const sb = supa();

  // Members: fetch rows, then resolve names via a separate profiles read.
  // (Never rely on auto-generated FK aliases — a bad hint silently returns null.)
  const { data: branchMembers } = await sb
    .from("members")
    .select("id, user_id, joined_at, status, lifecycle_state, member_code")
    .eq("branch_id", branch_id)
    .limit(2000);

  const userIds = (branchMembers ?? [])
    .map((m: any) => m.user_id)
    .filter(Boolean);
  const nameById = new Map<string, string>();
  for (let i = 0; i < userIds.length; i += 200) {
    const slice = userIds.slice(i, i + 200);
    const { data: profs } = await sb
      .from("profiles")
      .select("id, full_name")
      .in("id", slice);
    for (const p of (profs ?? []) as any[]) {
      if (p.full_name) nameById.set(p.id, p.full_name);
    }
  }

  let bestMember: any = null;
  let bestScore = 0;
  const target = author_name.toLowerCase().trim();
  for (const m of (branchMembers ?? []) as any[]) {
    const full = m.user_id ? nameById.get(m.user_id) ?? "" : "";
    if (!full) continue;
    const score = nameScore(target, full);
    if (score > bestScore) {
      bestScore = score;
      bestMember = { ...m, _name: full };
    }
  }
  if (bestScore >= 0.7 && bestMember) {
    return {
      match_type: "member",
      matched_member_id: bestMember.id,
      match_confidence: bestScore,
      evidence: {
        name: bestMember._name,
        member_code: bestMember.member_code,
        joined_at: bestMember.joined_at,
        status: bestMember.status,
        lifecycle_state: bestMember.lifecycle_state,
      },
    };
  }

  // Leads
  const { data: leads } = await sb
    .from("leads")
    .select("id, full_name, source, status, created_at")
    .eq("branch_id", branch_id)
    .limit(2000);
  let bestLead: any = null;
  let bestLeadScore = 0;
  for (const l of (leads ?? []) as any[]) {
    const name = (l.full_name ?? "").trim();
    if (!name) continue;
    const score = nameScore(target, name);
    if (score > bestLeadScore) {
      bestLeadScore = score;
      bestLead = l;
    }
  }
  if (bestLeadScore >= 0.7 && bestLead) {
    return {
      match_type: "lead",
      matched_lead_id: bestLead.id,
      match_confidence: bestLeadScore,
      evidence: {
        name: bestLead.full_name,
        source: bestLead.source,
        status: bestLead.status,
        created_at: bestLead.created_at,
      },
    };
  }
  return { match_type: "none", evidence: {} };
}

/**
 * Name similarity tuned for Google display names, which are frequently longer
 * or shorter than the CRM record ("Aamil" vs "Aamil Khan"). Combines bigram
 * similarity with token overlap so partial names still match.
 */
function nameScore(a: string, b: string): number {
  const norm = (s: string) =>
    s.replace(/[^a-z\s]/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const A = norm(a);
  const B = norm(b);
  if (!A || !B) return 0;
  if (A === B) return 1;

  const setA = new Set(A.split(" ").filter((t) => t.length > 1));
  const setB = new Set(B.split(" ").filter((t) => t.length > 1));
  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared++;

  const minTokens = Math.min(setA.size, setB.size);
  const tokenScore = minTokens > 0 ? shared / minTokens : 0;
  // Every token of the shorter name present in the longer one → strong match.
  if (tokenScore === 1 && minTokens >= 1) {
    return setA.size === setB.size ? 0.98 : 0.9;
  }

  return Math.max(similarity(A, B), tokenScore * 0.8);
}


// Simple Dice-coefficient bigram similarity
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (s: string) => {
    const out: Record<string, number> = {};
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      out[bg] = (out[bg] ?? 0) + 1;
    }
    return out;
  };
  const aB = bigrams(a);
  const bB = bigrams(b);
  let inter = 0;
  for (const k of Object.keys(aB)) {
    if (bB[k]) inter += Math.min(aB[k], bB[k]);
  }
  return (2 * inter) / (a.length - 1 + b.length - 1);
}

// ─── Reply style helpers ───
const BANNED_SNIPPETS = [
  "we appreciate your feedback",
  "valued customer",
  "we strive to",
  "at our facility",
  "thank you for taking the time",
  "we are delighted",
  "rest assured",
  "esteemed",
  "as an ai",
];

/** Strip machine tells that survive prompting (em dashes, emoji, hashtags). */
function sanitizeReply(text: string): string {
  return String(text ?? "")
    .replace(/[\u2014\u2013]/g, "-")
    .replace(/[#][\w]+/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/!{2,}/g, "!")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function violatesStyle(text: string): boolean {
  const t = text.toLowerCase();
  return !text.trim() || BANNED_SNIPPETS.some((b) => t.includes(b));
}

/** Openers already used on this branch, so replies don't look copy-pasted. */
async function recentOpeners(branch_id: string, excludeId: string): Promise<string[]> {
  const sb = supa();
  const { data } = await sb
    .from("google_reviews_inbound")
    .select("ai_draft_reply, reply_text, created_at")
    .eq("branch_id", branch_id)
    .neq("id", excludeId)
    .order("created_at", { ascending: false })
    .limit(8);
  return (data ?? [])
    .map((r: any) => String(r.reply_text || r.ai_draft_reply || "").trim())
    .filter(Boolean)
    .map((s: string) => s.split(/[.!?]/)[0].slice(0, 60))
    .slice(0, 6);
}

interface DraftOpts {
  /** warm | short | apologetic | professional */
  tone?: string;
  /** Regenerate the reply only, leaving classification/match data untouched. */
  draftOnly?: boolean;
}

// ─── Action: classify (one row) ───
async function classifyOne(inbound_id: string, opts: DraftOpts = {}) {
  const sb = supa();
  const { data: row, error } = await sb
    .from("google_reviews_inbound")
    .select("*, branches(name)")
    .eq("id", inbound_id)
    .maybeSingle();
  if (error || !row) return { ok: false, reason: "not_found" };

  const match = await findAuthorMatch(row.branch_id, row.author_name);
  const avoidOpeners = await recentOpeners(row.branch_id, inbound_id);

  let classification = "genuine";
  let reasoning = "";
  let draft = "";
  {
    // v6 — persona comes from ai_purposes.review_reply.system_prompt. This block
    // only carries the output contract plus the "sound like a human" rules that
    // stop the model producing obvious AI boilerplate.
    const toneLine = ({
      short: "TONE: keep it to 1-2 sentences, friendly and brief.",
      warm: "TONE: warm and personal, like a quick note from the founder.",
      apologetic: "TONE: genuinely apologetic and accountable, no defensiveness.",
      professional: "TONE: calm and professional, still human, no corporate filler.",
    } as Record<string, string>)[String(opts.tone ?? "").toLowerCase()] ?? "";

    const sysOverride = [
      "You classify a Google review and write the owner's reply.",
      "classification must be exactly one of: genuine, unhappy_member, suspected_fake, spam.",
      "",
      "REPLY RULES — write like the gym's founder typing on her phone, not like an AI:",
      "1. Open by referring to something SPECIFIC the reviewer actually mentioned (a trainer, the ice bath, the sauna, cleanliness, timings, staff, equipment). If the review has no text, react to the star rating honestly instead of inventing details.",
      "2. Use the reviewer's first name only if it reads naturally.",
      "3. 2 to 4 short sentences. Under 400 characters. Plain everyday English; light Indian-English/Hinglish warmth is fine ('really glad', 'do drop by', 'see you at the club').",
      "4. BANNED phrases: 'We appreciate your feedback', 'valued customer', 'we strive to', 'at our facility', 'thank you for taking the time', 'we are delighted', 'rest assured', 'kindly', 'esteemed', em dashes, exclamation-mark spam, emojis, hashtags.",
      "5. Never repeat the same opener across reviews. Vary sentence rhythm.",
      "6. For 1-3 star reviews: acknowledge the specific problem in plain words, own it without excuses, say the one concrete thing being done, and invite them to reach the team directly. Do not offer refunds, free months, or anything financial.",
      "7. For 4-5 star reviews: keep it short and personal, name what they liked, no sales pitch.",
      "8. Never accuse the reviewer of being fake or a competitor, even when the classification says suspected_fake — in that case write a calm, neutral, factual reply.",
      "9. No promises the gym cannot keep, no pricing, no opening dates.",
      "10. A draft_reply is ALWAYS required. Never return an empty string.",
      toneLine,
      avoidOpeners.length
        ? `Do NOT start with any of these already-used openers: ${avoidOpeners.map((o) => `"${o}"`).join(", ")}`
        : "",
      "",
      "Respond ONLY as JSON: {\"classification\":\"…\",\"reasoning\":\"…\",\"draft_reply\":\"…\"}.",
      "reasoning is internal staff-facing: 1-2 lines on why this classification, citing evidence.",
    ].filter(Boolean).join("\n");
    const userPrompt = JSON.stringify({
      branch_name: (row.branches as any)?.name ?? "our gym",
      rating: row.rating,
      review_text: row.review_text,
      has_text: !!(row.review_text && String(row.review_text).trim()),
      author_name: row.author_name,
      author_first_name: String(row.author_name ?? "").trim().split(/\s+/)[0] || null,
      posted_at: row.posted_at,
      is_known_member: match.match_type && match.match_type !== "none",
      match_type: match.match_type,
      match_evidence: match.evidence,
      requested_tone: opts.tone ?? null,
      regenerate: !!opts.draftOnly,
    });


    const extractJson = (text: string | undefined | null): any => {
      if (!text) return null;
      const cleaned = String(text).replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
      try { return JSON.parse(cleaned); } catch { /* try substring */ }
      const s = cleaned.indexOf("{");
      const e = cleaned.lastIndexOf("}");
      if (s >= 0 && e > s) {
        try { return JSON.parse(cleaned.slice(s, e + 1)); } catch { /* noop */ }
      }
      return null;
    };

    const apply = (parsed: any): boolean => {
      if (!parsed || typeof parsed !== "object") return false;
      if (!parsed.classification && !parsed.draft_reply && !parsed.reasoning) return false;
      classification = parsed.classification ?? classification;
      reasoning = parsed.reasoning ?? reasoning;
      draft = parsed.draft_reply ?? draft;
      return true;
    };

    let lastError = "";
    try {
      // Attempt 1 — tool call (models that support it return structured args).
      const r = await generateOnce({
        purpose: "review_reply",
        branchId: row.branch_id ?? null,
        userMessage: userPrompt,
        systemOverride: sysOverride,
        maxTokens: 1500,

        tools: [{
          type: "function",
          function: {
            name: "classify_review",
            description: "Classify and draft reply.",
            parameters: {
              type: "object",
              properties: {
                classification: { type: "string", enum: ["genuine", "unhappy_member", "suspected_fake", "spam"] },
                reasoning: { type: "string" },
                draft_reply: { type: "string" },
              },
              required: ["classification", "reasoning", "draft_reply"],
              additionalProperties: false,
            },
          },
        }],
        toolChoice: { type: "function", function: { name: "classify_review" } },
      });
      // Some providers (Gemini via OpenAI-compat) answer in the message body
      // instead of a tool call — accept either shape.
      if (!apply(r.toolCallArgs) && !apply(extractJson(r.content))) {
        lastError = "model returned no structured output";
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      console.error("AI classify error (tool mode)", e);
    }

    if (!reasoning) {
      // Attempt 2 — plain JSON mode, no tools.
      try {
        const r2 = await generateOnce({
          purpose: "review_reply",
          branchId: row.branch_id ?? null,
          userMessage: userPrompt,
          systemOverride: sysOverride,
          responseFormat: "json",
          // Reasoning models spend part of the budget on internal thinking;
          // a small cap returns an EMPTY content string. Give it headroom.
          maxTokens: 1500,
        });
        if (!apply((r2 as any).json) && !apply(extractJson(r2.content))) {
          lastError = lastError || "model returned unparseable JSON";
        }

      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        console.error("AI classify error (json mode)", e);
      }
    }

    draft = sanitizeReply(draft);

    // Attempt 3 — the reply is the deliverable, so never leave it empty or
    // full of corporate filler. Ask once more for the reply text only.
    if (violatesStyle(draft)) {
      try {
        const r3 = await generateOnce({
          purpose: "review_reply",
          branchId: row.branch_id ?? null,
          userMessage: `${userPrompt}\n\nWrite ONLY the reply text (no JSON, no quotes). 2-4 short sentences, specific to this review, no banned corporate phrases.`,
          systemOverride: sysOverride,
          maxTokens: 800,
        });
        const retry = sanitizeReply(r3.content ?? "");
        if (retry && !violatesStyle(retry)) draft = retry;
        else if (retry && !draft) draft = retry;
      } catch (e) {
        console.error("AI draft retry failed", e);
        lastError = lastError || (e instanceof Error ? e.message : String(e));
      }
    }

    if (!reasoning) {
      reasoning = `AI unavailable — ${lastError || "unknown error"}. Classification defaulted to heuristic.`;
    }
  }

  if (opts.draftOnly) {
    if (!draft) return { ok: false, reason: "no_draft" };
    await sb
      .from("google_reviews_inbound")
      .update({ ai_draft_reply: draft })
      .eq("id", inbound_id);
    return { ok: true, draft };
  }

  await sb
    .from("google_reviews_inbound")
    .update({
      match_type: match.match_type,
      matched_member_id: (match as any).matched_member_id ?? null,
      matched_lead_id: (match as any).matched_lead_id ?? null,
      match_confidence: (match as any).match_confidence ?? null,
      match_evidence: match.evidence,
      ai_classification: classification,
      ai_reasoning: reasoning,
      ai_draft_reply: draft,
      ai_classified_at: new Date().toISOString(),
    })
    .eq("id", inbound_id);

  // Auto-create recovery task if unhappy_member
  if (classification === "unhappy_member" && match.match_type === "member") {
    await sb.from("tasks").insert({
      branch_id: row.branch_id,
      title: `Recover unhappy member from Google review (${row.rating}★)`,
      description: `${row.author_name} left a ${row.rating}★ review: "${(row.review_text ?? "").slice(0, 200)}"`,
      priority: "high",
      status: "pending",
      linked_entity_type: "google_review",
      linked_entity_id: inbound_id,
    });
  }

  return { ok: true, classification, draft };
}

// ─── Action: reply ───
async function replyToReview(inbound_id: string, reply_text: string, user_id?: string) {
  const sb = supa();
  const { data: row } = await sb
    .from("google_reviews_inbound")
    .select("id, branch_id, google_review_id, raw, source, gbp_review_name")
    .eq("id", inbound_id)
    .maybeSingle();
  if (!row) return json({ ok: false, error: "not_found" }, 404);
  const cfg = await getGoogleConfig(row.branch_id);
  if (!cfg) return json({ ok: false, error: "Google Business Profile is not configured for this branch." }, 412);
  if (!cfg.refresh_token) {
    return json({
      ok: false,
      code: "not_connected",
      error: "Replies need Business Profile access. Connect the Google account (Step 2) and fetch reviews again.",
    }, 412);
  }
  // Prefer the stored Business Profile review name; Places rows have none.
  const reviewName =
    row.gbp_review_name ??
    (row.raw as any)?.name ??
    (row.source === "places"
      ? null
      : `accounts/${cfg.account_id}/locations/${cfg.location_id}/reviews/${row.google_review_id}`);
  if (!reviewName) {
    return json({
      ok: false,
      code: "places_only",
      error:
        "This review was read from the public Places lane, which has no reply endpoint. Run \"Fetch now\" after connecting Business Profile — the review will be re-imported as replyable and your draft is kept.",
    }, 409);
  }
  const token = await refreshAccessToken(row.branch_id, cfg);
  if (!token) {
    return json({ ok: false, code: "token_refresh_failed", error: "Could not refresh the Google access token. Reconnect the Google account." }, 412);
  }
  const url = `https://mybusiness.googleapis.com/v4/${reviewName}/reply`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ comment: reply_text }),
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error("reply failed", res.status, txt.slice(0, 300));
    // Keep the draft so the operator never loses the text they wrote.
    await sb.from("google_reviews_inbound").update({ draft_reply: reply_text }).eq("id", inbound_id);
    return json({
      ok: false,
      code: `google_${res.status}`,
      status: res.status,
      error: friendlyGoogleError(res.status, txt),
      details: txt.slice(0, 400),
    }, 502);
  }
  await sb
    .from("google_reviews_inbound")
    .update({
      reply_status: "sent",
      reply_mode: "api",
      reply_text,
      draft_reply: null,
      replied_at: new Date().toISOString(),

      replied_by: user_id ?? null,
      google_reply_text: reply_text,
      google_reply_updated_at: new Date().toISOString(),
    })
    .eq("id", inbound_id);
  return json({ ok: true });
}

/** Persist an unsent draft so it survives refresh and the Google connect flow. */
async function saveDraft(inbound_id: string, draft: string) {
  const sb = supa();
  const { error } = await sb
    .from("google_reviews_inbound")
    .update({ draft_reply: draft || null })
    .eq("id", inbound_id);
  if (error) return json({ ok: false, error: error.message }, 500);
  return json({ ok: true });
}

/**
 * Assisted reply: while Business Profile quota is pending, staff copy the draft,
 * post it on Google themselves, then mark the row as handled here so the queue
 * stays honest. Recorded as `reply_mode = 'manual_google'` — never as an API post.
 */
async function markRepliedExternally(inbound_id: string, reply_text: string, user_id?: string) {
  const sb = supa();
  const { error } = await sb
    .from("google_reviews_inbound")
    .update({
      reply_status: "sent",
      reply_mode: "manual_google",
      reply_text: reply_text || null,
      draft_reply: null,
      replied_at: new Date().toISOString(),
      replied_by: user_id ?? null,
    })
    .eq("id", inbound_id);
  if (error) return json({ ok: false, error: error.message }, 500);
  return json({ ok: true, mode: "manual_google" });
}




// ─── Action: request_member_review (legacy compatibility) ───
async function requestMemberReview(feedback_id: string, channel?: string) {
  const sb = supa();
  const { data: fb } = await sb
    .from("feedback")
    .select("id, rating, branch_id, member_id")
    .eq("id", feedback_id)
    .maybeSingle();
  if (!fb) return json({ error: "feedback not found" }, 404);
  if (fb.rating == null || fb.rating < 4) return json({ error: "Google reviews only for 4-5★ feedback" }, 422);

  const { data: branch } = await sb
    .from("branches")
    .select("id, name, google_review_link")
    .eq("id", fb.branch_id)
    .maybeSingle();
  if (!branch?.google_review_link)
    return json({ error: "This branch has no Google review link configured. Add it under Settings → Branches → Google Reviews." }, 412);

  let memberPhone: string | null = null;
  let memberEmail: string | null = null;
  let memberName: string | null = null;
  if (fb.member_id) {
    const { data: m } = await sb
      .from("members")
      .select("user_id, profiles!members_user_id_fkey(phone, email, full_name)")
      .eq("id", fb.member_id)
      .maybeSingle();
    const p = (m as any)?.profiles;
    memberPhone = p?.phone ?? null;
    memberEmail = p?.email ?? null;
    memberName = p?.full_name ?? null;
  }

  const ch = (channel as any) ?? (memberPhone ? "whatsapp" : memberEmail ? "email" : "in_app");
  const recipient = ch === "email" ? memberEmail : ch === "in_app" ? (fb.member_id ?? "") : memberPhone;
  if (!recipient) return json({ error: `No recipient for channel ${ch}` }, 412);

  const link = `${SUPABASE_URL}/functions/v1/google-review-redirect?f=${fb.id}`;
  const message =
    `Hi ${memberName ?? "there"}, thank you for training with us at ${branch.name}. ` +
    `If your experience has been good so far, would you mind sharing a few honest words on Google? ` +
    `It genuinely helps our small team grow: ${link} ` +
    `And if anything fell short, please reply here — we would rather fix it first.`;

  const dispatchRes = await sb.functions.invoke("dispatch-communication", {
    body: {
      branch_id: branch.id,
      channel: ch,
      category: "review_request",
      recipient,
      member_id: fb.member_id,
      payload: {
        subject: `A small favour, ${memberName ?? "there"}?`,
        body: message,
        variables: {
          // Lets the dispatcher resolve the approved review template instead of
          // falling back to a plain-text send (blocked outside the 24h window).
          event_key: "review_request",
          member_name: memberName ?? "there",
          branch_name: branch.name,
          rating: fb.rating,
          review_link: link,
          link,
        },
      },

      dedupe_key: `greview:${fb.id}:${ch}`,
      ttl_seconds: 7 * 24 * 3600,
    },
  });
  if (dispatchRes.error) return json({ error: dispatchRes.error.message }, 500);
  const result = dispatchRes.data as { status: string; log_id?: string; reason?: string };
  const trackingStatus =
    result.status === "sent" ? "sent" :
    result.status === "queued" ? "queued" :
    result.status === "deduped" ? "sent" :
    result.status === "suppressed" ? "suppressed" : "failed";
  await sb
    .from("feedback")
    .update({
      google_review_request_status: trackingStatus,
      google_review_request_channel: ch,
      google_review_requested_at: new Date().toISOString(),
      google_review_request_message_id: result.log_id ?? null,
    })
    .eq("id", fb.id);
  return json({
    ok: result.status === "sent" || result.status === "queued" || result.status === "deduped",
    status: result.status,
    reason: result.reason,
    channel: ch,
    link,
    log_id: result.log_id,
  });
}

// ─── Router ───
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const requestUrl = new URL(req.url);
    if (req.method === "GET" && (requestUrl.searchParams.has("code") || requestUrl.searchParams.has("error"))) {
      return await handleGoogleOAuthCallback(requestUrl);
    }

    const body = (await req.json()) as Body;
    const action = body.action;
    if (!action) return json({ error: "action required" }, 400);

    // Optional caller user id (for replied_by stamp)
    let userId: string | undefined;
    const auth = req.headers.get("Authorization");
    if (auth?.startsWith("Bearer ")) {
      try {
        const sb = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
          global: { headers: { Authorization: auth } },
        });
        const { data: { user } } = await sb.auth.getUser();
        userId = user?.id;
      } catch { /* ignore */ }
    }

    switch (action) {
      case "test_connection":
        if (!body.branch_id) return json({ error: "branch_id required" }, 400);
        return await testConnection(body.branch_id);
      case "oauth_start":
        if (!body.branch_id) return json({ error: "branch_id required" }, 400);
        return await startGoogleOAuth(body.branch_id);
      case "list_accounts":
      case "list_locations":
        return json({ ok: false, reason: "Legacy Business Profile discovery was removed. Link the branch with “Find my listing” (Places API) instead." }, 200);
      case "fetch_reviews":
        return await fetchReviews(body.branch_id);
      case "fetch_reviews_places":
        if (!body.branch_id) return json({ error: "branch_id required" }, 400);
        return json(await fetchPlacesReviewsForBranch(body.branch_id));
      case "search_places": {
        if (!body.query || body.query.trim().length < 3)
          return json({ ok: false, reason: "Type at least 3 characters to search." }, 200);
        return await searchPlaces(body.branch_id, body.query.trim());
      }
      case "diagnose": {
        if (!body.branch_id) return json({ error: "branch_id required" }, 400);
        const cfg = await getGoogleConfig(body.branch_id);
        const placesKey = await resolvePlacesKey(body.branch_id);
        const checks: Array<{ key: string; ok: boolean; lane: "places" | "business_profile"; label: string; hint?: string }> = [];

        // ── Lane A: Places (works without Google approval) ──
        checks.push({
          key: "places_key",
          lane: "places",
          ok: !!placesKey,
          label: "Places API key available",
          hint: placesKey ? undefined : "Paste a Google Places API (New) key in Step 1, or link the Google Maps connector.",
        });
        const places = placesKey ? await fetchPlacesReviewsForBranch(body.branch_id) : null;
        checks.push({
          key: "place_id",
          lane: "places",
          ok: !!(places as any)?.place_id,
          label: "Google listing matched",
          hint: (places as any)?.place_id ? undefined : "Use “Find my listing” to pick this branch's Google place.",
        });
        checks.push({
          key: "places_fetch",
          lane: "places",
          ok: !!places && !(places as any).reason,
          label: "Live reviews readable (Places)",
          hint: (places as any)?.detail ?? ((places as any)?.reason ? `Places unavailable: ${(places as any).reason}` : undefined),
        });

        // ── Lane B: Business Profile (reply posting, full history) ──
        checks.push({
          key: "oauth_app",
          lane: "business_profile",
          ok: !!(cfg?.client_id && cfg?.client_secret),
          label: "OAuth client saved",
          hint: "Add the Google Cloud Web application Client ID and Secret in Step 2.",
        });
        checks.push({
          key: "connected",
          lane: "business_profile",
          ok: !!cfg?.refresh_token,
          label: "Google account connected",
          hint: "Click Connect Google and grant access to your Business Profile.",
        });
        checks.push({
          key: "location",
          lane: "business_profile",
          ok: !!(cfg?.account_id && cfg?.location_id),
          label: "Business location selected",
          hint: "Only needed to post replies via the API. Reading reviews already works through Places.",
        });
        let gbp: { ok: boolean; status?: number; error?: string } = { ok: false };
        if (cfg?.account_id && cfg?.location_id) {
          const token = await refreshAccessToken(body.branch_id, cfg);
          if (!token) gbp = { ok: false, error: "Could not refresh the Google access token. Reconnect the account." };
          else {
            const r = await fetch(
              `https://mybusiness.googleapis.com/v4/accounts/${cfg.account_id}/locations/${cfg.location_id}/reviews?pageSize=1`,
              { headers: { Authorization: `Bearer ${token}` } },
            );
            gbp = r.ok
              ? { ok: true, status: r.status }
              : { ok: false, status: r.status, error: friendlyGoogleError(r.status, await r.text()) };
          }
        }
        checks.push({
          key: "gbp_api",
          lane: "business_profile",
          ok: gbp.ok,
          label: "Business Profile reviews API reachable",
          hint: gbp.error,
        });

        const placesOk = checks.filter((c) => c.lane === "places").every((c) => c.ok);
        const gbpOk = checks.filter((c) => c.lane === "business_profile").every((c) => c.ok);
        return json({ ok: placesOk || gbpOk, places_ok: placesOk, gbp_ok: gbpOk, checks, gbp, places });
      }

      case "mark_replied_externally": {
        if (!body.inbound_id) return json({ error: "inbound_id required" }, 400);
        return await markRepliedExternally(body.inbound_id, body.reply_text ?? "", userId);
      }


      case "classify": {
        if (!body.inbound_id) return json({ error: "inbound_id required" }, 400);
        const r = await classifyOne(body.inbound_id);
        return json(r);
      }
      case "draft_reply": {
        if (!body.inbound_id) return json({ error: "inbound_id required" }, 400);
        const r = await classifyOne(body.inbound_id, {
          tone: body.tone,
          draftOnly: true,
        });
        return json(r);
      }
      case "save_draft":
        if (!body.inbound_id) return json({ error: "inbound_id required" }, 400);
        return await saveDraft(body.inbound_id, body.draft ?? "");
      case "reply":
        if (!body.inbound_id || !body.reply_text)
          return json({ error: "inbound_id and reply_text required" }, 400);
        return await replyToReview(body.inbound_id, body.reply_text, userId);
      case "request_member_review":
        if (!body.feedback_id) return json({ error: "feedback_id required" }, 400);
        return await requestMemberReview(body.feedback_id, body.channel);
      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("google-reviews-brain error", err);
    const msg = err instanceof Error ? err.message : "unknown";
    return json({ error: msg }, 500);
  }
});
