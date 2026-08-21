// dispatch-communication v1.30.0 — semantic positional slot resolution.
// v1.30.0: FIX — templates whose `variables` column stores generic labels
//          ("variable_1".."variable_4") produced an all-dashes body ("Hi —,
//          Name: —, Interest: —"). Generic labels are now treated as UNLABELLED
//          and each positional {{n}} slot derives a semantic key from the words
//          preceding it in the template body (Hi/Name:/Interest:/Source:/₹…),
//          so the payload's named vars (lead_name, plan_interest, …) resolve.
// v1.29.1: FIX — Meta positional slots {{n}} are now correctly resolved from
//          available values. Previously, numeric keys ({{1}}, {{2}}...) were
//          preferring name-like fields even for non-name slots, leading to
//          "₹Member Name" in amount slots. Now positional slots fallback to
//          generic placeholders only if no matching value is found.
// v1.27.0: Propagate `skip_notification` to staff handoffs; detect Meta `echo`
//          events in `whatsapp-webhook` v6.6.0 to prevent AI loops.
// v1.26.0: Template picker only considers APPROVED Meta templates and prefers a
//          DOCUMENT-header template when the send carries a PDF. Body-only
//          fallbacks now paste a SHORT branded link (/functions/v1/doc?c=…)
//          instead of a 400-character signed storage URL.
// v1.23.0: FIX — document attachments on body-only approved templates are no
//          longer silently dropped. Meta templates like `invoice_generated_pdf`
// v1.22.0: Preserve structured Meta/MM API error details from nested Edge
//          Function failures so Campaign Wizard and logs show actionable
//          meta_code/provider_route/fbtrace instead of generic "unknown".
// v1.21.0: Email broadcast hardening — images are embedded by URL and large
//          documents are linked instead of base64-attached per recipient. This
//          avoids Edge worker resource exhaustion during 300+ recipient sends.
// v1.20.0: FIX — do not overwrite a Meta delivery callback that already
//          marked the log failed/bounced while dispatch finalization was still
//          running. Provider ACK means "accepted", not guaranteed delivered.
//          This keeps 131049 ecosystem pacing visible as Failed.
// v1.19.0: FIX — stamp whatsapp_messages.media_meta.source_log_id before
//          provider callbacks can arrive. Meta status webhooks can beat the
//          dispatcher's final provider_message_id update, so callbacks need a
//          stable log id to prevent Communication Logs saying "sent" while the
//          inbox row already says "failed".
// v1.18.0: FIX — Meta positional placeholders like {{1}} are mapped to CRM
//          variable labels like first_name without duplicating body params.
//          Prevents 132000 when CRM variables=["first_name"] and approved Meta
//          body has exactly one {{1}} slot.
// v1.17.0: FIX — finalize update no longer sets delivery_metadata=null (NOT NULL
//          column → silent update failure → WA/SMS/email logs stuck in 'sending'
//          forever). Also injects URL-button component for AUTHENTICATION (OTP)
//          templates so Meta accepts the send instead of returning 131008.
// v1.16.0: Unified WhatsApp delivery decision — single resolver replaces the
//          confusing "Outside 24h customer-service window" failure path.
//          Order of resolution for WhatsApp sends:
//            1. inbound session OPEN (last 24h) → send freeform
//            2. caller passed template_id        → send that approved template
//            3. category → template fallback     → templates.trigger_event match
//            4. global fallback template         → settings.whatsapp_fallback_template_id
//            5. none available                   → SUPPRESS (terminal, no retry)
//          Also: every WhatsApp/SMS/Email log now carries source_caller in
//          delivery_metadata so System Health can show "Caller / Template"
//          instead of an anonymous Meta API error. New optional DispatchInput
//          field `source_caller` is propagated end-to-end.
// v1.15.0: WhatsApp template pre-flight guard — before invoking send-whatsapp with a
//          template_id we check live whatsapp_templates.status/category/is_stale.
//          - Not APPROVED OR stale → suppressed (template_not_approved / template_stale)
//          - Operational category drift (UTILITY→MARKETING on transactional events)
//            still sends but is flagged in delivery_metadata.category_drift=true so
//            ops can react. Structured Meta error fields (meta_code, meta_subcode,
//            pace_limited, category_issue, fallbackable) are persisted into
//            delivery_metadata for every failed WhatsApp send.
// v1.14.0: WhatsApp Cloud API error-code humaniser. 131047 / 131049 / 131026 /
// v1.13.0: Freeform WhatsApp video attachments are now sent as native video
//          (was previously force-collapsed to document, which Meta rejected).
// v1.12.0: Channel-level kill switch — if Settings → Integrations has the
//          target channel (whatsapp/sms/email) toggled OFF for the branch
//          (with global fallback), suppress the send cleanly. Logs a single
//          `delivery_status='suppressed'` row with reason
//          `channel_disabled_in_settings` and never enqueues a retry.
// v1.11.0: Document-header WhatsApp templates never inject the signed PDF URL
//          into BODY variables (would surface as "Download: <url>" in chat).
//          PDF flows ONLY through the HEADER component. Also writes a clean
//          rendered body to communication_logs.content + whatsapp_messages.content
//          so audit/inbox views never display the long signed URL.
// v1.10.0: Never downgrade approved BODY-only WhatsApp templates with PDFs to
//          freeform document sends (Meta later fails those outside 24h with
//          131047). If the approved template has no document_link variable,
//          append the PDF URL to the plan variable so the PDF is still shared
//          through the approved template path.
// v1.9.0: Strip {{}} wrappers from templates.variables; broaden var alias resolution
//         (member_name/plan_title/trainer_name/etc.); never throw missing_template_variables —
//         substitute single space for empty params (Meta accepts; avoids 132000).
// v1.8.0: Native template document/image/video headers — when input.template_id
//         resolves to a template with header_type ∈ {document,image,video} AND an
//         attachment.url is supplied, build a HEADER template_components entry so
//         the recipient receives the file as a native WhatsApp attachment instead
//         of a backend storage link in the body. Falls back to the freeform
//         document path when the template has no Meta name yet.
// v1.7.0: WhatsApp pre-flight 24h-window guard — when no approved Meta template
//         is in play and no inbound message exists from the recipient in the last
//         24h, fail fast with reason='no_active_session_no_template' (avoids the
//         opaque Meta 131047 "Re-engagement message" error).
// v1.6.0: accept attachment.kind='video' (mapped to WA document fallback); video forwarded as-is to email base64 path.
// v1.5.0: send approved Meta WhatsApp templates when template_id is provided; harden IN phone normalization.
// v1.17.0: route channel='rcs' to send-rcs (Telinfy); E.164 normalisation now covers RCS too.
// v1.4.0: normalize whatsapp/sms recipient to E.164 digits-only (defaults +91 for IN); reject malformed phones early.
// v1.3.1: extract real edge-function error bodies and pre-create WA rows for all WhatsApp sends.
// v1.3.0: route channel=email to send-email (was incorrectly hitting send-message);
//         pass attachments (auto base64-fetched from attachment.url) and
//         use_branded_template flag; mirror provider_message_id into delivery_metadata.
// v1.2.0: re-allow retry of previously failed/suppressed dedupe_key; surface real Meta error body.
// v1.1.0: WhatsApp attachment passthrough (PDF / image documents).
// All other edge functions MUST route through this instead of writing
// communication_logs directly. Enforces:
//   1. dedupe_key uniqueness (cron retries / webhook replays cannot double-send)
//   2. member channel + category preferences
//   3. quiet hours (deferred to communication_retry_queue)
//   4. provider routing (whatsapp / sms / email / in_app)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Channel = 'whatsapp' | 'sms' | 'email' | 'in_app' | 'rcs';
type Category =
  | 'membership_reminder' | 'payment_receipt' | 'class_notification'
  | 'announcement' | 'low_stock' | 'new_lead' | 'payment_alert'
  | 'task_reminder' | 'retention_nudge' | 'review_request'
  | 'marketing' | 'transactional';

interface DispatchInput {
  branch_id: string;
  channel: Channel;
  category: Category;
  recipient: string;             // email, phone with +91, or user_id for in_app
  member_id?: string | null;
  user_id?: string | null;
  template_id?: string | null;
  payload: {
    subject?: string;
    body: string;
    variables?: Record<string, unknown>;
    /** When true, send-email wraps the body in the branded HTML shell. */
    use_branded_template?: boolean;
  };
  dedupe_key: string;
  ttl_seconds?: number;          // dedupe lookback window, default 86400
  force?: boolean;               // bypass preferences (transactional)
  attachment?: {                 // optional file attachment (whatsapp document/image, or email PDF)
    url: string;
    filename: string;
    content_type?: string;       // e.g. application/pdf
    kind?: 'document' | 'image' | 'video';
  };
  /**
   * Optional identifier of the calling edge function / automation rule.
   * Persisted into communication_logs.delivery_metadata.source_caller and
   * forwarded to send-whatsapp for error_logs context so System Health can
   * answer "where is this Meta error coming from?" without manual digging.
   */
  source_caller?: string;
  skip_notification?: boolean;
}

interface DispatchResult {
  status: 'sent' | 'queued' | 'deduped' | 'suppressed' | 'failed';
  log_id?: string;
  reason?: string;
  provider_message_id?: string;
}

function bad(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function ok(body: DispatchResult): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function functionErrorDetail(error: unknown): Promise<string> {
  const base = error instanceof Error ? error.message : String(error ?? 'edge_function_error');
  try {
    const ctx = (error as { context?: unknown })?.context;
    if (ctx instanceof Response) {
      const text = await ctx.clone().text();
      if (!text) return base;
      try {
        const payload = JSON.parse(text);
        return compactProviderError(payload, text);
      } catch {
        return text;
      }
    }
  } catch (_) { /* noop */ }
  return base;
}

function compactProviderError(payload: unknown, fallback = 'provider_error'): string {
  if (!payload || typeof payload !== 'object') return String(payload || fallback);
  const data = payload as Record<string, any>;
  const nested = data.error && typeof data.error === 'object' ? data.error : null;
  const metaCode = data.meta_code ?? nested?.code ?? null;
  const metaSubcode = data.meta_subcode ?? nested?.error_subcode ?? null;
  const message = data.meta_error
    || data.error_message
    || data.reason
    || data.details
    || data.detail
    || (typeof data.error === 'string' ? data.error : nested?.message)
    || data.message
    || fallback;
  const parts = [
    metaCode ? `meta_code=${metaCode}${metaSubcode ? `/${metaSubcode}` : ''}` : null,
    `message=${String(message).slice(0, 260)}`,
    data.provider_route ? `provider_route=${data.provider_route}` : null,
    data.fbtrace_id ? `fbtrace_id=${data.fbtrace_id}` : null,
  ].filter(Boolean);
  return parts.join('; ');
}

function metaFieldsFromErrorText(text: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const code = text.match(/meta_code=(\d{3,6})(?:\/(\d+))?/i) || text.match(/\b(13\d{4})\b/);
  if (code?.[1]) fields.meta_code = Number(code[1]);
  if (code?.[2]) fields.meta_subcode = Number(code[2]);
  const route = text.match(/provider_route=([a-z_]+)/i);
  if (route?.[1]) fields.provider_route = route[1];
  const fbtrace = text.match(/fbtrace_id=([A-Za-z0-9_-]+)/i);
  if (fbtrace?.[1]) fields.fbtrace_id = fbtrace[1];
  return fields;
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

function stripBraces(raw: string): string {
  return raw.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '').trim();
}

/** v1.30.0: labels like "variable_2", "param3", "p_1", "{{2}}", "2" carry no
 *  meaning — they are auto-generated placeholders, not a real mapping. */
function isGenericLabel(label: string): boolean {
  const l = stripBraces(String(label || '')).trim().toLowerCase();
  if (!l) return true;
  return /^(variable|var|param|parameter|p|v|slot|field)[\s_-]*\d+$/.test(l) || /^\d+$/.test(l);
}

/** v1.30.0: derive a semantic key for each positional {{n}} slot from the copy
 *  immediately preceding it in the template body. Meta bodies read like
 *  "Hi {{1}}, … Name: {{2}}, Interest: {{3}}, Source: {{4}}" or
 *  "outstanding amount of ₹{{2}}" — that context is the only mapping we have
 *  when the CRM stored generic labels. */
function inferSlotSemantics(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  const body = String(content || '');
  const re = /\{\{\s*([^}]+?)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const slot = match[1].trim();
    if (!/^\d+$/.test(slot)) continue;
    const before = body.slice(Math.max(0, match.index - 60), match.index).toLowerCase();
    // Nearest label wins: check the tail of the preceding copy.
    const tail = before.replace(/\s+/g, ' ');
    let key = '';
    if (/(₹|rs\.?|inr)\s*$/.test(tail)) key = 'amount_due';
    else if (/(amount|outstanding|balance|due|total|fees|price)[^a-z]*$/.test(tail)) key = 'amount_due';
    else if (/(interest|looking for|plan)[^a-z]*$/.test(tail)) key = 'plan_interest';
    else if (/(source|channel|via)[^a-z]*$/.test(tail)) key = 'lead_source';
    else if (/(invoice|receipt|reference|ref)[^a-z]*$/.test(tail)) key = 'invoice_number';
    else if (/(trainer|coach)[^a-z]*$/.test(tail)) key = 'trainer_name';
    else if (/(branch|club|studio|centre|center)[^a-z]*$/.test(tail)) key = 'branch_name';
    else if (/(date|on|expires|expiry|valid till|till|by)[^a-z]*$/.test(tail)) key = 'date';
    else if (/(time|at)[^a-z]*$/.test(tail)) key = 'time';
    else if (/(link|url|download)[^a-z]*$/.test(tail)) key = 'document_link';
    else if (/(name)[^a-z]*$/.test(tail)) key = 'lead_name';
    else if (/(hi|hello|hey|dear)[^a-z]*$/.test(tail)) key = 'recipient_name';
    if (key) out[slot] = key;
  }
  return out;
}

function orderedTemplateKeys(content: string, variables: unknown): string[] {
  const configured = Array.isArray(variables)
    ? variables.map((v) => stripBraces(String(v))).filter(Boolean)
    : [];
  const placeholders = Array.from(content.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g))
    .map((match) => match[1].trim())
    .filter(Boolean);

  // Meta only cares about positional BODY parameter count. Our CRM stores a
  // friendly mapping (`variables: ["first_name"]`) while Meta text often stays
  // positional (`Hi {{1}}`). Treat configured[n] as the label for {{n+1}}
  // instead of adding BOTH keys — otherwise a one-slot Meta template receives
  // two body params and fails with 132000.
  if (placeholders.length > 0 && placeholders.every((key) => /^\d+$/.test(key))) {
    const maxSlot = placeholders.reduce((max, key) => Math.max(max, Number(key)), 0);
    const semantics = inferSlotSemantics(content);
    const useConfigured = configured.length >= maxSlot && !configured.every((c) => isGenericLabel(c));
    const keys: string[] = [];
    for (let slot = 1; slot <= maxSlot; slot++) {
      const label = configured[slot - 1];
      if (useConfigured && label && !isGenericLabel(label)) keys.push(label);
      else keys.push(semantics[String(slot)] || String(slot));
    }
    if (keys.length > 0) return keys;
  }

  const keys: string[] = [...configured];
  for (const key of placeholders) {
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}


/** Resolve a value for a template variable key with broad alias support. */
function resolveVarValue(
  key: string,
  values: Record<string, unknown> | undefined,
  index: number,
): string {
  if (!values) return '';
  const tryKeys = [
    key,
    key.toLowerCase(),
    stripBraces(key),
    String(index + 1),
    `variable_${index + 1}`,
  ];
  // Common aliases
  const k = key.toLowerCase();
  // v1.30.0: recipient/greeting slot — internal alerts address staff, member
  // journeys address the member. Prefer the most specific key available.
  if (k === 'recipient_name' || k === 'recipient') tryKeys.push('recipient_name', 'staff_name', 'first_name', 'member_name', 'name', 'full_name', 'contact_name', 'lead_name');
  if (k.includes('staff')) tryKeys.push('staff_name', 'assignee_name', 'recipient_name');
  if (k.includes('lead_name')) tryKeys.push('lead_name', 'full_name', 'contact_name', 'name', 'member_name');
  if (k.includes('member') || k === 'name' || k === 'first_name' || k === 'full_name') tryKeys.push('member_name', 'name', 'full_name', 'first_name', 'lead_name', 'contact_name');
  if (k.includes('plan_title') || k.includes('plan_name') || k === 'plan') tryKeys.push('plan_title', 'plan_name', 'plan');
  if (k.includes('trainer')) tryKeys.push('trainer_name');
  if (k.includes('interest')) tryKeys.push('interest', 'plan_interest', 'interest_name');
  if (k.includes('source')) tryKeys.push('source', 'lead_source', 'utm_source');
  if (k.includes('amount') || k.includes('price') || k.includes('total') || k.includes('due') || k.includes('fees') || k === 'revenue') tryKeys.push('amount_due', 'pending_amount', 'amount', 'price', 'total_amount', 'total_revenue');
  if (k.includes('invoice')) tryKeys.push('invoice_number', 'invoice_id');
  if (k.includes('branch')) tryKeys.push('branch_name', 'branch');
  if (k.includes('date')) tryKeys.push('date', 'report_date');
  if (k.includes('checkins')) tryKeys.push('checkins', 'total_checkins');
  if (k.includes('document') || k.includes('link') || k.includes('url')) tryKeys.push('document_link', 'url', 'link');
  // Meta positional slots ({{1}}, {{2}}, …). By convention slot #1 is the
  // recipient's first name (matches CampaignWizard's variable legend and
  // manage-whatsapp-templates auto-personalization). Without this the
  // wamid ships with an empty "Hi ,", i.e. delivered but visibly broken.
  if (/^\d+$/.test(key)) {
    tryKeys.push(`v${key}`, `param${key}`, `p${key}`);
    // Only prefer name-like fields for the VERY first slot (index 0 OR {{1}}).
    // Previously we were adding these for ALL numeric keys, causing amount
    // slots ({{2}}, {{3}}...) to pick up the name instead of the amount.
    if (index === 0 || key === '1') {
      tryKeys.push('member_name', 'first_name', 'name', 'full_name');
    }
  }

  const isAmountKey = k.includes('amount') || k.includes('price') || k.includes('total') || k.includes('due') || k.includes('fees');
  for (const tk of tryKeys) {
    const v = values[tk];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      let out = String(v).trim();
      // Approved Meta bodies already print the currency symbol ("₹{{3}}"),
      // so a value of "₹2,000" renders as "₹₹2,000". Strip it once.
      if (isAmountKey) {
        // v1.29.1: Broaden stripping to catch multiple variants and whitespace.
        out = out.replace(/^(₹|Rs\.?|INR|INR\.|Rs)\s*/i, '').trim();
      }
      return out;
    }
  }
  return '';

}


/** Safe visible fallback per variable-key type. Meta rejects whitespace-only
 *  or leading/trailing-space body params on many marketing templates (132018),
 *  so we substitute a real, sensible token instead of " ". */
function safeFallbackForKey(key: string, index: number): string {
  const k = String(key || '').toLowerCase();
  if (k.includes('member') || k.includes('name') || k === 'first' || k === 'first_name') return 'there';
  // Purely numeric keys (Meta positional {{1}}, {{2}}, …) — the first slot is
  // almost always a name/greeting on Incline templates, so fall back to
  // \"there\" instead of \"—\" to avoid \"Hi —,\" style output.
  if (/^\d+$/.test(k)) {
    // We treat {{1}} as the greeting name slot by convention on many templates.
    // v1.29.1: If it's the first slot, use \"there\" to avoid \"Hi —,\".
    if (k === '1' || index === 0) return 'there';
    // For other positional slots, \"—\" is a safer generic placeholder.
    return '—';
  }
  if (k.includes('interest')) return 'Not specified';
  if (k.includes('source')) return 'Direct';
  if (k.includes('plan')) return 'your plan';
  if (k.includes('trainer')) return 'your trainer';
  if (k.includes('branch')) return 'our club';
  if (k.includes('amount') || k.includes('price')) return '—';
  if (k.includes('invoice')) return '—';
  if (k.includes('date')) return 'soon';
  if (k.includes('document') || k.includes('link') || k.includes('url')) return '';
  return '—';
}

function templateComponents(keys: string[], values: Record<string, unknown> | undefined): Array<Record<string, unknown>> | null | undefined {
  if (keys.length === 0) return undefined;
  const params = keys.map((key, index) => {
    const raw = resolveVarValue(key, values, index);
    const trimmed = String(raw ?? '').trim();
    // Never send whitespace-only or empty text params — Meta returns 132018.
    // Substitute a safe visible fallback based on key semantics.
    const text = trimmed || safeFallbackForKey(key, index);
    return { type: 'text', text: text || 'there' };
  });
  return [{ type: 'body', parameters: params }];
}

/** True when a template body variable is required (i.e. name-like) and the
 *  resolved value is empty — used to fail-closed on marketing sends before
 *  hitting Meta and burning quota. */
function requiredKeysMissing(
  keys: string[],
  values: Record<string, unknown> | undefined,
): string[] {
  const missing: string[] = [];
  for (let i = 0; i < keys.length; i++) {
    const raw = resolveVarValue(keys[i], values, i);
    if (String(raw ?? '').trim()) continue;
    const k = String(keys[i] || '').toLowerCase();
    // v1.28.0: Meta positional slots ({{1}}, {{2}} …) carry no semantics, so we
    // cannot tell a name slot from an amount slot. Any empty positional slot
    // produces visibly broken copy ("Hi , we received ₹ for on .") — treat all
    // of them as required.
    if (/^\d+$/.test(k)) {
      missing.push(keys[i]);
      continue;
    }
    // Name-like slots.
    if (k.includes('member') || k.includes('name') || k === 'first' || k === 'first_name') {
      missing.push(keys[i]);
      continue;
    }
    // v1.25.0: date/time slots are required too. An empty one produces
    // half-written sends like "your booking for the class on at is confirmed".
    if (/(^|_)(date|time|datetime|slot_date|slot_time|start|when)(_|$)/.test(k)) {
      missing.push(keys[i]);
      continue;
    }
    // v1.28.0: money/reference slots — an empty one renders a bare "₹".
    if (/(amount|price|total|due|fees|invoice|payment_for|item_description)/.test(k)) {
      missing.push(keys[i]);
    }
  }
  return missing;
}



function appendAttachmentLinkForBodyOnlyTemplate(
  keys: string[],
  values: Record<string, unknown>,
  attachmentUrl?: string,
): Record<string, unknown> {
  if (!attachmentUrl) return values;
  const hasLinkSlot = keys.some((key) => /document|link|url/i.test(stripBraces(key)));
  if (hasLinkSlot) return values;

  const preferredKey = keys.find((key) => /plan_(title|name)|^plan$/i.test(stripBraces(key)))
    ?? keys.find((key) => /trainer/i.test(stripBraces(key)))
    // Last resort: many APPROVED Meta bodies (invoice_generated_pdf,
    // payment_receipt_pdf …) claim the file is "attached" but have NO HEADER
    // component, so the document is never delivered. Rather than dropping the
    // PDF entirely, append the download link to the final body slot.
    ?? keys[keys.length - 1];
  if (!preferredKey) return values;

  const normalizedKey = stripBraces(preferredKey);
  const current = resolveVarValue(normalizedKey, values, keys.indexOf(preferredKey)).trim();
  if (current.includes(attachmentUrl)) return values;
  return {
    ...values,
    [normalizedKey]: current ? `${current} — PDF: ${attachmentUrl}` : attachmentUrl,
  };
}

/** Convert a long signed storage URL into a short branded redirect
 *  (`…/functions/v1/doc?c=abc12345`). Falls back to the original URL if the
 *  short link can't be created — never blocks a send. */
async function shortenDocumentLink(
  supabase: any,
  url: string | undefined,
  purpose: string,
  branchId?: string | null,
): Promise<string | undefined> {
  if (!url) return url;
  const base = Deno.env.get('SUPABASE_URL');
  if (!base) return url;
  if (url.includes('/functions/v1/doc?c=')) return url;
  try {
    const code = Array.from(crypto.getRandomValues(new Uint8Array(6)))
      .map((b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32])
      .join('');
    const { error } = await supabase.from('short_links').insert({
      code,
      target_url: url,
      purpose,
      branch_id: branchId ?? null,
      // Signed storage URLs are time-limited anyway; keep the short link alive
      // for 30 days so members can re-open recent documents.
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (error) return url;
    return `${base}/functions/v1/doc?c=${code}`;
  } catch {
    return url;
  }
}



function inferTemplateValues(templateContent: string, renderedBody: string, keys: string[]): Record<string, string> {
  if (keys.length === 0) return {};
  const parts = templateContent.split(/\{\{\s*[^}]+?\s*\}\}/g).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`^${parts.join('(.+?)')}$`, 's');
  const match = renderedBody.match(regex);
  if (!match) return {};
  return keys.reduce<Record<string, string>>((acc, key, index) => {
    const value = match[index + 1]?.trim();
    if (value && !/^\{\{.*\}\}$/.test(value)) acc[key] = value;
    return acc;
  }, {});
}

function gymClosureDefaultValues(keys: string[]): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const closure = fmt.format(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const resume = fmt.format(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000));
  return keys.reduce<Record<string, string>>((acc, key, index) => {
    const normalized = key.toLowerCase();
    acc[key] = normalized.includes('resume') || index > 0 ? resume : closure;
    return acc;
  }, {});
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return bad(405, { error: 'method_not_allowed' });

  let input: DispatchInput;
  try {
    input = await req.json();
  } catch {
    return bad(400, { error: 'invalid_json' });
  }

  // ── validate ──
  const required = ['branch_id', 'channel', 'category', 'recipient', 'payload', 'dedupe_key'] as const;
  for (const k of required) {
    if (!input[k as keyof DispatchInput]) return bad(400, { error: `missing_${k}` });
  }
  const validChannels: Channel[] = ['whatsapp', 'sms', 'email', 'in_app', 'rcs'];
  if (!validChannels.includes(input.channel)) return bad(400, { error: 'invalid_channel' });
  if (!input.payload?.body) return bad(400, { error: 'missing_payload_body' });

  // Freeform guard: email/SMS/in-app bodies are sent verbatim, so an unresolved
  // placeholder ("Dear {{1}}", "₹{{2}}") would reach the recipient. WhatsApp is
  // exempt — its {{n}} slots are filled by Meta from the template variables.
  if (input.channel !== 'whatsapp' && !input.template_id) {
    const remaining = String(input.payload.body).match(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g);
    if (remaining?.length) {
      return bad(400, {
        error: 'unresolved_placeholders',
        details: Array.from(new Set(remaining)).join(', '),
      });
    }
  }


  // Normalize phone recipients to E.164 (digits only) for whatsapp/sms/rcs.
  // Defaults to India (+91) when no country code is present.
  if (input.channel === 'whatsapp' || input.channel === 'sms' || input.channel === 'rcs') {
    const digits = normalizePhoneDigits(input.recipient);
    if (!digits) {
      return bad(400, { error: 'invalid_recipient_phone', details: input.recipient });
    }
    input.recipient = digits;
  }

  const ttl = Math.max(60, Math.min(input.ttl_seconds ?? 86400, 7 * 86400));

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  try {
    // ── 0) channel kill-switch (Settings → Integrations) ──
    // If the target channel is toggled OFF for this branch (or globally,
    // when no branch row exists), suppress immediately. This applies to ALL
    // categories — including transactional — so disabled providers never
    // produce failed/retried sends. `in_app` is always allowed.
    if (input.channel !== 'in_app') {
      const { data: chActive, error: chErr } = await supabase.rpc(
        'channel_active_for_branch',
        { p_branch_id: input.branch_id, p_channel: input.channel },
      );
      if (chErr) {
        return bad(500, { error: 'channel_check_failed', detail: chErr.message });
      }
      if (chActive === false) {
        // Idempotent suppressed log on dedupe_key.
        const { data: log } = await supabase
          .from('communication_logs')
          .upsert({
            branch_id: input.branch_id,
            member_id: input.member_id ?? null,
            user_id: input.user_id ?? null,
            type: input.channel,
            channel: input.channel,
            category: input.category,
            recipient: input.recipient,
            subject: input.payload.subject ?? null,
            content: input.payload.body,
            template_id: input.template_id ?? null,
            dedupe_key: input.dedupe_key,
            status: 'suppressed',
            delivery_status: 'suppressed',
            error_message: 'channel_disabled_in_settings',
          }, { onConflict: 'dedupe_key', ignoreDuplicates: false })
          .select('id')
          .maybeSingle();
        return ok({
          status: 'suppressed',
          log_id: log?.id,
          reason: 'channel_disabled_in_settings',
        });
      }
    }

    // ── 1) dedupe lookup ──
    const cutoff = new Date(Date.now() - ttl * 1000).toISOString();
    const { data: existing } = await supabase
      .from('communication_logs')
      .select('id, delivery_status, provider_message_id')
      .eq('dedupe_key', input.dedupe_key)
      .gte('created_at', cutoff)
      .maybeSingle();

    if (existing) {
      const prev = String(existing.delivery_status || '').toLowerCase();
      // Only treat terminal-success or in-flight states as deduped. A previous
      // `failed` / `suppressed` attempt should be retryable from the UI.
      const dedupeStates = ['sent', 'delivered', 'read', 'queued', 'sending'];
      if (dedupeStates.includes(prev)) {
        return ok({
          status: 'deduped',
          log_id: existing.id,
          reason: `existing_log_${existing.delivery_status}`,
          provider_message_id: existing.provider_message_id ?? undefined,
        });
      }
      // Clear the old failed row so the unique dedupe_key index allows a fresh attempt.
      await supabase.from('communication_logs').delete().eq('id', existing.id);
    }

    // ── 2) preference enforcement ──
    if (!input.force) {
      const { data: pref } = await supabase.rpc('should_send_communication', {
        p_member_id: input.member_id ?? null,
        p_channel: input.channel,
        p_category: input.category,
        p_branch_id: input.branch_id ?? null,
      });

      const allowed = Array.isArray(pref) ? pref[0]?.allowed : pref?.allowed;
      const reason  = Array.isArray(pref) ? pref[0]?.reason  : pref?.reason;

      if (allowed === false) {
        const { data: log } = await supabase
          .from('communication_logs')
          .insert({
            branch_id: input.branch_id,
            member_id: input.member_id ?? null,
            user_id: input.user_id ?? null,
            type: input.channel,
            channel: input.channel,
            category: input.category,
            recipient: input.recipient,
            subject: input.payload.subject ?? null,
            content: input.payload.body,
            template_id: input.template_id ?? null,
            dedupe_key: input.dedupe_key,
            status: 'suppressed',
            delivery_status: 'suppressed',
            error_message: reason ?? 'preference_block',
          })
          .select('id')
          .maybeSingle();


        return ok({ status: 'suppressed', log_id: log?.id, reason: reason ?? 'preference_block' });
      }

      // ── 2b) 131049 pacing cooldown ──
      // Meta silently rate-limits marketing templates per recipient when
      // engagement is low. Retrying inside the pacing window keeps digging
      // the same hole (tanks template quality further). Suppress cleanly
      // for 24 h after any 131049 to the same recipient.
      if (input.channel === 'whatsapp' && input.category === 'marketing') {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: paced } = await supabase
          .from('communication_logs')
          .select('id')
          .eq('type', 'whatsapp')
          .eq('recipient', input.recipient)
          .in('delivery_status', ['failed', 'bounced'])
          .contains('delivery_metadata', { meta_code: 131049 } as any)
          .gte('created_at', since)
          .limit(1);
        if (paced && paced.length > 0) {
          const { data: log } = await supabase
            .from('communication_logs')
            .insert({
              branch_id: input.branch_id,
              member_id: input.member_id ?? null,
              user_id: input.user_id ?? null,
              type: input.channel,
              channel: input.channel,
              category: input.category,
              recipient: input.recipient,
              subject: input.payload.subject ?? null,
              content: input.payload.body,
              template_id: input.template_id ?? null,
              dedupe_key: input.dedupe_key,
              status: 'suppressed',
              delivery_status: 'suppressed',
              error_message: 'pacing_cooldown_24h (Meta 131049 recently)',
              delivery_metadata: { suppressed_by: 'pacing_cooldown', meta_code: 131049 } as any,
            })
            .select('id')
            .maybeSingle();

          return ok({ status: 'suppressed', log_id: log?.id, reason: 'pacing_cooldown_24h' });
        }
      }

      // ── 3) quiet hours ──
      if (input.member_id && input.channel !== 'in_app') {
        const { data: quiet } = await supabase.rpc('is_in_quiet_hours', { p_member_id: input.member_id });
        if (quiet === true) {
          const { data: log } = await supabase
            .from('communication_logs')
            .insert({
              branch_id: input.branch_id,
              member_id: input.member_id,
              user_id: input.user_id ?? null,
              type: input.channel,
              channel: input.channel,
              category: input.category,
              recipient: input.recipient,
              subject: input.payload.subject ?? null,
              content: input.payload.body,
              template_id: input.template_id ?? null,
              dedupe_key: input.dedupe_key,
              status: 'queued',
              delivery_status: 'queued',
              error_message: 'quiet_hours_deferred',
            })
            .select('id')
            .maybeSingle();

          // Producer-side retry queue insert; process-comm-retry-queue will pick it up.
          // v1.27.0: use the real column names (the previous insert referenced
          // `retry_after`/`attempt_count`, which do not exist, so quiet-hours
          // messages were silently never retried) and carry the variables.
          if (log) {
            await supabase.from('communication_retry_queue').insert({
              original_log_id: log.id,
              branch_id: input.branch_id,
              member_id: input.member_id ?? null,
              type: input.channel,
              recipient: input.recipient,
              subject: input.payload.subject ?? null,
              content: input.payload.body,
              template_id: input.template_id ?? null,
              status: 'pending',
              retry_count: 0,
              max_retries: 3,
              next_retry_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
              last_error: 'quiet_hours_deferred',
              metadata: {
                category: input.category,
                variables: (input.payload as any)?.variables ?? null,
                event_key: (input.payload as any)?.variables?.event_key ?? null,
                attachment: input.attachment ?? null,
              },
            }).then(() => {}, () => {});
          }

          return ok({ status: 'queued', log_id: log?.id, reason: 'quiet_hours' });
        }
      }
    }

    // ── 4) insert log row (unique dedupe_key index makes this safe under concurrency) ──
    const { data: log, error: logError } = await supabase
      .from('communication_logs')
      .insert({
        branch_id: input.branch_id,
        member_id: input.member_id ?? null,
        user_id: input.user_id ?? null,
        type: input.channel,
        channel: input.channel,
        category: input.category,
        recipient: input.recipient,
        subject: input.payload.subject ?? null,
        content: input.payload.body,
        template_id: input.template_id ?? null,
        dedupe_key: input.dedupe_key,
        status: 'sending',
        delivery_status: 'sending',
        // v1.27.0: persist the variable bag + event key so the retry worker can
        // replay an identical send (previously variables were dropped and the
        // retry fell through to `no_template_for_closed_session`).
        delivery_metadata: {
          ...(input.attachment ? { attachment: input.attachment } : {}),
          ...((input.payload as any)?.variables
            ? { variables: (input.payload as any).variables }
            : {}),
          ...((input.payload as any)?.variables?.event_key
            ? { event_key: (input.payload as any).variables.event_key }
            : {}),
          ...(input.skip_notification ? { skip_notification: true } : {}),
        },

      })
      .select('id')
      .single();

    if (logError) {
      // Likely a concurrent insert hit the dedupe_key unique index; treat as deduped.
      if (logError.code === '23505') {
        const { data: dupe } = await supabase
          .from('communication_logs')
          .select('id, delivery_status, provider_message_id')
          .eq('dedupe_key', input.dedupe_key)
          .maybeSingle();
        return ok({
          status: 'deduped',
          log_id: dupe?.id,
          reason: 'unique_violation_race',
          provider_message_id: dupe?.provider_message_id ?? undefined,
        });
      }
      return bad(500, { error: 'log_insert_failed', detail: logError.message });
    }

    // ── 5) channel routing ──
    let providerMessageId: string | undefined;
    let sendError: string | undefined;
    // Structured Meta error envelope captured from send-whatsapp v2.7.0
    // and persisted into communication_logs.delivery_metadata so the UI
    // can show pacing vs template-config vs recipient issues distinctly.
    const metaErrorFields: Record<string, unknown> = {};
    const captureMetaErrorFields = (r: { data?: unknown }) => {
      const d = r?.data as Record<string, unknown> | undefined;
      if (!d) return;
      for (const k of [
        'meta_code', 'meta_subcode', 'fbtrace_id',
        'pace_limited', 'category_issue', 'session_required',
        'recipient_unreachable', 'fallbackable',
        'provider_route', // 'cloud_api' | 'mm_api' — MM API for WhatsApp routing
      ]) {
        if (d[k] !== undefined && d[k] !== null) metaErrorFields[k] = d[k];
      }
    };

    try {
      switch (input.channel) {
        case 'whatsapp': {
          let templateName: string | null = null;
          let components: Array<Record<string, unknown>> | null | undefined;
          let templateHeaderType: string | null = null;
          // Meta rejects (#132001) when the requested locale doesn't match the
          // approved translation (e.g. template approved as en_GB, sent as en).
          let templateLanguage = 'en';

          // ── Unified WhatsApp delivery resolver (v1.16.0) ──
          // If the caller did not supply a template_id, try to auto-resolve one
          // from the category. This stops the dispatcher from emitting opaque
          // "Outside 24h customer-service window" failures whenever a caller
          // forgets to pass template_id but an approved template exists.
          //
          // v1.24.0: EVENT-FIRST resolution. Workers (retention nudges, task
          // assignment, reminders) already pass the canonical event key in
          // `payload.variables.event_key`. Matching templates.trigger_event on
          // that key is far more precise than the coarse category map and fixes
          // retention nudges being suppressed with no_template_for_closed_session
          // while approved retention_stage_1/2/3 templates existed.
          // v1.25.0: candidate picker — only APPROVED Meta templates are
          // eligible, and when the send carries a PDF we prefer a template
          // that actually has a document header (native attachment) over a
          // body-only one (which degrades to a pasted link).
          // v1.27.0: MARKETING templates are de-prioritised for operational
          // sends. Meta pacing-blocks marketing traffic to fresh numbers with
          // error 131049 ("healthy ecosystem engagement"), which is exactly
          // what killed the welcome messages. A UTILITY template with the same
          // trigger_event always wins.
          const pickTemplate = async (events: string[]) => {
            if (events.length === 0) return null;
            const { data: rows } = await supabase
              .from('templates')
              .select('id, branch_id, header_type, meta_template_status, meta_template_name, content, variables, updated_at')
              .in('trigger_event', events)
              .eq('type', 'whatsapp')
              .not('meta_template_name', 'is', null)
              .or(`branch_id.eq.${input.branch_id},branch_id.is.null`);
            const list = (rows ?? []).filter(
              (r: any) => String(r.meta_template_status || '').toUpperCase() === 'APPROVED',
            );
            if (list.length === 0) return null;

            // Resolve live Meta categories so we can avoid MARKETING.
            const names = list.map((r: any) => r.meta_template_name).filter(Boolean);
            const liveByName = new Map<string, any>();
            if (names.length > 0) {
              const { data: wtRows } = await supabase
                .from('whatsapp_templates')
                .select('name, category, status, is_stale, components, synced_at')
                .in('name', names);
              for (const w of wtRows ?? []) {
                if (String((w as any).status || '').toUpperCase() !== 'APPROVED') continue;
                if ((w as any).is_stale) continue;
                liveByName.set((w as any).name, w);
              }
            }

            const wantsDoc = !!input.attachment?.url;
            const availableValues = (input.payload.variables ?? {}) as Record<string, unknown>;
            const eligible = list.filter((r: any) => {
              const live = liveByName.get(r.meta_template_name);
              if (!live) return false;
              const keys = orderedTemplateKeys(r.content ?? input.payload.body, r.variables);
              return requiredKeysMissing(keys, availableValues).length === 0;
            });
            const score = (r: any) => {
              const live = liveByName.get(r.meta_template_name);
              const cat = String(live?.category || '').toUpperCase();
              const liveHeader = (live?.components || []).find((c: any) => String(c?.type || '').toUpperCase() === 'HEADER');
              const isDocument = String(liveHeader?.format || '').toUpperCase() === 'DOCUMENT';
              return (
                (r.branch_id ? 2 : 0) +
                (wantsDoc && isDocument ? 8 : 0) +
                (cat === 'MARKETING' ? -6 : 0) +
                (cat === 'UTILITY' ? 3 : 0)
              );
            };
            eligible.sort((a: any, b: any) =>
              score(b) - score(a) ||
              String(b.updated_at || '').localeCompare(String(a.updated_at || '')) ||
              String(a.id).localeCompare(String(b.id)),
            );
            return eligible[0] ?? null;
          };


          if (!input.template_id) {
            const eventKey = String(
              (input.payload as any)?.variables?.event_key ??
                (input.payload as any)?.event_key ??
                '',
            ).trim();
            if (eventKey) {
              const eventTpl = await pickTemplate([eventKey]);
              if (eventTpl?.id) {
                input.template_id = eventTpl.id;
                (input as any).__auto_resolved_template = 'event_key';
              } else {
                // v1.28.0: Check whatsapp_triggers for explicit event_key -> template mapping.
                const { data: trigger } = await supabase
                  .from('whatsapp_triggers')
                  .select('template_id')
                  .eq('event_name', eventKey)
                  .or(`branch_id.eq.${input.branch_id},branch_id.is.null`)
                  .order('branch_id', { ascending: false, nullsFirst: false })
                  .limit(1)
                  .maybeSingle();
                if (trigger?.template_id) {
                  input.template_id = trigger.template_id;
                  (input as any).__auto_resolved_template = 'whatsapp_triggers';
                }
              }
            }
          }
          if (!input.template_id) {
            const CATEGORY_TO_TRIGGER_EVENTS: Partial<Record<Category, string[]>> = {
              membership_reminder: ['membership_expiring', 'membership_expired', 'membership_renewal'],
              payment_receipt: ['payment_received', 'invoice_generated', 'invoice_paid'],
              payment_alert: ['payment_overdue', 'payment_failed', 'payment_reminder'],
              class_notification: ['class_booked', 'class_reminder', 'class_cancelled'],
              new_lead: ['lead_created', 'lead_welcome'],
              task_reminder: ['task_assigned', 'task_reminder'],
              retention_nudge: [
                'retention_stage_1', 'retention_stage_2', 'retention_stage_3',
                'retention_nudge_t1', 'retention_nudge_t2',
                'absent_member_motivation_low', 'absent_member_motivation_high',
                'retention_nudge', 'inactive_member', 'comeback',
              ],

              review_request: ['review_request', 'feedback_request'],
              low_stock: ['low_stock_alert'],
              announcement: ['announcement', 'broadcast'],
            };
            const events = CATEGORY_TO_TRIGGER_EVENTS[input.category] ?? [];
            const fallbackTpl = await pickTemplate(events);
            if (fallbackTpl?.id) {
              input.template_id = fallbackTpl.id;
              (input as any).__auto_resolved_template = true;
            }

            // Settings-level global fallback (last resort, admin-configured).
            if (!input.template_id) {
              const { data: fb } = await supabase
                .from('settings')
                .select('value')
                .eq('key', 'whatsapp_fallback_template_id')
                .or(`branch_id.eq.${input.branch_id},branch_id.is.null`)
                .order('branch_id', { ascending: false, nullsFirst: false })
                .limit(1)
                .maybeSingle();
              const fbId = (fb?.value as any)?.template_id ?? fb?.value;
              if (fbId && typeof fbId === 'string') {
                input.template_id = fbId;
                (input as any).__auto_resolved_template = 'settings_fallback';
              }
            }
          }

          if (input.template_id) {
            const { data: tpl, error: tplError } = await supabase
              .from('templates')
              .select('content, variables, meta_template_name, header_type, attachment_source, header_media_url')
              .eq('id', input.template_id)
              .maybeSingle();
            if (tplError) throw new Error(tplError.message);
            if (tpl?.meta_template_name) {
              templateName = tpl.meta_template_name;
              templateHeaderType = (tpl.header_type ?? 'none').toLowerCase();

              // ── Live Meta health pre-flight ──────────────────────────────
              // whatsapp_templates is the canonical mirror of Meta's WABA state.
              // If the row is missing, not APPROVED, or stale, suppress cleanly
              // instead of paying the round-trip + opaque Meta rejection.
              const { data: wt } = await supabase
                .from('whatsapp_templates')
                .select('status, category, is_stale, rejected_reason, components, language')
                .eq('name', templateName)
                .limit(1)
                .maybeSingle();

              // Always send with the locale Meta actually approved.
              if (wt?.language) templateLanguage = String(wt.language);

              let categoryDrift = false;
              if (wt) {
                const liveStatus = String(wt.status || '').toUpperCase();
                if ((liveStatus !== 'APPROVED' && liveStatus !== 'PENDING_DELETION') || wt.is_stale) {
                  const reason = wt.is_stale
                    ? 'template_stale_in_meta'
                    : liveStatus === 'PENDING_DELETION'
                    ? 'template_being_deleted_in_meta'
                    : `template_not_approved:${liveStatus || 'UNKNOWN'}`;
                  await supabase
                    .from('communication_logs')
                    .update({
                      status: 'suppressed',
                      delivery_status: 'suppressed',
                      error_message: `${reason}${wt.rejected_reason ? ` (${wt.rejected_reason})` : ''}`,
                      delivery_metadata: {
                        template: templateName,
                        meta_status: liveStatus,
                        category: wt.category,
                        is_stale: !!wt.is_stale,
                        rejected_reason: wt.rejected_reason ?? null,
                      },
                    })
                    .eq('id', log!.id);
                  return ok({ status: 'suppressed', log_id: log!.id, reason });
                }
                // Operational categories that should NOT be MARKETING.
                const OPERATIONAL_CATEGORIES: Category[] = [
                  'membership_reminder', 'payment_receipt', 'class_notification',
                  'low_stock', 'new_lead', 'payment_alert', 'task_reminder',
                  'review_request', 'transactional',
                ];
                if (
                  String(wt.category || '').toUpperCase() === 'MARKETING' &&
                  OPERATIONAL_CATEGORIES.includes(input.category)
                ) {
                  categoryDrift = true;
                  console.warn(
                    `[dispatch-communication] template "${templateName}" reclassified ` +
                    `by Meta as MARKETING but used for operational category=${input.category}. ` +
                    `Send will proceed but is subject to Meta pacing (131049).`,
                  );
                }
              }

              // Reconcile header_type against the LIVE Meta template — source
              // of truth. Local `templates.header_type` may claim IMAGE while
              // the approved Meta template has no HEADER component (or vice
              // versa). Sending mismatched HEADER params triggers 132018.
              const liveComponentsForHeader = Array.isArray((wt as any)?.components) ? (wt as any).components : [];
              const liveHeaderComp = liveComponentsForHeader.find((c: any) => String(c?.type || '').toUpperCase() === 'HEADER');
              const liveHeaderFormat = liveHeaderComp ? String(liveHeaderComp.format || '').toLowerCase() : 'none';
              if (liveHeaderComp) {
                templateHeaderType = liveHeaderFormat || templateHeaderType;
              } else {
                // Meta template has no HEADER — don't send one, even if the
                // local row says otherwise. Prevents 132018 for body-only
                // approved templates that were saved locally with a header.
                templateHeaderType = 'none';
              }

              // Auto-attach the template's default header media when caller
              // didn't supply one AND the LIVE Meta template actually has a
              // matching media header component. Guarantees marketing
              // image/video templates always render with their designed art
              // without triggering 132018 on body-only templates.
              const mediaKinds = new Set(['image', 'document', 'video']);
              if (
                !input.attachment?.url &&
                mediaKinds.has(templateHeaderType) &&
                typeof (tpl as any).header_media_url === 'string' &&
                (tpl as any).header_media_url
              ) {
                const url = (tpl as any).header_media_url as string;
                input.attachment = {
                  url,
                  filename:
                    templateHeaderType === 'image' ? 'image.jpg'
                    : templateHeaderType === 'video' ? 'video.mp4'
                    : 'document.pdf',
                  content_type:
                    templateHeaderType === 'image' ? 'image/jpeg'
                    : templateHeaderType === 'video' ? 'video/mp4'
                    : 'application/pdf',
                  kind: templateHeaderType as 'image' | 'video' | 'document',
                };
                (input as any).__header_source = 'template_default';
              }

              const keys = orderedTemplateKeys(tpl.content ?? input.payload.body, tpl.variables);
              const inferred = inferTemplateValues(tpl.content ?? input.payload.body, input.payload.body, keys);
              const defaults = templateName === 'gym_closure_update' ? gymClosureDefaultValues(keys) : {};
              const baseValues = { ...defaults, ...inferred, ...(input.payload.variables ?? {}) };
              const hasMediaHeader = ['document', 'image', 'video'].includes(templateHeaderType);
              // Body-only template + a PDF → paste a SHORT branded link rather
              // than a 400-char signed storage URL.
              const shortAttachmentUrl = hasMediaHeader
                ? input.attachment?.url
                : await shortenDocumentLink(
                    supabase,
                    input.attachment?.url,
                    `whatsapp:${templateName}`,
                    input.branch_id,
                  );
              const templateValues = hasMediaHeader
                ? baseValues
                : appendAttachmentLinkForBodyOnlyTemplate(keys, baseValues, shortAttachmentUrl);

              // Pre-flight: refuse to burn a Meta send when a required
              // name-like variable is missing. Prevents 132018 loops when
              // leads have no captured full_name.
              // Defence-in-depth: for internal team-alert categories,
              // auto-fill missing staff/recipient-name slots with "Team"
              // so a caller that forgets can't hard-block ops.
              const INTERNAL_TEAM_CATEGORIES = new Set(['new_lead', 'task_reminder', 'low_stock', 'payment_alert']);
              if (INTERNAL_TEAM_CATEGORIES.has(String(input.category))) {
                for (let i = 0; i < keys.length; i++) {
                  const k = String(keys[i] || '').toLowerCase();
                  const cur = String(resolveVarValue(keys[i], templateValues, i) ?? '').trim();
                  if (!cur && /^(staff|team_member|recipient)_name$/.test(k)) {
                    (templateValues as Record<string, unknown>)[keys[i]] = 'Team';
                  }
                }
              }
              const missingRequired = requiredKeysMissing(keys, templateValues);
              // v1.25.0: fail closed for ALL categories (was MARKETING-only).
              // A utility template with an empty name/date/time slot reads as
              // broken to the member and is worse than not sending.
              if (missingRequired.length > 0) {


                const reason = `template_param_empty:${missingRequired.join(',')}`;
                await supabase
                  .from('communication_logs')
                  .update({
                    delivery_status: 'failed',
                    status: 'failed',
                    error_message: `132018: ${reason} (blocked pre-flight; provide full_name or use a no-name template)`,
                    delivery_metadata: {
                      pre_flight_block: true,
                      missing_keys: missingRequired,
                      template: templateName,
                    },
                    sent_at: new Date().toISOString(),
                  })
                  .eq('id', log!.id);
                return ok({ status: 'failed', log_id: log!.id, reason });
              }
              components = templateComponents(keys, templateValues);

              // AUTHENTICATION templates (OTP) require an extra `button` component
              // mirroring the body OTP value, otherwise Meta returns 131008
              // "Required parameter is missing". Detect the URL/OTP button on the
              // live Meta template mirror and inject it.
              if (wt && String(wt.category || '').toUpperCase() === 'AUTHENTICATION') {
                const liveComponents = Array.isArray((wt as any).components) ? (wt as any).components : [];
                const buttonsBlock = liveComponents.find((c: any) => String(c?.type || '').toUpperCase() === 'BUTTONS');
                const urlButton = buttonsBlock?.buttons?.find((b: any) => String(b?.type || '').toUpperCase() === 'URL');
                if (urlButton) {
                  const otpValue = resolveVarValue(keys[0] ?? 'code', templateValues, 0) || '';
                  components = [
                    ...(components ?? []),
                    { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: otpValue || ' ' }] },
                  ];
                }
              }

              if (tpl.content) {
                const rendered = String(tpl.content)
                  .replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k) => {
                    const idx = keys.findIndex((kk) => stripBraces(kk) === k);
                    const v = resolveVarValue(k, templateValues, idx >= 0 ? idx : 0);
                    return v || '';
                  })
                  .replace(/[ \t]{2,}/g, ' ')
                  .trim();
                if (rendered) input.payload.body = rendered;
              }

              if (input.attachment?.url && hasMediaHeader) {
                const header: Record<string, unknown> = { type: 'header', parameters: [] };
                const params: any[] = [];
                if (templateHeaderType === 'document') {
                  params.push({
                    type: 'document',
                    document: { link: input.attachment.url, filename: input.attachment.filename || 'document.pdf' },
                  });
                } else if (templateHeaderType === 'image') {
                  params.push({ type: 'image', image: { link: input.attachment.url } });
                } else {
                  params.push({ type: 'video', video: { link: input.attachment.url } });
                }
                header.parameters = params;
                components = [header, ...(components ?? [])];
              }

              // Stash category-drift flag on the in-flight log row metadata so
              // it lands in delivery_metadata.category_drift on the final write.
              if (categoryDrift) {
                (input as any).__category_drift = true;
              }
            }
          }

          // ── 24h-window pre-flight guard ──
          // If we won't be sending an approved Meta template, the recipient
          // must have messaged us within the last 24 hours. We already tried
          // to auto-resolve a template above; reaching here means no template
          // is available — SUPPRESS terminally so the retry queue doesn't loop.
          if (!templateName) {
            const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            const recipientDigits = input.recipient.replace(/\D/g, '');
            const { data: inbound } = await supabase
              .from('whatsapp_messages')
              .select('id')
              .eq('direction', 'inbound')
              .eq('phone_number', recipientDigits)
              .gte('created_at', since)
              .limit(1)
              .maybeSingle();
            if (!inbound) {
              await supabase
                .from('communication_logs')
                .update({
                  status: 'suppressed',
                  delivery_status: 'suppressed',
                  error_message: 'no_template_for_closed_session — no approved WhatsApp template found for category ' + input.category + '. Configure one in Settings → Communication Templates.',
                  delivery_metadata: {
                    source_caller: input.source_caller ?? null,
                    category: input.category,
                    reason: 'no_template_for_closed_session',
                  },
                })
                .eq('id', log!.id);
              return ok({
                status: 'suppressed',
                log_id: log!.id,
                reason: 'no_template_for_closed_session',
              });
            }
          }


          // When we have an approved template with a media header, send as
          // template (HEADER component carries the link → native PDF/image/video).
          // Skip the freeform-document path used for non-template attachments.
          const sendAsNativeHeaderTemplate =
            !!templateName && !!input.attachment?.url &&
            ['document', 'image', 'video'].includes(templateHeaderType ?? '');

          if (input.attachment && !templateName && !sendAsNativeHeaderTemplate) {
            // Freeform document/image fallback (no approved header template).
            const rawKind = (input.attachment.kind ?? 'document') as string;
            const kind = rawKind === 'image' ? 'image' : rawKind === 'video' ? 'video' : 'document';
            const { data: waRow, error: waErr } = await supabase
              .from('whatsapp_messages')
              .insert({
                branch_id: input.branch_id,
                phone_number: input.recipient,
                member_id: input.member_id ?? null,
                content: input.payload.body,
                direction: 'outbound',
                status: 'pending',
                message_type: kind,
                media_url: input.attachment.url,
                media_meta: {
                  source_log_id: log!.id,
                  dispatch_dedupe_key: input.dedupe_key,
                  template_id: input.template_id ?? null,
        },
      })
      .select('id')
      .maybeSingle();

            if (waErr) throw new Error(waErr.message);
            const r = await supabase.functions.invoke('send-whatsapp', {
              body: {
                message_id: waRow!.id,
                phone_number: input.recipient,
                branch_id: input.branch_id,
                message_type: kind,
                media_url: input.attachment.url,
                caption: input.payload.body,
                filename: input.attachment.filename || (rawKind === 'video' ? 'video.mp4' : undefined),
                skip_log: true,
              },
            });
            captureMetaErrorFields(r);
            if (r.error) throw new Error(await functionErrorDetail(r.error));
            const errPayload = (r.data as { error?: unknown; meta_error?: unknown })?.error;
            const metaErr = (r.data as { meta_error?: string })?.meta_error;
            if (errPayload) throw new Error(metaErr || (typeof errPayload === 'string' ? errPayload : JSON.stringify(errPayload)));
            providerMessageId = (r.data as { whatsapp_message_id?: string })?.whatsapp_message_id;
            break;
          }

          // Native template send (text, or template w/ header attachment).
          const messageType = 'text';
          const waInsert: Record<string, unknown> = {
            branch_id: input.branch_id,
            phone_number: input.recipient,
            member_id: input.member_id ?? null,
            content: input.payload.body,
            direction: 'outbound',
            status: 'pending',
            message_type: sendAsNativeHeaderTemplate
              ? (templateHeaderType === 'image' ? 'image' : templateHeaderType === 'video' ? 'video' : 'document')
              : messageType,
            media_meta: {
              source_log_id: log!.id,
              dispatch_dedupe_key: input.dedupe_key,
              template_id: input.template_id ?? null,
              template_name: templateName ?? null,
            },
          };
          if (sendAsNativeHeaderTemplate) waInsert.media_url = input.attachment!.url;
          const { data: waRow, error: waErr } = await supabase
            .from('whatsapp_messages')
            .insert(waInsert)
            .select('id')
            .single();
          if (waErr) throw new Error(waErr.message);
          const r = await supabase.functions.invoke('send-whatsapp', {
            body: {
              message_id: waRow!.id,
              phone_number: input.recipient,
              content: input.payload.body,
              branch_id: input.branch_id,
              message_type: templateName ? 'template' : messageType,
              template_name: templateName ?? undefined,
              template_language: templateLanguage,
              template_components: components ?? undefined,
              template_id: input.template_id,
              variables: input.payload.variables,
              member_id: input.member_id,
              skip_log: true,                // dispatcher owns the log
              source_log_id: log!.id,
              source_caller: input.source_caller ?? null,
              skip_notification: input.skip_notification ?? false,
              // Route marketing template sends through MM API for WhatsApp when
              // the branch's WA integration has `config.mm_api_enabled=true`.
              // send-whatsapp falls back to Cloud API automatically otherwise.
              use_mm_api: input.category === 'marketing' && !!templateName,
            },
          });
          captureMetaErrorFields(r);
          if (r.error) throw new Error(await functionErrorDetail(r.error));
          providerMessageId = (r.data as { whatsapp_message_id?: string; message_id?: string })?.whatsapp_message_id
            ?? (r.data as { message_id?: string })?.message_id;
          // Persist route (cloud_api | mm_api) on the log's delivery_metadata bag
          // via captureMetaErrorFields (also fires on success — sets provider_route).
          captureMetaErrorFields(r);
          break;
        }
        case 'sms': {
          const r = await supabase.functions.invoke('send-sms', {
            body: {
              branch_id: input.branch_id,
              recipient: input.recipient,
              message: input.payload.body,
              template_id: input.template_id,
              member_id: input.member_id,
              skip_log: true,
              source_log_id: log!.id,
            },
          });
          if (r.error) throw new Error(await functionErrorDetail(r.error));
          providerMessageId = (r.data as { message_id?: string })?.message_id;
          break;
        }
        case 'email': {
          // Build email attachments by fetching the attachment.url and base64-encoding.
          // For high-volume marketing broadcasts, repeatedly downloading and
          // base64-encoding the same creative for every recipient can exhaust
          // Edge worker memory/CPU. Images render better as linked creatives;
          // large documents are linked instead of attached.
          let emailAttachments: Array<{ filename: string; content_base64: string; content_type: string }> | undefined;
          let attachmentHtml = '';
          if (input.attachment?.url) {
            const kind = String(input.attachment.kind || '').toLowerCase();
            const contentType = String(input.attachment.content_type || '').toLowerCase();
            const safeUrl = input.attachment.url;
            const safeName = input.attachment.filename || 'attachment';

            if (kind === 'image' || contentType.startsWith('image/')) {
              attachmentHtml = `<p style="margin:24px 0 0;"><img src="${safeUrl}" alt="${safeName}" style="max-width:100%;height:auto;border-radius:12px;display:block;" /></p>`;
            } else if (input.category === 'marketing') {
              attachmentHtml = `<p style="margin:24px 0 0;"><a href="${safeUrl}" style="color:#EAB308;font-weight:700;">Open ${safeName}</a></p>`;
            } else {
              try {
                const res = await fetch(input.attachment.url);
                if (!res.ok) throw new Error(`attachment_fetch_${res.status}`);
                const buf = new Uint8Array(await res.arrayBuffer());
                if (buf.byteLength < 1024) {
                  throw new Error(`attachment_too_small_${buf.byteLength}b`);
                }
                if (buf.byteLength > 2_500_000) {
                  attachmentHtml = `<p style="margin:24px 0 0;"><a href="${safeUrl}" style="color:#EAB308;font-weight:700;">Open ${safeName}</a></p>`;
                } else {
                  // Chunked base64 to avoid stack overflow on large PDFs
                  let bin = '';
                  for (let i = 0; i < buf.length; i += 0x8000) {
                    bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + 0x8000)));
                  }
                  emailAttachments = [{
                    filename: input.attachment.filename,
                    content_base64: btoa(bin),
                    content_type: input.attachment.content_type ?? 'application/pdf',
                  }];
                }
              } catch (e) {
                throw new Error(`attachment_error: ${(e as Error).message}`);
              }
            }
          }
          // Normalize plain-text bodies for HTML email: decode literal `\n` escape
          // sequences (as stored in lead_notification_rules etc.) into real newlines,
          // then convert newlines to <br> so they render correctly inside the
          // branded shell. HTML markup already in the body is preserved.
          const rawBody = String(input.payload.body || '');
          const emailHtml = (/<\s*(br|p|div|table|html)\b/i.test(rawBody)
            ? rawBody.replace(/\\r\\n|\\n/g, '<br>')
            : rawBody.replace(/\\r\\n|\\n/g, '\n').replace(/\r?\n/g, '<br>')) + attachmentHtml;
          const r = await supabase.functions.invoke('send-email', {
            body: {
              to: input.recipient,
              subject: input.payload.subject,
              html: emailHtml,
              branch_id: input.branch_id,
              // Default ON — every dispatched email gets the branded INCLINE shell.
              // Callers can opt out by explicitly passing use_branded_template:false.
              use_branded_template: input.payload.use_branded_template ?? true,
              variables: input.payload.variables,
              attachments: emailAttachments,
              skip_log: true,
              source_log_id: log!.id,
            },
          });
          if (r.error) throw new Error(await functionErrorDetail(r.error));
          providerMessageId = (r.data as { message_id?: string })?.message_id;
          break;
        }
        case 'rcs': {
          // Telinfy RCS is template-only. Caller passes template_name + variables in payload.variables.
          const vars = (input.payload.variables as Record<string, unknown> | undefined) ?? {};
          const templateName =
            (vars.template_name as string | undefined) ??
            (vars.templateName as string | undefined) ??
            input.template_key ?? null;
          const lcustomParam = (vars.lcustomParam as Record<string, unknown> | undefined) ?? { ...vars };
          delete (lcustomParam as Record<string, unknown>).template_name;
          delete (lcustomParam as Record<string, unknown>).templateName;
          delete (lcustomParam as Record<string, unknown>).lcustomParam;

          const r = await supabase.functions.invoke('send-rcs', {
            body: {
              branch_id: input.branch_id,
              recipient: input.recipient,
              template_name: templateName,
              variables: lcustomParam,
              message: input.payload.body,
              log_id: log!.id,
            },
          });
          if (r.error) throw new Error(await functionErrorDetail(r.error));
          const rd = r.data as { provider_message_id?: string; status?: string; reason?: string } | undefined;
          if (rd?.status === 'unsupported') {
            // Caller-side fallback path: surface a specific reason so the dispatcher's
            // multi-channel router (if any) can re-queue on SMS. For now, fail loud.
            throw new Error(rd.reason || 'rcs_requires_template');
          }
          if (rd?.status && rd.status !== 'sent') throw new Error(rd.reason || rd.status);
          providerMessageId = rd?.provider_message_id;
          break;
        }
        case 'in_app': {
          // In-app notifications go through notifications table; dedupe handled there too.
          const r = await supabase.from('notifications').insert({
            user_id: input.user_id,
            branch_id: input.branch_id,
            title: input.payload.subject ?? 'Notification',
            body: input.payload.body,
            category: input.category,
          }).select('id').single();
          if (r.error && r.error.code !== '23505') throw new Error(r.error.message);
          providerMessageId = r.data?.id;
          break;
        }
      }
    } catch (e) {
      sendError = (e as Error).message ?? 'send_failed';
    }

    // ── Meta error-code humaniser ────────────────────────────────────────
    // Surface specific WhatsApp Cloud API failure modes in plain English so
    // the Campaign Report / SystemHealth can guide the operator instead of
    // showing an opaque "Meta API error (400)". Codes referenced from
    // https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
    if (sendError && input.channel === 'whatsapp') {
      const errStr = String(sendError);
      const matchCode = errStr.match(/\b(13\d{4})\b/);
      const code = matchCode?.[1];
      const META_HINTS: Record<string, string> = {
        '131047': 'Outside 24h customer-service window — submit an APPROVED Meta template and resend.',
        '131049': 'Meta pacing limit (ecosystem engagement). Recipient is inactive or frequency is too high — retry later or switch to a Utility template.',

        '131026': 'Recipient cannot receive this message (likely not on WhatsApp or blocked our number).',
        '131051': 'Unsupported message type for this template — re-check header/body components.',
        '132000': 'Template parameter count mismatch — the body has {{n}} placeholders that were not provided at send time.',
        '132001': 'Template does not exist in this WABA — re-sync from Meta in Templates Hub.',
        '132012': 'Template parameter format invalid — usually a missing variable value.',
        '132018': 'Template parameter format invalid (empty/whitespace variable — often a missing recipient name). Fix upstream data or use a no-name template variant.',
        '133010': 'Phone number is not registered with WhatsApp.',
      };
      if (code && META_HINTS[code]) {
        sendError = `${code}: ${META_HINTS[code]} (raw: ${errStr.slice(0, 200)})`;
      }
    }

    // ── 6) finalize log ──
    const finalMeta: Record<string, unknown> = {};
    if (input.attachment) finalMeta.attachment = input.attachment;
    if (providerMessageId) finalMeta.provider_message_id = providerMessageId;
    if ((input as any).__category_drift) finalMeta.category_drift = true;
    if ((input as any).__auto_resolved_template) finalMeta.auto_resolved_template = (input as any).__auto_resolved_template;
    if ((input as any).__header_source) finalMeta.header_source = (input as any).__header_source;
    if (input.source_caller) finalMeta.source_caller = input.source_caller;
    if (sendError && input.channel === 'whatsapp') Object.assign(finalMeta, metaFieldsFromErrorText(String(sendError)));
    if (Object.keys(metaErrorFields).length) Object.assign(finalMeta, metaErrorFields);

    let callbackTerminalStatus: string | null = null;
    let callbackTerminalError: string | null = null;
    if (!sendError && input.channel === 'whatsapp' && providerMessageId) {
      const { data: linkedWaMessage } = await supabase
        .from('whatsapp_messages')
        .select('status, failure_code, failure_reason')
        .eq('whatsapp_message_id', providerMessageId)
        .maybeSingle();
      const linkedStatus = String(linkedWaMessage?.status || '').toLowerCase();
      if (['failed', 'bounced', 'suppressed'].includes(linkedStatus)) {
        callbackTerminalStatus = linkedStatus;
        callbackTerminalError = linkedWaMessage?.failure_reason
          ?? (linkedWaMessage?.failure_code ? `Meta delivery failed: ${linkedWaMessage.failure_code}` : null);
        finalMeta.callback_terminal_from_whatsapp_messages = true;
      }
    }

    const { data: currentLogBeforeFinalize } = await supabase
      .from('communication_logs')
      .select('delivery_status, error_message, delivery_metadata')
      .eq('id', log!.id)
      .maybeSingle();
    const currentStatus = String(currentLogBeforeFinalize?.delivery_status || '').toLowerCase();
    const callbackAlreadyTerminal = !sendError && (
      ['failed', 'bounced', 'suppressed'].includes(currentStatus) || !!callbackTerminalStatus
    );
    const finalTerminalStatus = callbackTerminalStatus || currentStatus;
    const mergedFinalMeta = {
      ...(((currentLogBeforeFinalize?.delivery_metadata as Record<string, unknown> | null) ?? {})),
      ...finalMeta,
    };

    await supabase
      .from('communication_logs')
      .update({
        delivery_status: callbackAlreadyTerminal
          ? finalTerminalStatus
          : (sendError ? 'failed' : 'sent'),
        status: callbackAlreadyTerminal
          ? finalTerminalStatus
          : (sendError ? 'failed' : 'sent'),
        provider_message_id: providerMessageId ?? null,
        delivery_metadata: Object.keys(mergedFinalMeta).length ? mergedFinalMeta : {},
        error_message: callbackAlreadyTerminal
          ? (callbackTerminalError ?? currentLogBeforeFinalize?.error_message ?? null)
          : (sendError ?? null),
        // Re-write content from the (now possibly cleaned) rendered body so the
        // audit row matches what was actually delivered to WhatsApp.
        content: input.payload.body,
        sent_at: new Date().toISOString(),
        attempt_count: 1,
        // v1.27.0: Propagate skip_notification to the edge function router for handoffs
        skip_notification: input.skip_notification ?? false,
      })
      .eq('id', log!.id);

    const providerRoute = (metaErrorFields.provider_route as string | undefined) ?? null;
    if (sendError || callbackAlreadyTerminal) {
      return ok({ status: 'failed', log_id: log!.id, reason: sendError, provider_route: providerRoute });
    }
    return ok({ status: 'sent', log_id: log!.id, provider_message_id: providerMessageId, provider_route: providerRoute });
  } catch (e) {
    return bad(500, { error: 'unexpected', detail: (e as Error).message });
  }
});
