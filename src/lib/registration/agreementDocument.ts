/**
 * Client access to the ONE Membership Registration & Agreement document.
 *
 * The browser never renders this PDF. Every copy — stored, viewed, printed,
 * downloaded — comes from the `membership-agreement` edge function, which uses
 * the single server-side renderer. Opening/printing/downloading never sends
 * any message to the member.
 */
import { supabase } from '@/integrations/supabase/client';
import { downloadBlob, printBlob } from '@/utils/pdfBlob';

export interface AgreementInfo {
  signed: boolean;
  reference: string;
  filename: string;
  path?: string;
  bucket?: string;
  signed_url?: string;
  expires_in?: number;
  signed_at?: string | null;
  terms_version?: string;
  regenerated?: boolean;
}

export interface AgreementDraft {
  government_id_type?: string;
  government_id_number?: string;
  fitness_goals?: string;
  health_conditions?: string;
  par_q?: Record<string, string>;
  acknowledgements?: Record<string, boolean>;
  custom_terms?: string;
}

export interface SignAgreementPayload extends AgreementDraft {
  member_id: string;
  signature_data_url: string;
  consents: Record<string, boolean>;
}

export interface SignAgreementResult {
  ok: true;
  reference: string;
  path: string;
  bucket: string;
  signed_at: string;
  signed_url: string | null;
  filename: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  required_consents_missing: 'Please tick every mandatory acknowledgement before signing.',
  invalid_signature_data_url: 'The signature could not be read — please sign again.',
  invalid_signature_image: 'The signature could not be read — please sign again.',
  signature_too_large: 'The signature image is too large — please clear and sign again.',
  forbidden: 'You do not have access to this member’s agreement.',
  member_not_found: 'Member record not found.',
  Unauthorized: 'Please sign in again.',
  Forbidden: 'You do not have access to this member’s agreement.',
  agreement_render_failed: 'The agreement could not be generated. Please try again.',
  signature_upload_failed: 'The signature could not be saved. Please try again.',
  signature_record_failed: 'The signature record could not be saved. Please try again.',
};

function describe(code: unknown, fallback = 'Something went wrong with the agreement'): string {
  const key = String(code ?? '');
  return ERROR_MESSAGES[key] ?? (key ? key.replace(/_/g, ' ') : fallback);
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('membership-agreement', { body });
  if (error) {
    let message = error.message || 'Request failed';
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const payload = (await ctx.clone().json()) as { error?: string; detail?: string };
        if (payload?.error) message = describe(payload.error);
      } catch {
        /* non-JSON error body */
      }
    }
    throw new Error(message);
  }
  const payload = data as (T & { error?: string }) | null;
  if (!payload) throw new Error('Empty response from the agreement service');
  if (payload.error) throw new Error(describe(payload.error));
  return payload;
}

/** Metadata + short-lived link for the member's stored agreement (renders it first if missing). */
export function fetchAgreement(memberId: string): Promise<AgreementInfo> {
  return invoke<AgreementInfo>({ action: 'get', member_id: memberId });
}

async function fetchAgreementBlob(memberId: string): Promise<{ blob: Blob; info: AgreementInfo }> {
  const info = await fetchAgreement(memberId);
  if (!info.signed || !info.signed_url) throw new Error('No signed agreement on file yet.');
  const res = await fetch(info.signed_url);
  if (!res.ok) throw new Error('Could not load the agreement file.');
  return { blob: await res.blob(), info };
}

function base64ToBlob(b64: string, type = 'application/pdf'): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Unsigned DRAFT with the staff member's in-progress edits — never stored. */
export async function previewAgreementBlob(
  memberId: string,
  draft: AgreementDraft,
): Promise<{ blob: Blob; filename: string }> {
  const res = await invoke<{ pdf_base64: string; filename: string }>({
    action: 'preview',
    member_id: memberId,
    draft,
  });
  return { blob: base64ToBlob(res.pdf_base64), filename: res.filename };
}

export function signAgreement(payload: SignAgreementPayload): Promise<SignAgreementResult> {
  return invoke<SignAgreementResult>({ action: 'sign', ...payload });
}

export async function openAgreement(memberId: string): Promise<void> {
  const info = await fetchAgreement(memberId);
  if (!info.signed || !info.signed_url) throw new Error('No signed agreement on file yet.');
  window.open(info.signed_url, '_blank', 'noopener');
}

export async function printAgreement(memberId: string): Promise<void> {
  const { blob } = await fetchAgreementBlob(memberId);
  printBlob(blob);
}

export async function downloadAgreement(memberId: string): Promise<void> {
  const { blob, info } = await fetchAgreementBlob(memberId);
  downloadBlob(blob, info.filename);
}
