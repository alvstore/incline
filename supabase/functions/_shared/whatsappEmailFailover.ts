// v1.0.0 — Asynchronous WhatsApp → Email failover.
// When Meta accepts a WhatsApp message but later reports it undelivered
// (131049 marketing pacing, 131026 not on WhatsApp), the member would
// otherwise silently miss the notice. This sends the same text by email
// through the dispatcher, once, unless an email already went out for it.

// deno-lint-ignore no-explicit-any
type Db = any;

export const FAILOVER_CODES = new Set(["131049", "131026", "130472"]);
const SKIP_CATEGORIES = new Set(["marketing", "otp", "auth"]);

export function shouldFailover(code: string | null | undefined, category: string | null | undefined): boolean {
  if (!code || !FAILOVER_CODES.has(String(code))) return false;
  if (!category || SKIP_CATEGORIES.has(category)) return false;
  return true;
}

export async function failoverToEmail(db: Db, logId: string, code: string): Promise<string> {
  const { data: log } = await db
    .from("communication_logs")
    .select("id, branch_id, member_id, user_id, category, content, subject, dedupe_key, created_at")
    .eq("id", logId)
    .maybeSingle();
  if (!log) return "no_log";
  if (!shouldFailover(code, log.category)) return "not_eligible";
  if (!log.content || !log.member_id) return "no_content_or_member";

  // Already emailed for this event (parallel send or earlier failover)?
  const since = new Date(new Date(log.created_at).getTime() - 2 * 3600_000).toISOString();
  const { data: prior } = await db
    .from("communication_logs")
    .select("id")
    .eq("channel", "email")
    .eq("member_id", log.member_id)
    .eq("category", log.category)
    .gte("created_at", since)
    .in("status", ["sent", "delivered", "queued", "pending"])
    .limit(1);
  if (prior && prior.length) return "email_already_sent";

  const { data: member } = await db.from("members").select("user_id").eq("id", log.member_id).maybeSingle();
  const uid = member?.user_id ?? log.user_id;
  if (!uid) return "no_user";
  const { data: prof } = await db.from("profiles").select("email").eq("id", uid).maybeSingle();
  const email = prof?.email;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "no_email";

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return "no_env";
  const res = await fetch(`${url}/functions/v1/dispatch-communication`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
    body: JSON.stringify({
      branch_id: log.branch_id,
      channel: "email",
      category: log.category,
      recipient: email,
      member_id: log.member_id,
      user_id: uid,
      payload: { subject: log.subject || "An update from Incline", body: log.content },
      dedupe_key: `${log.dedupe_key ?? log.id}:email_failover`,
    }),
  });
  return res.ok ? "email_dispatched" : `dispatch_${res.status}`;
}
