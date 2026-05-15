// v2.6.0 — native video message_type (server-uploads MP4 to Meta with video/mp4).
// v2.5.0 — harden IN phone normalization for Meta digits-only E.164 payloads.
// v2.4.0 — document/image media is fetched server-side and uploaded to Meta first;
//           this avoids signed storage URLs being re-fetched/rewritten by WhatsApp.
// v2.3.0 — document messages send link + filename + caption together so PDFs
//           arrive as named, captioned attachments instead of unnamed downloads.
// v2.2.0 — honor skip_log from dispatcher to avoid duplicate communication_logs rows.
import { captureEdgeError } from "../_shared/capture-edge-error.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { META_API_BASE } from "../_shared/meta-config.ts";
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

function buildMetaUrl(phoneNumberId: string, accessToken: string, appSecret?: string | null, proof?: string | null): string {
  let url = `${META_API_BASE}/${phoneNumberId}/messages`;
  if (appSecret && proof) {
    url += `?appsecret_proof=${proof}`;
  }
  return url;
}

async function uploadMediaToMeta(input: {
  phoneNumberId: string;
  accessToken: string;
  appSecret?: string | null;
  proof?: string | null;
  mediaUrl: string;
  fallbackType: string;
}): Promise<string> {
  const mediaResponse = await fetch(input.mediaUrl);
  if (!mediaResponse.ok) {
    const detail = await mediaResponse.text().catch(() => "");
    throw new Error(`media_fetch_${mediaResponse.status}${detail ? `: ${detail.slice(0, 180)}` : ""}`);
  }

  const contentType = mediaResponse.headers.get("content-type") || input.fallbackType;
  const bytes = await mediaResponse.arrayBuffer();
  if (bytes.byteLength < 1024) throw new Error(`media_too_small_${bytes.byteLength}b`);

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", contentType);
  form.append("file", new Blob([bytes], { type: contentType }), "attachment");

  let uploadUrl = `${META_API_BASE}/${input.phoneNumberId}/media`;
  if (input.appSecret && input.proof) uploadUrl += `?appsecret_proof=${input.proof}`;

  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.accessToken}` },
    body: form,
  });
  const uploadData = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok || !uploadData?.id) {
    throw new Error(uploadData?.error?.message || `media_upload_${uploadResponse.status}`);
  }
  return uploadData.id;
}

function normalizePhoneDigits(value: unknown): string | null {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('0091') && digits.length === 14) digits = digits.slice(2);
  if (digits.startsWith('091') && digits.length === 13) digits = digits.slice(1);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const message_id = body.message_id ?? body.messageId;
    const phone_number = body.phone_number ?? body.phone ?? body.recipient;
    const content = body.content ?? body.message ?? body.body;
    const branch_id = body.branch_id ?? body.branchId;
    const message_type = body.message_type || "text";
    const media_url = body.media_url;
    const caption = body.caption;
    const template_name = body.template_name;
    const template_language = body.template_language || "en";
    const template_components = body.template_components;

    if (!message_id || !phone_number || !branch_id) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: message_id, phone_number, branch_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (message_type === "text" && !content) {
      return new Response(
        JSON.stringify({ error: "Missing required field: content (for text messages)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (message_type === "template" && !template_name) {
      return new Response(
        JSON.stringify({ error: "Missing required field: template_name (for template messages)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch WhatsApp integration settings — branch-specific then global
    let integration: any = null;
    const { data: branchIntegration, error: intError } = await supabase
      .from("integration_settings")
      .select("config, credentials, is_active")
      .eq("branch_id", branch_id)
      .eq("integration_type", "whatsapp")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (intError) {
      await supabase.from("whatsapp_messages").update({ status: "failed" }).eq("id", message_id);
      await logError(supabase, branch_id, "send-whatsapp", "Failed to load WhatsApp integration settings", intError.message);
      return new Response(JSON.stringify({ error: "Failed to load WhatsApp integration settings" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (branchIntegration) {
      integration = branchIntegration;
    } else {
      const { data: globalIntegration } = await supabase
        .from("integration_settings")
        .select("config, credentials, is_active")
        .is("branch_id", null)
        .eq("integration_type", "whatsapp")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      integration = globalIntegration;
    }

    if (!integration) {
      await supabase.from("whatsapp_messages").update({ status: "failed" }).eq("id", message_id);
      return new Response(
        JSON.stringify({ error: "WhatsApp integration not configured or inactive for this branch" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const accessToken = integration.credentials?.access_token;
    const phoneNumberId = integration.config?.phone_number_id;
    const appSecret = integration.credentials?.app_secret || null;

    if (!accessToken || !phoneNumberId) {
      await supabase.from("whatsapp_messages").update({ status: "failed" }).eq("id", message_id);
      return new Response(
        JSON.stringify({ error: "Missing access_token or phone_number_id in WhatsApp configuration" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Compute appsecret_proof if app_secret is configured
    let proof: string | null = null;
    if (appSecret) {
      proof = await computeAppSecretProof(accessToken, appSecret);
    }

    // Normalize phone number to E.164 digits-only (Meta WhatsApp Cloud API requirement).
    // Accepts: "+919928910901", "919928910901", "9928910901", "09928910901", "+91 99289-10901".
    // Defaults to India (+91) when no country code is present.
    const cleanPhone = normalizePhoneDigits(phone_number);
    if (!cleanPhone) {
      await supabase.from("whatsapp_messages").update({ status: "failed" }).eq("id", message_id);
      await logError(supabase, branch_id, "send-whatsapp", "Invalid phone number", `Could not normalize "${phone_number}" to E.164`);
      return new Response(
        JSON.stringify({ error: "Invalid recipient phone number", details: `received "${phone_number}"` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Build Meta payload based on message type
    let metaPayload: any = {
      messaging_product: "whatsapp",
      to: cleanPhone,
    };

    let uploadedMediaId: string | null = null;
    if ((message_type === "image" || message_type === "document" || message_type === "video") && media_url) {
      try {
        uploadedMediaId = await uploadMediaToMeta({
          phoneNumberId,
          accessToken,
          appSecret,
          proof,
          mediaUrl: media_url,
          fallbackType:
            message_type === "image" ? "image/jpeg" :
            message_type === "video" ? "video/mp4" :
            "application/pdf",
        });
      } catch (mediaErr) {
        const errMsg = mediaErr instanceof Error ? mediaErr.message : "Media upload failed";
        console.error("WhatsApp media preparation error:", errMsg);
        await supabase.from("whatsapp_messages").update({ status: "failed" }).eq("id", message_id);
        await logError(supabase, branch_id, "send-whatsapp", "Media preparation failed", errMsg);
        return new Response(
          JSON.stringify({ error: "Failed to prepare WhatsApp media", details: errMsg }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    if (message_type === "image") {
      metaPayload.type = "image";
      metaPayload.image = {
        ...(uploadedMediaId ? { id: uploadedMediaId } : { link: media_url }),
        ...(caption ? { caption } : {}),
      };
    } else if (message_type === "video") {
      metaPayload.type = "video";
      metaPayload.video = {
        ...(uploadedMediaId ? { id: uploadedMediaId } : { link: media_url }),
        ...(caption ? { caption } : {}),
      };
    } else if (message_type === "document") {
      // Meta document payload: include BOTH filename + caption when available so
      // the recipient sees a named PDF with descriptive text.
      metaPayload.type = "document";
      metaPayload.document = {
        ...(uploadedMediaId ? { id: uploadedMediaId } : { link: media_url }),
        filename: body.filename || "document.pdf",
        ...(caption ? { caption } : {}),
      };
    } else if (message_type === "template") {
      metaPayload.type = "template";
      metaPayload.template = {
        name: template_name,
        language: { code: template_language },
        ...(template_components ? { components: template_components } : {}),
      };
    } else {
      metaPayload.type = "text";
      metaPayload.text = { body: content };
    }

    // Send via Meta Cloud API
    const metaUrl = buildMetaUrl(phoneNumberId, accessToken, appSecret, proof);

    let metaResponse: Response;
    let metaData: any;
    try {
      metaResponse = await fetch(metaUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(metaPayload),
      });
      metaData = await metaResponse.json();
    } catch (fetchErr) {
      const errMsg = fetchErr instanceof Error ? fetchErr.message : "Network error calling Meta API";
      console.error("Meta API fetch error:", errMsg);
      await supabase.from("whatsapp_messages").update({ status: "failed" }).eq("id", message_id);
      await logError(supabase, branch_id, "send-whatsapp", "Meta API fetch error", errMsg);
      return new Response(
        JSON.stringify({ error: "Failed to reach Meta API", details: errMsg }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!metaResponse.ok) {
      const metaErrorMsg = metaData?.error?.message || "Unknown Meta API error";
      console.error("Meta API error:", JSON.stringify(metaData));
      await supabase.from("whatsapp_messages").update({ status: "failed" }).eq("id", message_id);
      await logError(supabase, branch_id, "send-whatsapp", `Meta API ${metaResponse.status}`, metaErrorMsg);
      return new Response(
        JSON.stringify({
          error: "Failed to send WhatsApp message",
          meta_error: metaErrorMsg,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const waMessageId = metaData?.messages?.[0]?.id || null;

    // Update message status to sent + store Meta's message ID
    await supabase
      .from("whatsapp_messages")
      .update({
        status: "sent",
        whatsapp_message_id: waMessageId,
      })
      .eq("id", message_id);

    // Log communication (skip when dispatcher already owns the log row)
    if (!body.skip_log) {
      await supabase.from("communication_logs").insert({
        branch_id,
        recipient: phone_number,
        type: "whatsapp",
        content: content || `[${message_type}]`,
        status: "sent",
        sent_at: new Date().toISOString(),
      });
    }

    return new Response(JSON.stringify({ success: true, whatsapp_message_id: waMessageId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    await captureEdgeError('send-whatsapp', error);
    console.error("send-whatsapp error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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
