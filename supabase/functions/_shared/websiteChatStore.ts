// _shared/websiteChatStore.ts
// v1.1.0 — Website chat → CRM inbox. Stores visitor/concierge turns in whatsapp_messages and
// one whatsapp_chat_settings thread with platform='web_chat', linked to the captured lead.
// Thread key is a synthetic "+00…" number derived from the lead id (never a real phone), so it
// can never collide with or be messaged as the visitor's WhatsApp thread.

// deno-lint-ignore no-explicit-any
type Db = any;
import { captureEdgeError } from "./capture-edge-error.ts";

/** source_type must match whatsapp_messages_source_type_check (inbound/ai). */
export function webTurnSourceType(from: "user" | "bot"): "inbound" | "ai" {
  return from === "user" ? "inbound" : "ai";
}

export type StoredTurn = { from: "user" | "bot"; text: string };

export function webChatKey(leadId: string): string {
  const hex = leadId.replace(/-/g, "").slice(0, 12);
  return `+00${BigInt(`0x${hex}`).toString().padStart(15, "0")}`;
}

export function isWebChatKey(phone: string): boolean {
  return /^\+00\d{15}$/.test(phone);
}

export async function ensureWebThread(db: Db, lead: { id: string; branch_id: string; full_name?: string | null }) {
  const key = webChatKey(lead.id);
  const { error } = await db.from("whatsapp_chat_settings").upsert({
    branch_id: lead.branch_id, phone_number: key, platform: "web_chat", captured_lead_id: lead.id,
    contact_name: lead.full_name ?? "Website visitor", is_unread: true,
    // bot_active is never set here: a staff pause must survive new visitor messages.
    // Not a deliverable channel: keeps nurture/broadcast workers from ever targeting this thread.
    do_not_contact: true, do_not_contact_reason: "web_chat_thread",
    updated_at: new Date().toISOString(),
  }, { onConflict: "branch_id,phone_number" });
  if (error) await captureEdgeError("capture-lead", `web_chat thread upsert failed: ${error.code ?? "unknown"} ${error.message ?? ""}`, { branch_id: lead.branch_id, context: { fingerprint: "web_chat_store", step: "thread" } });
  return key;
}

export async function storeTurns(
  db: Db, lead: { id: string; branch_id: string; full_name?: string | null }, turns: StoredTurn[],
) {
  const clean = turns.map((t) => ({ from: t.from, text: String(t.text ?? "").slice(0, 1000).trim() })).filter((t) => t.text);
  if (!clean.length) return;
  const key = await ensureWebThread(db, lead);
  const base = Date.now();
  const rows = clean.map((t, i) => {
    const at = new Date(base + i).toISOString();
    return {
      branch_id: lead.branch_id, phone_number: key, platform: "web_chat",
      contact_name: t.from === "user" ? (lead.full_name ?? "Website visitor") : "Incline Concierge",
      content: t.text, message_type: "text", direction: t.from === "user" ? "inbound" : "outbound",
      status: t.from === "user" ? "received" : "delivered", source_type: webTurnSourceType(t.from),
      created_at: at, sent_at: t.from === "bot" ? at : null,
    };
  });
  const { error } = await db.from("whatsapp_messages").insert(rows);
  if (error) {
    console.error("[web-chat] store failed:", error.code ?? "unknown");
    await captureEdgeError("capture-lead", `web_chat message insert failed: ${error.code ?? "unknown"} ${error.message ?? ""}`, { branch_id: lead.branch_id, context: { fingerprint: "web_chat_store", step: "messages", rows: rows.length } });
  }
}
