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
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const APP_BASE = Deno.env.get("APP_BASE_URL") || "https://incline.lovable.app";
const GOOGLE_OAUTH_REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-reviews-brain`;

type Action =
  | "test_connection"
  | "oauth_start"
  | "list_accounts"
  | "list_locations"
  | "fetch_reviews"
  | "classify"
  | "reply"
  | "request_member_review";

interface Body {
  action: Action;
  branch_id?: string;
  account_id?: string; // for list_locations
  inbound_id?: string;
  reply_text?: string;
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
    auto_fetch: cfg.auto_fetch_reviews === "true",
    client_id: cred.client_id,
    client_secret: cred.client_secret,
    api_key: cred.api_key,
    access_token: cred.access_token,
    refresh_token: cred.refresh_token,
    token_expires_at: cred.token_expires_at,
  };
}

function googleCredentialsForPersist(cfg: any, updates: Record<string, unknown>) {
  const base: Record<string, unknown> = {};
  for (const key of ["client_id", "client_secret", "api_key", "access_token", "refresh_token", "token_expires_at", "scope"]) {
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

// ─── Action: test_connection ───
async function testConnection(branch_id: string) {
  const cfg = await getGoogleConfig(branch_id);
  if (!cfg) return json({ ok: false, reason: "Google Business integration not configured for this branch" }, 200);
  if (!cfg.account_id || !cfg.location_id)
    return json({ ok: false, reason: "Missing account_id or location_id" }, 200);
  const token = await refreshAccessToken(branch_id, cfg);
  if (!token) return json({ ok: false, reason: "Could not obtain access token. Check OAuth credentials." }, 200);
  const url = `https://mybusiness.googleapis.com/v4/accounts/${cfg.account_id}/locations/${cfg.location_id}/reviews?pageSize=1`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const txt = await res.text();
    return json({ ok: false, reason: `Google API ${res.status}: ${txt.slice(0, 200)}` }, 200);
  }
  return json({ ok: true });
}

// ─── Action: list_accounts ───
function friendlyGoogleError(status: number, txt: string): string {
  if (status === 401) return "Re-connect Google to refresh permissions (token rejected).";
  if (status === 403) {
    if (/SERVICE_DISABLED|has not been used|API has not/i.test(txt))
      return "Enable 'My Business Account Management API' and 'My Business Business Information API' in Google Cloud Console for this project.";
    return "Permission denied by Google. Confirm this Google account manages the Business Profile.";
  }
  if (status === 404) return "No Business Profile accounts found for this Google login.";
  if (status === 429) return "Google rate limit hit — try again in a minute.";
  return `Google API ${status}: ${txt.slice(0, 200)}`;
}

async function listAccounts(branch_id: string) {
  const cfg = await getGoogleConfig(branch_id);
  if (!cfg) return json({ ok: false, reason: "Google Business integration not configured for this branch" }, 200);
  if (!cfg.refresh_token) return json({ ok: false, reason: "OAuth not connected. Connect Google first." }, 200);
  const token = await refreshAccessToken(branch_id, cfg);
  if (!token) return json({ ok: false, reason: "Could not obtain access token. Re-connect Google." }, 200);
  const res = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const txt = await res.text();
    return json({ ok: false, reason: friendlyGoogleError(res.status, txt) }, 200);
  }
  const j = await res.json();
  const items = ((j.accounts ?? []) as any[]).map((a) => ({
    account_id: String(a.name ?? "").replace(/^accounts\//, ""),
    name: a.accountName ?? a.name,
    type: a.type,
    role: a.role,
    verification_state: a.verificationState,
  })).filter((a) => a.account_id);
  return json({ ok: true, items });
}

// ─── Action: list_locations ───
async function listLocations(branch_id: string, account_id: string) {
  const cfg = await getGoogleConfig(branch_id);
  if (!cfg) return json({ ok: false, reason: "Google Business integration not configured for this branch" }, 200);
  if (!cfg.refresh_token) return json({ ok: false, reason: "OAuth not connected. Connect Google first." }, 200);
  const token = await refreshAccessToken(branch_id, cfg);
  if (!token) return json({ ok: false, reason: "Could not obtain access token. Re-connect Google." }, 200);
  const cleanAcc = account_id.replace(/^accounts\//, "");
  const url = `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${cleanAcc}/locations?readMask=name,title,storefrontAddress,storeCode,websiteUri&pageSize=100`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const txt = await res.text();
    return json({ ok: false, reason: friendlyGoogleError(res.status, txt) }, 200);
  }
  const j = await res.json();
  const items = ((j.locations ?? []) as any[]).map((l) => {
    const addr = l.storefrontAddress;
    const addrLine = addr ? [
      ...(addr.addressLines ?? []),
      addr.locality, addr.administrativeArea, addr.postalCode,
    ].filter(Boolean).join(", ") : "";
    return {
      location_id: String(l.name ?? "").replace(/^locations\//, ""),
      title: l.title,
      address: addrLine,
      store_code: l.storeCode,
      website: l.websiteUri,
    };
  }).filter((l) => l.location_id);
  return json({ ok: true, items });
}
async function fetchReviewsForBranch(branch_id: string) {
  const sb = supa();
  const cfg = await getGoogleConfig(branch_id);
  if (!cfg || !cfg.account_id || !cfg.location_id) return { branch_id, fetched: 0, reason: "not_configured" };
  const token = await refreshAccessToken(branch_id, cfg);
  if (!token) return { branch_id, fetched: 0, reason: "no_token" };

  const url = `https://mybusiness.googleapis.com/v4/accounts/${cfg.account_id}/locations/${cfg.location_id}/reviews?pageSize=50`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    console.error("fetch reviews failed", branch_id, res.status, await res.text());
    return { branch_id, fetched: 0, reason: `api_${res.status}` };
  }
  const body = await res.json();
  const reviews = (body.reviews ?? []) as any[];
  let inserted = 0;
  const newIds: string[] = [];
  for (const r of reviews) {
    const ratingMap: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
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
    if (up && (up.ai_classification === "pending" || !up.ai_classification)) {
      newIds.push(up.id);
      inserted++;
    }
  }
  // classify new ones inline (best effort)
  for (const id of newIds.slice(0, 10)) {
    try { await classifyOne(id); } catch (e) { console.error("classify err", id, e); }
  }
  return { branch_id, fetched: reviews.length, classified: newIds.length };
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

  // Members: members.user_id -> profiles.full_name (branch-scoped)
  const { data: branchMembers } = await sb
    .from("members")
    .select("id, user_id, joined_at, status, lifecycle_state, profiles!members_user_id_fkey(full_name)")
    .eq("branch_id", branch_id)
    .limit(2000);

  let bestMember: any = null;
  let bestScore = 0;
  const target = author_name.toLowerCase().trim();
  for (const m of (branchMembers ?? []) as any[]) {
    const name = (m.profiles?.full_name ?? "").toLowerCase().trim();
    if (!name) continue;
    const score = similarity(target, name);
    if (score > bestScore) {
      bestScore = score;
      bestMember = { ...m, _name: m.profiles?.full_name };
    }
  }
  if (bestScore >= 0.7 && bestMember) {
    return {
      match_type: "member",
      matched_member_id: bestMember.id,
      match_confidence: bestScore,
      evidence: {
        name: bestMember._name,
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
    const name = (l.full_name ?? "").toLowerCase().trim();
    if (!name) continue;
    const score = similarity(target, name);
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

// ─── Action: classify (one row) ───
async function classifyOne(inbound_id: string) {
  const sb = supa();
  const { data: row, error } = await sb
    .from("google_reviews_inbound")
    .select("*, branches(name)")
    .eq("id", inbound_id)
    .maybeSingle();
  if (error || !row) return { ok: false, reason: "not_found" };

  const match = await findAuthorMatch(row.branch_id, row.author_name);

  let classification = "genuine";
  let reasoning = "Default heuristic — no AI key.";
  let draft = "";
  if (LOVABLE_API_KEY) {
    try {
      const sys =
        "You are a gym customer-service AI helping owners triage Google reviews. " +
        "Classify the review as exactly one of: genuine, unhappy_member, suspected_fake, spam. " +
        "Then draft a polite, professional reply (≤500 chars). " +
        "Use the 'classify_review' tool. Never accuse the reviewer of being a competitor.";
      const userPrompt = JSON.stringify({
        branch_name: (row.branches as any)?.name ?? "our gym",
        rating: row.rating,
        review_text: row.review_text,
        author_name: row.author_name,
        match_type: match.match_type,
        match_evidence: match.evidence,
      });
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: sys },
            { role: "user", content: userPrompt },
          ],
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
          tool_choice: { type: "function", function: { name: "classify_review" } },
        }),
      });
      if (resp.ok) {
        const j = await resp.json();
        const args = j.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
        if (args) {
          const parsed = JSON.parse(args);
          classification = parsed.classification ?? classification;
          reasoning = parsed.reasoning ?? reasoning;
          draft = parsed.draft_reply ?? "";
        }
      } else {
        console.error("AI gateway error", resp.status, await resp.text());
      }
    } catch (e) {
      console.error("AI classify error", e);
    }
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

  return { ok: true, classification };
}

// ─── Action: reply ───
async function replyToReview(inbound_id: string, reply_text: string, user_id?: string) {
  const sb = supa();
  const { data: row } = await sb
    .from("google_reviews_inbound")
    .select("id, branch_id, google_review_id, raw")
    .eq("id", inbound_id)
    .maybeSingle();
  if (!row) return json({ ok: false, error: "not_found" }, 404);
  const cfg = await getGoogleConfig(row.branch_id);
  if (!cfg) return json({ ok: false, error: "Google Business not configured for branch" }, 412);
  const token = await refreshAccessToken(row.branch_id, cfg);
  if (!token) return json({ ok: false, error: "no_token" }, 412);
  // Google review name format: accounts/{account}/locations/{loc}/reviews/{id}
  const reviewName = (row.raw as any)?.name ?? `accounts/${cfg.account_id}/locations/${cfg.location_id}/reviews/${row.google_review_id}`;
  const url = `https://mybusiness.googleapis.com/v4/${reviewName}/reply`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ comment: reply_text }),
  });
  if (!res.ok) {
    const txt = await res.text();
    return json({ ok: false, error: `Google API ${res.status}: ${txt.slice(0, 300)}` }, 502);
  }
  await sb
    .from("google_reviews_inbound")
    .update({
      reply_status: "sent",
      reply_text,
      replied_at: new Date().toISOString(),
      replied_by: user_id ?? null,
      google_reply_text: reply_text,
      google_reply_updated_at: new Date().toISOString(),
    })
    .eq("id", inbound_id);
  return json({ ok: true });
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
  const message = `Hi ${memberName ?? "there"}, thanks for the ${fb.rating}★ feedback at ${branch.name}! If we earned it, would you mind sharing a quick Google review? It helps us a lot 🙏 ${link}`;

  const dispatchRes = await sb.functions.invoke("dispatch-communication", {
    body: {
      branch_id: branch.id,
      channel: ch,
      category: "review_request",
      recipient,
      member_id: fb.member_id,
      payload: {
        subject: `Quick favor — share your experience at ${branch.name}?`,
        body: message,
        variables: { branch_name: branch.name, rating: fb.rating, link },
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
        if (!body.branch_id) return json({ error: "branch_id required" }, 400);
        return await listAccounts(body.branch_id);
      case "list_locations":
        if (!body.branch_id) return json({ error: "branch_id required" }, 400);
        if (!body.account_id) return json({ error: "account_id required" }, 400);
        return await listLocations(body.branch_id, body.account_id);
      case "fetch_reviews":
        return await fetchReviews(body.branch_id);
      case "classify": {
        if (!body.inbound_id) return json({ error: "inbound_id required" }, 400);
        const r = await classifyOne(body.inbound_id);
        return json(r);
      }
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
