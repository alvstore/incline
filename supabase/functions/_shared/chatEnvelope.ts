// v1.0.0 — Shared chat envelope parser.
//
// The AI brain occasionally returns a STRUCTURED envelope as `replyText` so
// downstream senders can render rich messages:
//   • {"type":"interactive_list","body":"…","button":"…","sections":[…]}
//   • {"type":"interactive","body":"…","buttons":[…]}                (canonical)
//   • {"type":"interactive","interactive":{"type":"list"|"button",…}} (Meta-native)
//   • {"status":"lead_captured","data":{…}}                          (control payload)
//
// WhatsApp Cloud API supports the native interactive shapes; Meta IG/Messenger
// DMs DO NOT. If the raw JSON is sent verbatim to IG/Messenger, the user
// literally sees `{"type":"interactive_list",…}` in the DM.
//
// This module is the single source of truth for:
//   1. parseChatEnvelope()    → detects and parses any envelope embedded in text
//   2. renderInteractiveAsText() → human-readable fallback for channels without
//                                  rich interactive support (IG/Messenger DMs)
//   3. stripStrayJson()       → last-mile guard, removes leftover JSON blobs
//
// IMPORTANT: never alter behaviour for WhatsApp — it still uses the parsed
// payload to send native interactive messages. This module just exposes the
// parsing so meta-webhook can detect-and-flatten the same envelopes for IG/FB.

export interface InteractiveListParsed {
  type: "interactive_list";
  body: string;
  button?: string;
  sections: Array<{ title?: string; rows: Array<{ id: string; title: string; description?: string }> }>;
}

export interface InteractiveButtonsParsed {
  type: "interactive";
  body: string;
  buttons: string[];
}

export interface LeadCapturedParsed {
  type: "lead_captured";
  data: Record<string, unknown>;
}

export type Envelope = InteractiveListParsed | InteractiveButtonsParsed | LeadCapturedParsed;

export interface ParseResult {
  envelope: Envelope | null;
  /** Prose surrounding the envelope (envelope removed). Empty if the whole input was JSON. */
  proseText: string;
}

/** Normalise Meta-native interactive shape into our canonical shape. */
function normalizeMetaNative(p: any): any {
  if (!p || typeof p !== "object") return p;
  if (p.type === "interactive" && p.interactive && !p.buttons && !p.sections) {
    const inner = p.interactive;
    const bodyText = typeof inner?.body === "string" ? inner.body : (inner?.body?.text || "");
    if (inner?.type === "list" && Array.isArray(inner?.action?.sections)) {
      return {
        type: "interactive_list",
        body: bodyText,
        button: inner.action.button || "Select",
        sections: inner.action.sections,
      };
    }
    if (inner?.type === "button" && Array.isArray(inner?.action?.buttons)) {
      return {
        type: "interactive",
        body: bodyText,
        buttons: inner.action.buttons
          .map((b: any) => b?.reply?.title || b?.title)
          .filter(Boolean),
      };
    }
  }
  return p;
}

function classify(p: any): Envelope | null {
  if (!p || typeof p !== "object") return null;
  if (p.type === "interactive_list" && Array.isArray(p.sections)) {
    return {
      type: "interactive_list",
      body: typeof p.body === "string" ? p.body : "",
      button: typeof p.button === "string" ? p.button : "Select",
      sections: p.sections,
    };
  }
  if (p.type === "interactive" && Array.isArray(p.buttons)) {
    return {
      type: "interactive",
      body: typeof p.body === "string" ? p.body : "",
      buttons: p.buttons.map((b: any) => String(b)).filter(Boolean),
    };
  }
  if (p.status === "lead_captured" && p.data && typeof p.data === "object") {
    return { type: "lead_captured", data: p.data };
  }
  return null;
}

/**
 * Parse a reply string and extract any chat envelope (interactive list/buttons
 * or lead_captured control payload). Returns the envelope plus any surrounding
 * prose with the JSON removed.
 */
export function parseChatEnvelope(text: string): ParseResult {
  if (!text || typeof text !== "string") return { envelope: null, proseText: text || "" };

  const tryParse = (s: string) => {
    try { return normalizeMetaNative(JSON.parse(s)); } catch { return null; }
  };

  // 1) whole string is the JSON
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    const p = tryParse(trimmed);
    const env = classify(p);
    if (env) return { envelope: env, proseText: env.type === "lead_captured" ? "" : (env as any).body || "" };
  }

  // 2) JSON in markdown fence
  const fenceMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenceMatch) {
    const env = classify(tryParse(fenceMatch[1]));
    if (env) {
      const prose = text.replace(fenceMatch[0], "").trim();
      return { envelope: env, proseText: prose || (env.type === "lead_captured" ? "" : (env as any).body || "") };
    }
  }

  // 3) brace-balanced extractor — find embedded `{"type":"interactive…"}` or `{"status":"lead_captured"}`
  const typeMarkerRe = /\{[\s\n]*"(?:type|status)"\s*:\s*"(?:interactive(?:_list)?|lead_captured)"/;
  const m = text.match(typeMarkerRe);
  if (m && typeof m.index === "number") {
    const start = m.index;
    let depth = 0, inString = false, escape = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const slice = text.slice(start, i + 1);
          const env = classify(tryParse(slice));
          if (env) {
            const prose = (text.slice(0, start) + text.slice(i + 1)).trim();
            return { envelope: env, proseText: prose || (env.type === "lead_captured" ? "" : (env as any).body || "") };
          }
          break;
        }
      }
    }
  }
  return { envelope: null, proseText: text };
}

/**
 * Render an interactive envelope as plain text for channels that do not
 * support WhatsApp-style interactive lists/buttons (Instagram & Messenger
 * DMs). Returns a single string with the body and numbered options.
 */
export function renderInteractiveAsText(env: InteractiveListParsed | InteractiveButtonsParsed): string {
  if (env.type === "interactive_list") {
    const rows = env.sections.flatMap((s) => s.rows || []);
    if (!rows.length) return env.body || "Got it — one moment.";
    const list = rows.map((r, i) => `${i + 1}. ${r.title}`).join("\n");
    return env.body ? `${env.body}\n${list}` : list;
  }
  // buttons
  if (!env.buttons?.length) return env.body || "Got it — one moment.";
  const list = env.buttons.map((b, i) => `${i + 1}. ${b}`).join("\n");
  return env.body ? `${env.body}\n${list}` : list;
}

/**
 * Last-mile guard: strip any leftover JSON blob that looks like a control
 * envelope from arbitrary text. Use after parseChatEnvelope() in case the LLM
 * wrapped the JSON in additional prose our parser missed.
 */
export function stripStrayJson(text: string): string {
  if (!text) return text;
  let out = text;
  // remove fenced code blocks
  out = out.replace(/```[\s\S]*?```/g, "");
  // remove top-level JSON blobs containing "type":"interactive…" or "status":"lead_captured"
  out = out.replace(
    /\{[\s\S]*?"(?:type|status)"\s*:\s*"(?:interactive(?:_list)?|lead_captured)"[\s\S]*?\}\s*\}?/gi,
    "",
  );
  return out.trim();
}

/**
 * Convenience: take any `replyText` and return a plain-text version safe to
 * send on a channel that does NOT support rich interactive shapes. Used by
 * meta-webhook (Instagram / Messenger DMs) before insert + send.
 */
export function flattenReplyForPlainText(replyText: string): string {
  const { envelope, proseText } = parseChatEnvelope(replyText);
  if (envelope) {
    if (envelope.type === "lead_captured") {
      // Control payload — never user-visible. Fall back to surrounding prose.
      const cleaned = stripStrayJson(proseText);
      return cleaned || "Got it — one moment.";
    }
    return renderInteractiveAsText(envelope);
  }
  const cleaned = stripStrayJson(replyText);
  return cleaned || "Got it — one moment.";
}
