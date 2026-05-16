// v2.5.0 — Personalization guard: auto-fix "Hi Sample" / "Hello Member" bodies by
//          replacing the literal name with {{1}}; reject MARKETING bodies with no
//          placeholder at all (fixes the wait_is_over_july "Hi Sample" regression).
// v2.4.0 — Auto-uploads sample header media (URL → Meta resumable-upload `h:...` handle)
//           so DOCUMENT/IMAGE/VIDEO templates can be approved without manual sample handles.
//           Falls back to text-only if upload fails (preserves v2.3.0 behavior).
// v2.3.0 — Adds `bulk_create` (array of template_data, per-row results) and `mark_stale`
// (flags whatsapp_templates rows whose meta_template_id is no longer present after a list sync).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { META_GRAPH_VERSION, META_API_BASE } from "../_shared/meta-config.ts";

/**
 * Upload a public sample asset to Meta via the resumable-upload API and return
 * an `h:...` handle suitable for `example.header_handle` on a template create.
 *
 * Meta requires: POST /{app-id}/uploads → returns upload session id →
 *                POST /{session-id} with file bytes + `Authorization: OAuth {token}` → returns `{ h }`.
 *
 * Returns null on any failure so the caller can fall back to text-only.
 */
async function uploadSampleAsHandle(opts: {
  accessToken: string;
  appId: string;
  sampleUrl: string;
  fallbackContentType: string;
}): Promise<string | null> {
  try {
    const fileRes = await fetch(opts.sampleUrl);
    if (!fileRes.ok) {
      console.warn(`[uploadSampleAsHandle] fetch ${opts.sampleUrl} → ${fileRes.status}`);
      return null;
    }
    const contentType = fileRes.headers.get("content-type") || opts.fallbackContentType;
    const bytes = new Uint8Array(await fileRes.arrayBuffer());
    if (bytes.byteLength < 256) return null;

    // 1) Start upload session.
    const startUrl = `${META_API_BASE}/${opts.appId}/uploads?file_name=sample&file_length=${bytes.byteLength}&file_type=${encodeURIComponent(contentType)}&access_token=${encodeURIComponent(opts.accessToken)}`;
    const startRes = await fetch(startUrl, { method: "POST" });
    const startData = await startRes.json().catch(() => ({}));
    if (!startRes.ok || !startData?.id) {
      console.warn("[uploadSampleAsHandle] start failed:", JSON.stringify(startData));
      return null;
    }
    const sessionId: string = startData.id;

    // 2) Upload file body.
    const uploadRes = await fetch(`${META_API_BASE}/${sessionId}`, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${opts.accessToken}`,
        file_offset: "0",
        "Content-Type": contentType,
      },
      body: bytes,
    });
    const uploadData = await uploadRes.json().catch(() => ({}));
    if (!uploadRes.ok || !uploadData?.h) {
      console.warn("[uploadSampleAsHandle] upload failed:", JSON.stringify(uploadData));
      return null;
    }
    return uploadData.h as string;
  } catch (e) {
    console.warn("[uploadSampleAsHandle] exception:", (e as Error).message);
    return null;
  }
}
const serve = Deno.serve;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function computeAppSecretProof(accessToken: string, appSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(accessToken));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function appendProof(url: string, proof: string | null): string {
  if (!proof) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}appsecret_proof=${proof}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller identity via JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized — invalid or expired session" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { action, branch_id, template_id, template_data } = body;

    if (!action || !branch_id) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: action, branch_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(branch_id)) {
      return new Response(
        JSON.stringify({ error: "Invalid branch_id format — must be a UUID" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify role access
    const { data: userRoles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .in("role", ["owner", "admin", "manager"])
      .limit(1);

    const hasAllowedRole = Array.isArray(userRoles) && userRoles.length > 0;
    if (!hasAllowedRole) {
      return new Response(
        JSON.stringify({ error: "Forbidden — only owners, admins, and managers can manage Meta templates" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch WhatsApp integration settings
    let activeIntegration: any = null;
    const { data: branchIntegration } = await supabase
      .from("integration_settings")
      .select("config, credentials, is_active")
      .eq("branch_id", branch_id)
      .eq("integration_type", "whatsapp")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (branchIntegration) {
      activeIntegration = branchIntegration;
    } else {
      const { data: globalIntegration } = await supabase
        .from("integration_settings")
        .select("config, credentials, is_active")
        .is("branch_id", null)
        .eq("integration_type", "whatsapp")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      activeIntegration = globalIntegration;
    }

    if (!activeIntegration) {
      return new Response(
        JSON.stringify({ error: "WhatsApp integration not configured or inactive for this branch" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accessToken = activeIntegration.credentials?.access_token;
    const wabaId = activeIntegration.config?.business_account_id;
    const appSecret = activeIntegration.credentials?.app_secret || null;

    if (!accessToken || !wabaId) {
      return new Response(
        JSON.stringify({ error: "Missing access_token or business_account_id in WhatsApp configuration" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Compute appsecret_proof if app_secret is configured
    let proof: string | null = null;
    if (appSecret) {
      proof = await computeAppSecretProof(accessToken, appSecret);
    }

    // ── ACTION: list ──
    if (action === "list") {
      const listUrl = appendProof(
        `${META_API_BASE}/${wabaId}/message_templates?fields=id,name,status,category,language,rejected_reason,quality_score,components&limit=100`,
        proof
      );

      let metaRes: Response;
      let metaData: any;
      try {
        metaRes = await fetch(listUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        metaData = await metaRes.json();
      } catch (fetchErr) {
        const errMsg = fetchErr instanceof Error ? fetchErr.message : "Network error";
        await logError(supabase, branch_id, "manage-whatsapp-templates", "Meta API fetch error", errMsg);
        return new Response(
          JSON.stringify({ error: "Failed to reach Meta API", details: errMsg }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!metaRes.ok) {
        const me = metaData?.error || {};
        const errMsg = me.error_user_msg || me.message || "Failed to list templates from Meta";
        console.error("Meta list templates error:", JSON.stringify(metaData));
        await logError(supabase, branch_id, "manage-whatsapp-templates", `Meta API ${metaRes.status}`, errMsg);
        return new Response(
          JSON.stringify({
            success: false,
            error: errMsg,
            meta_error: {
              message: me.message || null,
              user_title: me.error_user_title || null,
              user_msg: me.error_user_msg || null,
              code: me.code ?? null,
              subcode: me.error_subcode ?? null,
              fbtrace_id: me.fbtrace_id || null,
              type: me.type || null,
            },
            upstream_status: metaRes.status,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const templates = metaData.data || [];
      const liveIds = new Set<string>(templates.map((t: any) => t.id));

      // Mark any locally cached row whose Meta ID is no longer returned as stale.
      try {
        const { data: existingLocal } = await supabase
          .from("whatsapp_templates")
          .select("id, meta_template_id")
          .eq("waba_id", wabaId);
        const staleIds = (existingLocal || [])
          .filter((r: any) => r.meta_template_id && !liveIds.has(r.meta_template_id))
          .map((r: any) => r.id);
        if (staleIds.length > 0) {
          await supabase.from("whatsapp_templates").update({ is_stale: true }).in("id", staleIds);
        }
        const liveLocalIds = (existingLocal || [])
          .filter((r: any) => r.meta_template_id && liveIds.has(r.meta_template_id))
          .map((r: any) => r.id);
        if (liveLocalIds.length > 0) {
          await supabase.from("whatsapp_templates").update({ is_stale: false }).in("id", liveLocalIds);
        }
      } catch (e) {
        console.warn("stale flag update failed:", e);
      }

      // Upsert into whatsapp_templates table
      for (const mt of templates) {
        await supabase
          .from("whatsapp_templates")
          .upsert(
            {
              waba_id: wabaId,
              branch_id: branch_id,
              meta_template_id: mt.id,
              name: mt.name,
              language: mt.language || "en",
              category: mt.category,
              status: mt.status,
              quality_score: mt.quality_score?.score || mt.quality_score || null,
              rejected_reason: mt.rejected_reason || null,
              components: mt.components || null,
              synced_at: new Date().toISOString(),
            },
            { onConflict: "waba_id,name,language" }
          );
      }

      // Mirror Meta status into legacy `templates`. UPDATE existing rows; if no
      // row matches `meta_template_name`, INSERT a stub so the Campaign Wizard
      // picker (which queries `templates`) sees every approved Meta template.
      for (const mt of templates) {
        const bodyText = (mt.components || []).find((c: any) => c?.type === 'BODY')?.text || '';
        const headerComp = (mt.components || []).find((c: any) => c?.type === 'HEADER');
        const headerType = (headerComp?.format || 'NONE').toLowerCase();

        const { data: updated } = await supabase
          .from('templates')
          .update({
            meta_template_status: mt.status,
            meta_rejection_reason: mt.rejected_reason || null,
          })
          .eq('meta_template_name', mt.name)
          .select('id');

        if (!updated || updated.length === 0) {
          await supabase.from('templates').insert({
            branch_id,
            type: 'whatsapp',
            name: mt.name,
            content: bodyText,
            meta_template_name: mt.name,
            meta_template_status: mt.status,
            meta_rejection_reason: mt.rejected_reason || null,
            header_type: headerType,
            is_active: true,
          });
        }
      }

      return new Response(
        JSON.stringify({ templates }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── ACTION: create ──
    if (action === "create") {
      if (!template_data) {
        return new Response(
          JSON.stringify({ error: "Missing template_data for create action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { name, category, language, body_text, local_template_id, header_type, header_sample_url } = template_data;

      if (!name || !category || !language || !body_text) {
        return new Response(
          JSON.stringify({ error: "Missing required template_data fields: name, category, language, body_text" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const safeName = name.toLowerCase().replace(/[\s\-]+/g, "_").replace(/[^a-z0-9_]/g, "");

      // ── Personalization guard ─────────────────────────────────────────────
      // Reject (or auto-fix) bodies that hard-code an example name like
      // "Hi Sample 👋", "Hello friend", "Dear Member" without a {{}} placeholder.
      // This is the regression that produced the public `wait_is_over_july`
      // template which sends "Hi Sample" to every recipient.
      let workingBody: string = String(body_text);
      const hasAnyPlaceholder = /\{\{\s*[a-zA-Z0-9_]+\s*\}\}/.test(workingBody);
      if (!hasAnyPlaceholder) {
        // Look for greeting + literal name pattern at the start
        const greetMatch = workingBody.match(/^(\s*)(Hi|Hello|Hey|Dear|Hola|Namaste)\s+([A-Z][a-zA-Z]{1,20})(\b[^\n]{0,3})/);
        if (greetMatch) {
          // Replace the literal name with {{1}}
          workingBody = workingBody.replace(greetMatch[0], `${greetMatch[1]}${greetMatch[2]} {{1}}${greetMatch[4] || ''}`);
          console.log(`[manage-whatsapp-templates] auto-fixed personalization: "${greetMatch[0].trim()}" → "${greetMatch[2]} {{1}}"`);
        } else if (String(category).toUpperCase() === 'MARKETING') {
          // For marketing templates, refuse silent static-body sends — every recipient
          // would otherwise get the literal example value at scale.
          return new Response(
            JSON.stringify({
              error: "Template body has no personalization placeholder ({{1}}). " +
                     "Add a name variable (e.g. 'Hi {{1}}') so each recipient sees their own name. " +
                     "Static-body marketing templates trigger 'Hi Sample' style bugs.",
            }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // Auto-convert named variables like {{member_name}} to numbered {{1}}, {{2}}, etc.
      let convertedBody = workingBody;
      const namedVarRegex = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
      const namedVars: string[] = [];
      let match;
      while ((match = namedVarRegex.exec(workingBody)) !== null) {
        if (!namedVars.includes(match[1])) {
          namedVars.push(match[1]);
        }
      }
      // Replace named vars with numbered ones
      namedVars.forEach((varName, index) => {
        convertedBody = convertedBody.replace(
          new RegExp(`\\{\\{${varName}\\}\\}`, "g"),
          `{{${index + 1}}}`
        );
      });

      // Build BODY component with example values for Meta approval
      const bodyComponent: any = { type: "BODY", text: convertedBody };
      
      // Generate example values based on variable names
      const exampleMap: Record<string, string> = {
        member_name: "Rahul", name: "Rahul", trainer_name: "Coach Arjun",
        plan_name: "Annual Premium", end_date: "31-Dec-2026", start_date: "01-Jan-2026",
        member_code: "INC-00123", amount: "5000", invoice_number: "INV-INC-2604-0001",
        date: "11-Apr-2026", due_date: "18-Apr-2026", time: "10:00 AM",
        class_name: "Power Yoga", facility_name: "Sauna Room",
        start_time: "10:00 AM", end_time: "10:30 AM",
        freeze_start: "15-Apr-2026", freeze_end: "15-May-2026",
        new_end_date: "30-Jun-2026", package_name: "12 Sessions Pack",
        remaining_sessions: "4", expiry_date: "30-Jun-2026",
        current_offer: "20% off annual plans", offer_details: "Free month on annual plans",
        valid_till: "30-Apr-2026", gift_details: "Free PT session this month",
        referee_name: "Priya", reward_details: "₹500 wallet credit",
        days_absent: "7", reference_id: "REF-2604-001", payment_method: "UPI",
        reason: "Annual maintenance", closure_date: "01-May-2026", resume_date: "02-May-2026",
      };
      
      if (namedVars.length > 0) {
        const exampleValues = namedVars.map(v => exampleMap[v] || "Sample");
        bodyComponent.example = { body_text: [exampleValues] };
      } else {
        // Check for already-numbered vars like {{1}}, {{2}}
        const numberedVarRegex = /\{\{(\d+)\}\}/g;
        const numberedMatches: string[] = [];
        let nm;
        while ((nm = numberedVarRegex.exec(convertedBody)) !== null) {
          if (!numberedMatches.includes(nm[1])) numberedMatches.push(nm[1]);
        }
        if (numberedMatches.length > 0) {
          // Use template_data.variables if provided for example mapping
          const vars = template_data.variables || [];
          const exampleValues = numberedMatches.map((_, i) => {
            const varName = vars[i];
            return (varName && exampleMap[varName]) || "Sample";
          });
          bodyComponent.example = { body_text: [exampleValues] };
        }
      }

      // ── AUTHENTICATION category: Meta REQUIRES special structure ──
      // BODY must NOT have `text`; instead use `add_security_recommendation`.
      // Must also include FOOTER (code_expiration_minutes) and BUTTONS (OTP type).
      const isAuth = String(category).toUpperCase() === 'AUTHENTICATION';
      if (isAuth) {
        const authComponents: any[] = [
          { type: 'BODY', add_security_recommendation: true },
          { type: 'FOOTER', code_expiration_minutes: 10 },
          {
            type: 'BUTTONS',
            buttons: [
              { type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy Code' },
            ],
          },
        ];
        const authPayload = {
          name: safeName,
          category: 'AUTHENTICATION',
          language,
          message_send_ttl_seconds: 600,
          components: authComponents,
        };
        const authUrl = appendProof(`${META_API_BASE}/${wabaId}/message_templates`, proof);
        let authRes: Response;
        let authData: any;
        try {
          authRes = await fetch(authUrl, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(authPayload),
          });
          authData = await authRes.json();
        } catch (fetchErr) {
          const errMsg = fetchErr instanceof Error ? fetchErr.message : 'Network error';
          await logError(supabase, branch_id, 'manage-whatsapp-templates', 'Meta API auth create fetch error', errMsg);
          return new Response(JSON.stringify({ error: 'Failed to reach Meta API', details: errMsg }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        if (!authRes.ok) {
          const me = authData?.error || {};
          const userMsg = me.error_user_msg || me.message || 'Failed to create auth template';
          const userTitle = me.error_user_title || null;
          const errMsg = userTitle ? `${userTitle}: ${userMsg}` : userMsg;
          console.error('Meta create AUTH template error:', JSON.stringify(authData));
          await logError(supabase, branch_id, 'manage-whatsapp-templates', `Meta API auth create ${authRes.status}`, errMsg);
          if (local_template_id) {
            await supabase.from('templates').update({
              meta_template_name: safeName,
              meta_template_status: 'DRAFT',
              meta_rejection_reason: errMsg,
            }).eq('id', local_template_id);
          }
          return new Response(JSON.stringify({
            success: false, error: errMsg,
            meta_error: { message: me.message || null, user_title: userTitle, user_msg: userMsg, code: me.code ?? null, subcode: me.error_subcode ?? null, fbtrace_id: me.fbtrace_id || null, type: me.type || null },
            upstream_status: authRes.status, saved_as_draft: !!local_template_id,
          }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        if (local_template_id) {
          await supabase.from('templates').update({
            meta_template_name: safeName,
            meta_template_status: authData.status || 'PENDING',
            meta_rejection_reason: null,
          }).eq('id', local_template_id);
        }
        return new Response(JSON.stringify({ success: true, meta_template_id: authData.id, status: authData.status, name: safeName }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Optional HEADER component for media templates (image / video / document).
      // Meta REQUIRES `header_handle` to be a handle from the resumable
      // /uploads endpoint — a public URL (e.g. placehold.co) causes
      // "Missing sample parameter" 400. If we don't have a real handle yet,
      // coerce to header_type='none' and prepend the link into the body so
      // the dispatcher can substitute the real media at send-time.
      const components: any[] = [];
      const hasMediaHeader = header_type && ['image', 'video', 'document'].includes(header_type);
      const looksLikeMetaHandle = (s?: string) =>
        !!s && !/^https?:\/\//i.test(s) && s.length > 20;

      // Resolve the App ID needed for the resumable-upload API.
      const appId =
        (activeIntegration.credentials as any)?.app_id ||
        Deno.env.get("META_APP_ID") ||
        null;

      let resolvedHandle: string | null = null;
      if (hasMediaHeader && looksLikeMetaHandle(header_sample_url)) {
        resolvedHandle = header_sample_url;
      } else if (hasMediaHeader && header_sample_url && /^https?:\/\//i.test(header_sample_url) && appId) {
        // Auto-upload the public URL to Meta and use the returned handle.
        const fallbackType =
          header_type === 'image' ? 'image/jpeg' :
          header_type === 'video' ? 'video/mp4' : 'application/pdf';
        resolvedHandle = await uploadSampleAsHandle({
          accessToken,
          appId,
          sampleUrl: header_sample_url,
          fallbackContentType: fallbackType,
        });
        if (!resolvedHandle) {
          console.warn(
            `[manage-whatsapp-templates] sample upload failed for ${header_sample_url}; submitting as text-only.`
          );
        }
      }

      if (hasMediaHeader && resolvedHandle) {
        components.push({
          type: 'HEADER',
          format: header_type.toUpperCase(),
          example: { header_handle: [resolvedHandle] },
        });
      } else if (hasMediaHeader) {
        console.warn(
          `[manage-whatsapp-templates] header_type=${header_type} without Meta handle (appId=${appId ? 'set' : 'missing'}) — submitting as text-only template (sample URL: ${header_sample_url || 'none'})`
        );
      }
      components.push(bodyComponent);

      const metaPayload = {
        name: safeName,
        category,
        language,
        components,
      };

      const createUrl = appendProof(`${META_API_BASE}/${wabaId}/message_templates`, proof);

      let metaRes: Response;
      let metaData: any;
      try {
        metaRes = await fetch(createUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(metaPayload),
        });
        metaData = await metaRes.json();
      } catch (fetchErr) {
        const errMsg = fetchErr instanceof Error ? fetchErr.message : "Network error";
        await logError(supabase, branch_id, "manage-whatsapp-templates", "Meta API create fetch error", errMsg);
        return new Response(
          JSON.stringify({ error: "Failed to reach Meta API", details: errMsg }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!metaRes.ok) {
        const me = metaData?.error || {};
        const userMsg = me.error_user_msg || me.message || "Failed to create template in Meta";
        const userTitle = me.error_user_title || null;
        const errMsg = userTitle ? `${userTitle}: ${userMsg}` : userMsg;
        console.error("Meta create template error:", JSON.stringify(metaData));
        await logError(supabase, branch_id, "manage-whatsapp-templates", `Meta API create ${metaRes.status}`, errMsg);
        // Persist as DRAFT so the user can edit & retry without losing the proposal.
        if (local_template_id) {
          await supabase.from('templates').update({
            meta_template_name: safeName,
            meta_template_status: 'DRAFT',
            meta_rejection_reason: errMsg,
          }).eq('id', local_template_id);
        }
        // Return 200 so supabase-js does NOT wrap as FunctionsHttpError and swallow body.
        // Client must inspect `success:false` + `meta_error`.
        return new Response(
          JSON.stringify({
            success: false,
            error: errMsg,
            meta_error: {
              message: me.message || null,
              user_title: userTitle,
              user_msg: userMsg,
              code: me.code ?? null,
              subcode: me.error_subcode ?? null,
              fbtrace_id: me.fbtrace_id || null,
              type: me.type || null,
            },
            upstream_status: metaRes.status,
            saved_as_draft: !!local_template_id,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (local_template_id) {
        const { data: targetTemplate } = await supabase
          .from("templates")
          .select("id, branch_id")
          .eq("id", local_template_id)
          .maybeSingle();

        if (targetTemplate) {
          if (targetTemplate.branch_id !== null && targetTemplate.branch_id !== branch_id) {
            return new Response(
              JSON.stringify({ error: "Forbidden — template does not belong to the requested branch" }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          await supabase
            .from("templates")
            .update({
              meta_template_name: safeName,
              meta_template_status: metaData.status || "PENDING",
              meta_rejection_reason: null,
            })
            .eq("id", local_template_id);
        }
      }

      return new Response(
        JSON.stringify({ success: true, meta_template_id: metaData.id, status: metaData.status, name: safeName }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── ACTION: edit ──
    // Resubmits an existing Meta template with edited body/category. Useful when a
    // template was REJECTED and we want to fix it without losing the slot.
    if (action === "edit") {
      const { meta_template_id, category, body_text, local_template_id } = template_data || {};
      if (!meta_template_id) {
        return new Response(
          JSON.stringify({ error: "Missing template_data.meta_template_id for edit action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!body_text && !category) {
        return new Response(
          JSON.stringify({ error: "Provide at least one of: body_text, category" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Convert {{name}} → {{1}} just like create
      let convertedBody: string | undefined = undefined;
      if (body_text) {
        convertedBody = body_text;
        const namedVarRegex = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
        const namedVars: string[] = [];
        let match;
        while ((match = namedVarRegex.exec(body_text)) !== null) {
          if (!namedVars.includes(match[1])) namedVars.push(match[1]);
        }
        namedVars.forEach((varName, index) => {
          convertedBody = convertedBody!.replace(
            new RegExp(`\\{\\{${varName}\\}\\}`, "g"),
            `{{${index + 1}}}`,
          );
        });
      }

      const editPayload: Record<string, unknown> = {};
      if (category) editPayload.category = category;
      if (convertedBody) {
        const bodyComponent: any = { type: "BODY", text: convertedBody };
        // Minimal example to satisfy Meta when variables are present
        const numbered = (convertedBody.match(/\{\{(\d+)\}\}/g) || []).length;
        if (numbered > 0) {
          bodyComponent.example = { body_text: [Array(numbered).fill("Sample")] };
        }
        editPayload.components = [bodyComponent];
      }

      const editUrl = appendProof(`${META_API_BASE}/${meta_template_id}`, proof);
      let metaRes: Response;
      let metaData: any;
      try {
        metaRes = await fetch(editUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(editPayload),
        });
        metaData = await metaRes.json();
      } catch (fetchErr) {
        const errMsg = fetchErr instanceof Error ? fetchErr.message : "Network error";
        await logError(supabase, branch_id, "manage-whatsapp-templates", "Meta API edit fetch error", errMsg);
        return new Response(
          JSON.stringify({ error: "Failed to reach Meta API", details: errMsg }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!metaRes.ok || metaData?.error) {
        const me = metaData?.error || {};
        const userMsg = me.error_user_msg || me.message || "Failed to edit template in Meta";
        const userTitle = me.error_user_title || null;
        const errMsg = userTitle ? `${userTitle}: ${userMsg}` : userMsg;
        await logError(supabase, branch_id, "manage-whatsapp-templates", `Meta API edit ${metaRes.status}`, errMsg);
        return new Response(
          JSON.stringify({
            success: false,
            error: errMsg,
            meta_error: {
              message: me.message || null,
              user_title: userTitle,
              user_msg: userMsg,
              code: me.code ?? null,
              subcode: me.error_subcode ?? null,
              fbtrace_id: me.fbtrace_id || null,
              type: me.type || null,
            },
            upstream_status: metaRes.status,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Mark local row as PENDING again
      if (local_template_id) {
        await supabase
          .from("templates")
          .update({
            meta_template_status: "PENDING",
            meta_rejection_reason: null,
            content: body_text || undefined,
          })
          .eq("id", local_template_id);
      }

      return new Response(
        JSON.stringify({ success: true, status: "PENDING", meta_response: metaData }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── ACTION: get_status ──
    if (action === "get_status") {
      if (!template_id) {
        return new Response(
          JSON.stringify({ error: "Missing template_id for get_status action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const statusUrl = appendProof(
        `${META_API_BASE}/${template_id}?fields=id,name,status,rejected_reason,category`,
        proof
      );

      let metaRes: Response;
      let metaData: any;
      try {
        metaRes = await fetch(statusUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        metaData = await metaRes.json();
      } catch (fetchErr) {
        const errMsg = fetchErr instanceof Error ? fetchErr.message : "Network error";
        await logError(supabase, branch_id, "manage-whatsapp-templates", "Meta API status fetch error", errMsg);
        return new Response(
          JSON.stringify({ error: "Failed to reach Meta API", details: errMsg }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!metaRes.ok) {
        const errMsg = metaData?.error?.message || "Failed to get template status from Meta";
        console.error("Meta get_status error:", JSON.stringify(metaData));
        await logError(supabase, branch_id, "manage-whatsapp-templates", `Meta API status ${metaRes.status}`, errMsg);
        return new Response(
          JSON.stringify({ error: errMsg }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await supabase
        .from("templates")
        .update({
          meta_template_status: metaData.status,
          meta_rejection_reason: metaData.rejected_reason || null,
        })
        .eq("meta_template_name", metaData.name)
        .not("meta_template_name", "is", null)
        .or(`branch_id.eq.${branch_id},branch_id.is.null`);

      return new Response(
        JSON.stringify({
          id: metaData.id,
          name: metaData.name,
          status: metaData.status,
          rejected_reason: metaData.rejected_reason || null,
          category: metaData.category,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── ACTION: sync_ig_icebreakers ──
    if (action === "sync_ig_icebreakers") {
      const igAccountId = activeIntegration.config?.ig_account_id;
      if (!igAccountId) {
        return new Response(
          JSON.stringify({ error: "Instagram account ID not configured. Add ig_account_id to WhatsApp integration config." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const igUrl = appendProof(`${META_API_BASE}/${igAccountId}/ice_breakers`, proof);
      try {
        const resp = await fetch(igUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
        const data = await resp.json();
        if (!resp.ok) {
          return new Response(JSON.stringify({ error: data?.error?.message || "Failed to fetch IG ice breakers" }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ ice_breakers: data.data || [] }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: `IG API error: ${(e as Error).message}` }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── ACTION: sync_messenger_quick_replies ──
    if (action === "sync_messenger_quick_replies") {
      const pageId = activeIntegration.config?.page_id;
      if (!pageId) {
        return new Response(
          JSON.stringify({ error: "Facebook Page ID not configured. Add page_id to WhatsApp integration config." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const msgUrl = appendProof(`${META_API_BASE}/${pageId}/messenger_profile?fields=persistent_menu,ice_breakers,get_started`, proof);
      try {
        const resp = await fetch(msgUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
        const data = await resp.json();
        if (!resp.ok) {
          return new Response(JSON.stringify({ error: data?.error?.message || "Failed to fetch Messenger profile" }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ messenger_profile: data.data || data }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: `Messenger API error: ${(e as Error).message}` }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── ACTION: bulk_delete_local ──
    // Deletes local cached rows only; Meta-side deletion must be done in Business Manager.
    if (action === "bulk_delete_local") {
      const ids: string[] = body.ids || [];
      if (!Array.isArray(ids) || ids.length === 0) {
        return new Response(JSON.stringify({ error: "Missing ids[]" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { error: e1 } = await supabase.from("whatsapp_templates").delete().in("id", ids);
      // Also clear meta_* metadata on legacy templates rows so they appear unsynced again.
      await supabase.from("templates").update({
        meta_template_name: null, meta_template_id: null, meta_template_status: null, meta_rejection_reason: null,
      }).in("id", ids);
      return new Response(JSON.stringify({ success: !e1, error: e1?.message || null }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}. Valid: list | create | edit | get_status | bulk_delete_local | sync_ig_icebreakers | sync_messenger_quick_replies` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("manage-whatsapp-templates error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function logError(supabase: any, branchId: string, component: string, title: string, details: string) {
  try {
    await supabase.from("error_logs").insert({
      source: "edge_function",
      component_name: component,
      error_message: `${title}: ${details}`,
      branch_id: branchId,
    });
  } catch (e) {
    console.error("Failed to log error:", e);
  }
}
