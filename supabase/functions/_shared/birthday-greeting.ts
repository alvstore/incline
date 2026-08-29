// v1.0.0 — canonical birthday greeting sender.
//
// One place decides HOW a birthday wish goes out so the dashboard "Greet"
// button and the nightly `builtin:birthday_wish` automation behave identically:
//
//   1. WhatsApp  — when the person has a phone (branded image + approved
//                  `member_birthday_wish` template via event_key='birthday').
//   2. Email     — when there is no phone (or WhatsApp is suppressed) and an
//                  email exists; branded HTML shell with the same card image.
//   3. In-app    — always, so the greeting shows in the member portal too.
//
// Everything routes through `dispatch-communication`, which owns template
// resolution, member preferences, quiet hours and communication_logs.

export const BIRTHDAY_CARD_URL =
  "https://iyqqpbvnszyrrgerniog.supabase.co/storage/v1/object/public/template-media/birthday%2Fincline-birthday-card.jpg";

export type BirthdayPersonType = "member" | "trainer" | "staff";

export interface BirthdayTarget {
  user_id: string;
  person_type?: BirthdayPersonType;
  /** members.id when person_type === 'member' */
  person_id?: string | null;
  branch_id?: string | null;
  full_name?: string | null;
}

export interface BirthdayChannelResult {
  channel: "whatsapp" | "email" | "in_app";
  status: string;
  reason?: string;
}

export interface BirthdayGreetingResult {
  name: string;
  results: BirthdayChannelResult[];
  /** true when at least one external channel (whatsapp/email) went out */
  delivered: boolean;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** IST calendar date (YYYY-MM-DD) — birthdays are an Asia/Kolkata concept. */
export function istToday(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function dispatch(payload: Record<string, unknown>): Promise<{ status: string; reason?: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/dispatch-communication`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let parsed: { status?: string; reason?: string } = {};
    try { parsed = JSON.parse(text); } catch { /* non-json */ }
    if (!res.ok) return { status: "failed", reason: parsed.reason ?? text.slice(0, 200) };
    return { status: parsed.status ?? "sent", reason: parsed.reason };
  } catch (e) {
    return { status: "failed", reason: (e as Error).message };
  }
}

function defaultBody(name: string): string {
  return `Happy birthday, ${name}! 🎉 Wishing you a year of strength, energy and progress. From all of us at The Incline Life by Incline — Rise. Reflect. Repeat.`;
}

function emailHtml(name: string, body: string): string {
  return `
    <div style="text-align:center">
      <img src="${BIRTHDAY_CARD_URL}" alt="Happy Birthday from Incline" width="520" style="max-width:100%;border-radius:16px;margin-bottom:20px" />
    </div>
    <h2 style="color:#4f46e5;margin:0 0 12px">Happy Birthday, ${name}! 🎂</h2>
    <p style="font-size:15px;line-height:1.6;color:#334155;margin:0">${body}</p>
  `;
}

/**
 * Resolve contact details and send the greeting. Safe to call repeatedly —
 * the dedupe key is per person per IST day.
 */
export async function sendBirthdayGreeting(
  admin: {
    from: (t: string) => any;
  },
  target: BirthdayTarget,
  opts: { body?: string; source_caller?: string } = {},
): Promise<BirthdayGreetingResult> {
  const { data: profile } = await admin
    .from("profiles")
    .select("id, full_name, phone, email")
    .eq("id", target.user_id)
    .maybeSingle();

  const name = (target.full_name ?? profile?.full_name ?? "there").split(" ")[0] || "there";
  const phone: string | null = profile?.phone ?? null;
  const email: string | null = profile?.email ?? null;

  let branchId = target.branch_id ?? null;
  if (!branchId) {
    const { data: b } = await admin.from("branches").select("id").eq("is_active", true).limit(1).maybeSingle();
    branchId = b?.id ?? null;
  }
  if (!branchId) {
    return { name, delivered: false, results: [{ channel: "in_app", status: "failed", reason: "no_branch" }] };
  }

  const body = opts.body?.trim() || defaultBody(name);
  const day = istToday();
  const memberId = target.person_type === "member" ? target.person_id ?? null : null;
  const base = {
    branch_id: branchId,
    category: "announcement" as const,
    member_id: memberId,
    user_id: target.user_id,
    source_caller: opts.source_caller ?? "birthday-greeting",
    source_type: "automation" as const,
  };
  const variables = { name, first_name: name, event_key: "birthday" };

  const results: BirthdayChannelResult[] = [];
  let delivered = false;

  if (phone) {
    const r = await dispatch({
      ...base,
      channel: "whatsapp",
      recipient: phone,
      payload: { body, variables },
      attachment: {
        url: BIRTHDAY_CARD_URL,
        filename: "incline-birthday.jpg",
        content_type: "image/jpeg",
        kind: "image",
      },
      dedupe_key: `birthday_wish:${target.user_id}:${day}:whatsapp`,
    });
    results.push({ channel: "whatsapp", ...r });
    if (r.status === "sent" || r.status === "queued") delivered = true;
  }

  if (email && !delivered) {
    const r = await dispatch({
      ...base,
      channel: "email",
      recipient: email,
      payload: {
        subject: `Happy Birthday, ${name}! 🎉`,
        body: emailHtml(name, body),
        variables,
        use_branded_template: true,
      },
      dedupe_key: `birthday_wish:${target.user_id}:${day}:email`,
    });
    results.push({ channel: "email", ...r });
    if (r.status === "sent" || r.status === "queued") delivered = true;
  }

  const inApp = await dispatch({
    ...base,
    channel: "in_app",
    recipient: target.user_id,
    payload: { subject: "🎂 Happy Birthday!", body, variables },
    dedupe_key: `birthday_wish:${target.user_id}:${day}:in_app`,
  });
  results.push({ channel: "in_app", ...inApp });

  return { name, delivered, results };
}
