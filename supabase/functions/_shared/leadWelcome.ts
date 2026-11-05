// Which prospect-facing welcome channels notify-lead-created may dispatch.
// Website-chatbot captures pass suppress=true: the visitor starts WhatsApp
// themselves, so no unsolicited WhatsApp/SMS/email reaches them first.
export type WelcomeRules = { sms_to_lead?: boolean | null; whatsapp_to_lead?: boolean | null; email_to_lead?: boolean | null };

export function leadWelcomeChannels(
  rules: WelcomeRules,
  lead: { phone?: string | null; email?: string | null },
  suppress: boolean,
): Array<"sms" | "whatsapp" | "email"> {
  if (suppress) return [];
  const out: Array<"sms" | "whatsapp" | "email"> = [];
  if (rules.sms_to_lead && lead.phone) out.push("sms");
  if (rules.whatsapp_to_lead && lead.phone) out.push("whatsapp");
  if (rules.email_to_lead && lead.email) out.push("email");
  return out;
}
