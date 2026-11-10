// Pure helpers for contract-signing OTP channel selection (unit-tested).
export type OtpChannel = "whatsapp" | "sms" | "email";

export interface ChannelInputs {
  hasPhone: boolean;
  hasEmail: boolean;
  whatsappTemplateApproved: boolean;
  smsProviderActive: boolean;
}

/** Only channels that can actually deliver a code right now. */
export function availableChannels(i: ChannelInputs): OtpChannel[] {
  const out: OtpChannel[] = [];
  if (i.hasPhone && i.whatsappTemplateApproved) out.push("whatsapp");
  if (i.hasPhone && i.smsProviderActive) out.push("sms");
  if (i.hasEmail) out.push("email");
  return out;
}

/** Requested channel first, then the remaining available ones as fallbacks. */
export function deliveryOrder(requested: OtpChannel, available: OtpChannel[]): OtpChannel[] {
  if (!available.includes(requested)) return [...available];
  return [requested, ...available.filter((c) => c !== requested)];
}

const OK = new Set(["sent", "queued", "delivered", "accepted"]);
/** dispatch-communication returns 200 even when it suppresses/fails a send. */
export function dispatchSucceeded(data: unknown): boolean {
  const s = (data as { status?: unknown } | null)?.status;
  return typeof s === "string" && OK.has(s);
}
