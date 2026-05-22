// dispatch-communication v1.14.0
// v1.14.0: WhatsApp Cloud API error-code humaniser. 131047 / 131049 / 131026 /
//          132000 / 132001 / 132012 / 133010 → plain-English hints written to
//          communication_logs.error_message so the Campaign Report explains
//          delivery drops instead of showing opaque "Meta API error (400)".
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

type Channel = 'whatsapp' | 'sms' | 'email' | 'in_app';
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
  for (const tk of tryKeys) {
    const v = values[tk];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function templateComponents(keys: string[], values: Record<string, unknown> | undefined): Array<Record<string, unknown>> | null | undefined {
  if (keys.length === 0) return undefined;
  const params = keys.map((key, index) => {
    const text = resolveVarValue(key, values, index);
    // Meta requires non-empty text params; substitute a single space to avoid 132000 errors.
    return { type: 'text', text: text || ' ' };
  });
  return [{ type: 'body', parameters: params }];
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
  const validChannels: Channel[] = ['whatsapp', 'sms', 'email', 'in_app'];
  if (!validChannels.includes(input.channel)) return bad(400, { error: 'invalid_channel' });
  if (!input.payload?.body) return bad(400, { error: 'missing_payload_body' });

  // Normalize phone recipients to E.164 (digits only) for whatsapp/sms.
  // Defaults to India (+91) when no country code is present.
  if (input.channel === 'whatsapp' || input.channel === 'sms') {
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

    try {
      switch (input.channel) {
        case 'whatsapp': {
          let templateName: string | null = null;
          let components: Array<Record<string, unknown>> | null | undefined;
          let templateHeaderType: string | null = null;
          if (input.template_id) {
            const { data: tpl, error: tplError } = await supabase
              .from('templates')
              .select('content, variables, meta_template_name, header_type, attachment_source')
              .eq('id', input.template_id)
              .maybeSingle();
            if (tplError) throw new Error(tplError.message);
            if (tpl?.meta_template_name) {
              templateName = tpl.meta_template_name;
              templateHeaderType = (tpl.header_type ?? 'none').toLowerCase();
              const keys = orderedTemplateKeys(tpl.content ?? input.payload.body, tpl.variables);
              const inferred = inferTemplateValues(tpl.content ?? input.payload.body, input.payload.body, keys);
              const defaults = templateName === 'gym_closure_update' ? gymClosureDefaultValues(keys) : {};
              const baseValues = { ...defaults, ...inferred, ...(input.payload.variables ?? {}) };
              // Only inject signed PDF URL into BODY when there is NO media header.
              // Native document-header templates carry the PDF in the HEADER
              // component — leaking the URL into body would show a "Download: …"
              // line in WhatsApp even though the PDF is already attached.
              const hasMediaHeader = ['document', 'image', 'video'].includes(templateHeaderType);
              const templateValues = hasMediaHeader
                ? baseValues
                : appendAttachmentLinkForBodyOnlyTemplate(keys, baseValues, input.attachment?.url);
              components = templateComponents(keys, templateValues);

              // Build a clean rendered body for audit/inbox display so the
              // signed URL never surfaces in communication_logs / whatsapp_messages.
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

              // Native attachment header: prepend HEADER component when the
              // template was approved with header_type=document/image/video.
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
            }
          }

          // ── 24h-window pre-flight guard ──
          // If we won't be sending an approved Meta template, the recipient
          // must have messaged us within the last 24 hours (Meta customer
          // service window). Otherwise Meta rejects with error 131047
          // ("Re-engagement message"). Fail fast with a clear reason instead.
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
                  status: 'failed',
                  delivery_status: 'failed',
                  error_message: 'Outside 24h customer-service window — an approved WhatsApp template is required. Submit one in Settings → Communication Templates.',
                })
                .eq('id', log!.id);
              return ok({
                status: 'failed',
                log_id: log!.id,
                reason: 'no_active_session_no_template',
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
            },
          });
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

    await supabase
      .from('communication_logs')
      .update({
        delivery_status: sendError ? 'failed' : 'sent',
        status: sendError ? 'failed' : 'sent',
        provider_message_id: providerMessageId ?? null,
        delivery_metadata: Object.keys(finalMeta).length ? finalMeta : null,
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
