// Detects the Website Lead Chatbot's prefilled WhatsApp draft and, when the
// sender's number has no matching CRM lead, tells the AI to ask for the mobile
// number used on the website. Never merges leads by name.
export const WEBSITE_REF_RE = /\bWEB-[A-Z0-9]{6}\b/;

export function websiteHandoffRef(message: string | null | undefined): string | null {
  const m = String(message ?? "").match(WEBSITE_REF_RE);
  return m ? m[0] : null;
}

export function websiteHandoffPrompt(message: string | null | undefined, leadFound: boolean): string | null {
  const ref = websiteHandoffRef(message);
  if (!ref || leadFound) return null;
  return `<website_handoff>
This person started from the Incline website enquiry (reference ${ref}), but this WhatsApp number does not match the mobile number saved on that enquiry.
Politely ask them to share the mobile number they entered on the website so the team can link the enquiry. Do not assume who they are from their name, and do not re-ask details until linked.
</website_handoff>`;
}
