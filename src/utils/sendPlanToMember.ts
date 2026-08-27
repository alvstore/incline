// Unified helper that takes a plan + member contact, generates a styled PDF,
// uploads it to the `attachments` bucket, and dispatches via the requested
// channels (download / WhatsApp document / email attachment).
//
// Used by:
//   - Member Plans hub (per-row send)
//   - Templates page (preview-as-PDF, send template to member)
//   - AssignPlanDrawer "Send PDF on assign" toggle
//
// All channels are best-effort: the function returns a per-channel result so
// the UI can show partial success without throwing.

import { supabase } from '@/integrations/supabase/client';
import { buildPlanPdf } from './pdfBlob';
import { uploadAttachment } from './uploadAttachment';
import { dispatchCommunication } from '@/services/preferencesService';
import { findTemplate } from '@/lib/templates/dynamicAttachment';
import { buildDedupeKey } from '@/lib/comms/dispatch';

export type PlanSendChannel = 'download' | 'whatsapp' | 'email';

export interface PlanSendInput {
  member: {
    id: string;
    full_name: string;
    phone?: string | null;
    email?: string | null;
  };
  plan: {
    name: string;
    type: 'workout' | 'diet';
    description?: string | null;
    data: any;
    valid_from?: string | null;
    valid_until?: string | null;
    trainer_name?: string | null;
    schedule_offset_days?: number;
  };
  branchId?: string | null;
  channels: PlanSendChannel[];
}

export type WhatsAppSendMode = 'template_document' | 'native_document' | 'link';

export interface PlanSendResult {
  pdfUrl?: string;
  pdfBlob?: Blob;
  channels: Partial<
    Record<PlanSendChannel, { sent: boolean; error?: string; mode?: WhatsAppSendMode }>
  >;
}

function safeFilename(plan: PlanSendInput['plan']) {
  const safeName = plan.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  return `${plan.type === 'workout' ? 'Workout' : 'Diet'}-Plan-${safeName}.pdf`;
}

function normalisePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.startsWith('91') && digits.length === 12) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  return digits.startsWith('+') ? digits : `+${digits}`;
}

export async function sendPlanToMember(input: PlanSendInput): Promise<PlanSendResult> {
  const channels: PlanSendResult['channels'] = {};
  const memberName = input.member.full_name.trim() || 'Member';
  const planName = input.plan.name.trim() || `${input.plan.type === 'workout' ? 'Workout' : 'Diet'} plan`;
  let branchName = 'The Incline';
  if (input.branchId) {
    const { data: branch } = await supabase.from('branches').select('name').eq('id', input.branchId).maybeSingle();
    if (branch?.name) branchName = branch.name;
  }

  // 1. Always build the PDF (cheap, all paths need it).
  const pdfBlob = await buildPlanPdf({
    name: input.plan.name,
    type: input.plan.type,
    description: input.plan.description ?? undefined,
    member_name: memberName,
    trainer_name: input.plan.trainer_name ?? undefined,
    branch_id: input.branchId ?? undefined,
    branch_name: branchName,
    schedule_offset_days: input.plan.schedule_offset_days ?? 0,
    data: input.plan.data,
  });
  const filename = safeFilename(input.plan);

  // 2. Download channel = trigger browser download right here.
  if (input.channels.includes('download')) {
    try {
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      channels.download = { sent: true };
    } catch (err: any) {
      channels.download = { sent: false, error: err?.message || 'Download failed' };
    }
  }

  // 3. Anything network-bound needs the upload.
  let pdfUrl: string | undefined;
  const needsUpload =
    input.channels.includes('whatsapp') || input.channels.includes('email');
  if (needsUpload) {
    try {
      const { url } = await uploadAttachment(pdfBlob, {
        folder: `fitness-plans/${input.member.id}`,
        filename,
        contentType: 'application/pdf',
      });
      pdfUrl = url;
    } catch (err: any) {
      const msg = err?.message || 'PDF upload failed';
      if (input.channels.includes('whatsapp')) channels.whatsapp = { sent: false, error: msg };
      if (input.channels.includes('email')) channels.email = { sent: false, error: msg };
    }
  }

  // 4. WhatsApp document — routed through canonical dispatcher using an
  //    approved Meta template (Meta blocks freeform messages outside the 24h
  //    customer-service window with error 131047).
  if (input.channels.includes('whatsapp') && pdfUrl) {
    if (!input.member.phone) {
      channels.whatsapp = { sent: false, error: 'No phone on file' };
    } else if (!input.branchId) {
      channels.whatsapp = { sent: false, error: 'No branch context' };
    } else {
      try {
        const phone = normalisePhone(input.member.phone);
        const triggerEvent = input.plan.type === 'workout' ? 'workout_plan_ready' : 'diet_plan_ready';
        // Resolve approved template (branch first, then global fallback).
        const template = await findTemplate({
          branchId: input.branchId,
          type: 'whatsapp',
          triggerEvent,
          preferAttachment: true,
        });
        const hasDocHeader = (template?.header_type || 'none') === 'document';
        const attachCaption = `Hi ${memberName}, your ${input.plan.type} plan "${planName}" is attached as a PDF.`;
        const linkCaption = `Hi ${memberName}, here is your new ${input.plan.type} plan: ${planName}\n\nDownload: ${pdfUrl}`;
        const baseVars = {
           '1': memberName,
           '2': planName,
           '3': branchName,
          member_name: memberName,
           full_name: memberName,
           first_name: memberName.split(/\s+/)[0] || memberName,
           recipient_name: memberName,
          plan_name: planName,
          plan_title: planName, // alias for legacy templates
          plan_type: input.plan.type,
          trainer_name: input.plan.trainer_name || 'your trainer',
          valid_until: input.plan.valid_until || '',
          branch_name: branchName,
          event_key: triggerEvent,
        };

        const send = async (opts: { templateId?: string; caption: string; link?: boolean }) =>
          dispatchCommunication({
            branch_id: input.branchId!,
            channel: 'whatsapp',
            category: 'transactional',
            recipient: phone,
            member_id: input.member.id,
            template_id: opts.templateId,
            payload: {
              body: opts.caption,
              variables: { ...baseVars, ...(opts.link ? { document_link: pdfUrl } : {}) },
            },
            dedupe_key: buildDedupeKey(['plan', input.member.id, input.plan.type, planName, input.plan.valid_from || 'current', opts.link ? 'link' : 'document']),
            force: true,
            attachment: { url: pdfUrl, filename, content_type: 'application/pdf', kind: 'document' },
          });

        const failed = (r: any) => r.status === 'failed' || r.status === 'suppressed';

        if (hasDocHeader) {
          // Approved document-header template → native PDF attachment.
          const result = await send({ templateId: template!.id, caption: attachCaption });
          channels.whatsapp = failed(result)
            ? { sent: false, error: result.reason || result.status, mode: 'template_document' }
            : { sent: true, mode: 'template_document' };
        } else {
          // No approved document template: try a native document message first
          // (works inside the 24h service window), then fall back to the link
          // template so the member still receives the plan.
          const native = await send({ caption: attachCaption });
          if (!failed(native)) {
            channels.whatsapp = { sent: true, mode: 'native_document' };
          } else {
            const linkResult = await send({
              templateId: template?.id,
              caption: linkCaption,
              link: true,
            });
            channels.whatsapp = failed(linkResult)
              ? { sent: false, error: linkResult.reason || linkResult.status, mode: 'link' }
              : { sent: true, mode: 'link' };
          }
        }
      } catch (err: any) {
        channels.whatsapp = { sent: false, error: err?.message || 'WhatsApp failed' };
      }

    }
  }

  // 5. Email attachment — routed through canonical dispatcher
  if (input.channels.includes('email') && pdfUrl) {
    if (!input.member.email) {
      channels.email = { sent: false, error: 'No email on file' };
    } else if (!input.branchId) {
      channels.email = { sent: false, error: 'No branch context' };
    } else {
      try {
        const subject = `Your new ${input.plan.type} plan: ${input.plan.name}`;
        const html = `
          <p>Hi ${input.member.full_name},</p>
          <p>Your ${input.plan.trainer_name ? `trainer <b>${input.plan.trainer_name}</b>` : 'trainer'} has assigned you a new <b>${input.plan.type}</b> plan: <b>${input.plan.name}</b>.</p>
          ${input.plan.valid_until ? `<p>Valid until <b>${input.plan.valid_until}</b>.</p>` : ''}
          <p>The full plan is attached as a PDF. You can also <a href="${pdfUrl}">open it online</a>.</p>
          <p>— Team Incline</p>`;
        const result = await dispatchCommunication({
          branch_id: input.branchId,
          channel: 'email',
          category: 'transactional',
          recipient: input.member.email,
          member_id: input.member.id,
          payload: { subject, body: html, use_branded_template: true },
          dedupe_key: `plan:${input.member.id}:${input.plan.type}:${input.plan.name}:email`,
          force: true,
          attachment: { url: pdfUrl, filename, content_type: 'application/pdf', kind: 'document' },
        });
        if (result.status === 'failed' || result.status === 'suppressed') {
          channels.email = { sent: false, error: result.reason || result.status };
        } else {
          channels.email = { sent: true };
        }
      } catch (err: any) {
        channels.email = { sent: false, error: err?.message || 'Email failed' };
      }
    }
  }

  return { pdfUrl, pdfBlob, channels };
}
