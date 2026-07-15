// dispatch-communication v1.17.0
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
      return text || base;
    }
  } catch (_) { /* noop */ }
  return base;
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

function orderedTemplateKeys(content: string, variables: unknown): string[] {
  const configured = Array.isArray(variables)
    ? variables.map((v) => stripBraces(String(v))).filter(Boolean)
    : [];
  const keys: string[] = [...configured];
  for (const match of content.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
    const key = match[1].trim();
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
  if (k.includes('member') || k === 'name') tryKeys.push('member_name', 'name', 'full_name');
  if (k.includes('plan_title') || k.includes('plan_name') || k === 'plan') tryKeys.push('plan_title', 'plan_name');
  if (k.includes('trainer')) tryKeys.push('trainer_name');
  if (k.includes('amount') || k.includes('price')) tryKeys.push('amount', 'price');
  if (k.includes('invoice')) tryKeys.push('invoice_number', 'invoice_id');
  if (k.includes('branch')) tryKeys.push('branch_name');
  if (k.includes('date')) tryKeys.push('date');
  if (k.includes('document') || k.includes('link') || k.includes('url')) tryKeys.push('document_link', 'url', 'link');
  // Meta positional slots ({{1}}, {{2}}, …). By convention slot #1 is the
  // recipient's first name (matches CampaignWizard's variable legend and
  // manage-whatsapp-templates auto-personalization). Without this the
  // wamid ships with an empty "Hi ,", i.e. delivered but visibly broken.
  if (/^\d+$/.test(key)) {
    if (index === 0 || key === '1') {
      tryKeys.push('first_name', 'name', 'full_name', 'member_name');
    }
    tryKeys.push(`v${key}`, `param${key}`, `p${key}`);
  }
  for (const tk of tryKeys) {
    const v = values[tk];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';

}

/** Safe visible fallback per variable-key type. Meta rejects whitespace-only
 *  or leading/trailing-space body params on many marketing templates (132018),
 *  so we substitute a real, sensible token instead of " ". */
function safeFallbackForKey(key: string): string {
  const k = String(key || '').toLowerCase();
  if (k.includes('member') || k.includes('name') || k === 'first' || k === 'first_name') return 'there';
  // Purely numeric keys (Meta positional {{1}}, {{2}}, …) — the first slot is
  // almost always a name/greeting on Incline templates, so fall back to
  // "there" instead of "—" to avoid "Hi —," style output.
  if (/^\d+$/.test(k)) return k === '1' ? 'there' : '—';
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
    const text = trimmed || safeFallbackForKey(key);
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
    // Name is the only key we treat as *required*; other slots fall back safely.
    if (k.includes('member') || k.includes('name') || k === 'first' || k === 'first_name') {
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
    ?? keys.find((key) => /trainer/i.test(stripBraces(key)));
  if (!preferredKey) return values;

  const normalizedKey = stripBraces(preferredKey);
  const current = resolveVarValue(normalizedKey, values, keys.indexOf(preferredKey)).trim();
  if (!current || current.includes(attachmentUrl)) return values;
  return { ...values, [normalizedKey]: `${current} — PDF: ${attachmentUrl}` };
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
          .single();

        return ok({ status: 'suppressed', log_id: log?.id, reason: reason ?? 'preference_block' });
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
            .single();
          // Producer-side retry queue insert; process-comm-retry-queue will pick it up.
          if (log) {
            await supabase.from('communication_retry_queue').insert({
              original_log_id: log.id,
              retry_after: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
              attempt_count: 0,
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
        delivery_metadata: input.attachment ? { attachment: input.attachment } : {},
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

          // ── Unified WhatsApp delivery resolver (v1.16.0) ──
          // If the caller did not supply a template_id, try to auto-resolve one
          // from the category. This stops the dispatcher from emitting opaque
          // "Outside 24h customer-service window" failures whenever a caller
          // forgets to pass template_id but an approved template exists.
          if (!input.template_id) {
            const CATEGORY_TO_TRIGGER_EVENTS: Partial<Record<Category, string[]>> = {
              membership_reminder: ['membership_expiring', 'membership_expired', 'membership_renewal'],
              payment_receipt: ['payment_received', 'invoice_generated', 'invoice_paid'],
              payment_alert: ['payment_overdue', 'payment_failed', 'payment_reminder'],
              class_notification: ['class_booked', 'class_reminder', 'class_cancelled'],
              new_lead: ['lead_created', 'lead_welcome'],
              task_reminder: ['task_assigned', 'task_reminder'],
              retention_nudge: ['retention_nudge', 'inactive_member', 'comeback'],
              review_request: ['review_request', 'feedback_request'],
              low_stock: ['low_stock_alert'],
              announcement: ['announcement', 'broadcast'],
            };
            const events = CATEGORY_TO_TRIGGER_EVENTS[input.category] ?? [];
            if (events.length > 0) {
              const { data: fallbackTpl } = await supabase
                .from('templates')
                .select('id, branch_id')
                .in('trigger_event', events)
                .not('meta_template_name', 'is', null)
                .or(`branch_id.eq.${input.branch_id},branch_id.is.null`)
                .order('branch_id', { ascending: false, nullsFirst: false })
                .limit(1)
                .maybeSingle();
              if (fallbackTpl?.id) {
                input.template_id = fallbackTpl.id;
                (input as any).__auto_resolved_template = true;
              }
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
                .select('status, category, is_stale, rejected_reason, components')
                .eq('name', templateName)
                .limit(1)
                .maybeSingle();

              let categoryDrift = false;
              if (wt) {
                const liveStatus = String(wt.status || '').toUpperCase();
                if (liveStatus !== 'APPROVED' || wt.is_stale) {
                  const reason = wt.is_stale
                    ? 'template_stale_in_meta'
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
              const templateValues = hasMediaHeader
                ? baseValues
                : appendAttachmentLinkForBodyOnlyTemplate(keys, baseValues, input.attachment?.url);
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
              if (missingRequired.length > 0 && String(wt?.category || '').toUpperCase() === 'MARKETING') {

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
              })
              .select('id')
              .single();
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
              template_language: 'en',
              template_components: components ?? undefined,
              template_id: input.template_id,
              variables: input.payload.variables,
              member_id: input.member_id,
              skip_log: true,                // dispatcher owns the log
              source_log_id: log!.id,
              source_caller: input.source_caller ?? null,
            },
          });
          captureMetaErrorFields(r);
          if (r.error) throw new Error(await functionErrorDetail(r.error));
          providerMessageId = (r.data as { whatsapp_message_id?: string; message_id?: string })?.whatsapp_message_id
            ?? (r.data as { message_id?: string })?.message_id;
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
          let emailAttachments: Array<{ filename: string; content_base64: string; content_type: string }> | undefined;
          if (input.attachment?.url) {
            try {
              const res = await fetch(input.attachment.url);
              if (!res.ok) throw new Error(`attachment_fetch_${res.status}`);
              const buf = new Uint8Array(await res.arrayBuffer());
              if (buf.byteLength < 1024) {
                throw new Error(`attachment_too_small_${buf.byteLength}b`);
              }
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
            } catch (e) {
              throw new Error(`attachment_error: ${(e as Error).message}`);
            }
          }
          // Normalize plain-text bodies for HTML email: decode literal `\n` escape
          // sequences (as stored in lead_notification_rules etc.) into real newlines,
          // then convert newlines to <br> so they render correctly inside the
          // branded shell. HTML markup already in the body is preserved.
          const rawBody = String(input.payload.body || '');
          const emailHtml = /<\s*(br|p|div|table|html)\b/i.test(rawBody)
            ? rawBody.replace(/\\r\\n|\\n/g, '<br>')
            : rawBody.replace(/\\r\\n|\\n/g, '\n').replace(/\r?\n/g, '<br>');
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
        '131049': 'Meta paced this MARKETING message (ecosystem engagement). Recipient is inactive — lower frequency, improve template quality, or switch to UTILITY.',
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
    if (Object.keys(metaErrorFields).length) Object.assign(finalMeta, metaErrorFields);

    await supabase
      .from('communication_logs')
      .update({
        delivery_status: sendError ? 'failed' : 'sent',
        status: sendError ? 'failed' : 'sent',
        provider_message_id: providerMessageId ?? null,
        delivery_metadata: Object.keys(finalMeta).length ? finalMeta : {},
        error_message: sendError ?? null,
        // Re-write content from the (now possibly cleaned) rendered body so the
        // audit row matches what was actually delivered to WhatsApp.
        content: input.payload.body,
        sent_at: new Date().toISOString(),
        attempt_count: 1,
      })
      .eq('id', log!.id);

    if (sendError) {
      return ok({ status: 'failed', log_id: log!.id, reason: sendError });
    }
    return ok({ status: 'sent', log_id: log!.id, provider_message_id: providerMessageId });
  } catch (e) {
    return bad(500, { error: 'unexpected', detail: (e as Error).message });
  }
});
