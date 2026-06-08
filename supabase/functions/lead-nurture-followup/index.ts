// v8.1.0 — Honour UI ops fields (delay_hours / max_retries / cooldown_hours).
//
// Cadence is driven ONLY by fields exposed in HandleOpsSettings:
//   • delay_hours   — wait before the first nudge after last outbound
//   • cooldown_hours — wait between subsequent nudges
//   • max_retries   — total nudges per lead
// The WhatsApp 24h freeform window is a protocol constant (not tunable);
// outside it we skip silently and stamp `last_nurture_at`. No template path.
// Brain prompt still receives `attempt: N/MAX` so tone scales across retries.
//
// v8.0.0 — Freeform-only + schedule_minutes/window_hours (replaced by v8.1.0).
// v7.0.0 — DB-driven angle rotation + similarity dedupe + dynamic content.
// v6.1.0 — service-role auth gate added (cron-only).
// v6.0.0 — SSOT from ai_purposes.ops_config.
// v5.0.0 — persona/brain via buildSystemPrompt().

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateOnce } from "../_shared/ai-runtime.ts";
import { buildSystemPrompt } from "../_shared/ai-prompt.ts";
const serve = Deno.serve;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-system-call",
};

// ─── helpers ────────────────────────────────────────────────────────────────

function normaliseForHash(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, "")
    .trim();
}

async function sha1(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashMessage(s: string): Promise<string> {
  return sha1(normaliseForHash(s));
}

interface Angle {
  slug: string;
  label: string;
  tone: string;
  prompt_hint: string;
  fallback_template: string;
}

function renderFallback(tpl: string, name: string): string {
  return tpl.replace(/\{name\}/g, name);
}

async function pickAngle(supabase: any, chatId: string): Promise<Angle | null> {
  const { data, error } = await supabase.rpc("pick_next_nurture_angle", { _chat_id: chatId });
  if (error) {
    console.warn("[lead-nurture] pick_next_nurture_angle failed:", error.message);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row ? (row as Angle) : null;
}

async function lastNurtureHashes(
  supabase: any,
  branchId: string | null,
  phone: string,
  limit = 3,
): Promise<string[]> {
  const { data } = await supabase
    .from("whatsapp_messages")
    .select("content")
    .eq("phone_number", phone)
    .eq("branch_id", branchId)
    .eq("direction", "outbound")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!data?.length) return [];
  return Promise.all(data.map((r: { content: string }) => hashMessage(r.content || "")));
}

async function pickDynamicUsps(
  supabase: any,
  branchId: string | null,
  count = 2,
): Promise<string[]> {
  // Look for ai_knowledge rows tagged 'usp' / 'offering' / 'facility'.
  const { data } = await supabase
    .from("ai_knowledge")
    .select("title, tags, branch_id")
    .eq("is_active", true)
    .eq("status", "active")
    .or(branchId ? `branch_id.is.null,branch_id.eq.${branchId}` : "branch_id.is.null")
    .overlaps("tags", ["usp", "offering", "facility"]);
  const titles = (data ?? [])
    .map((r: { title: string }) => (r.title || "").trim().toLowerCase())
    .filter((t: string) => t.length > 0 && t.length < 60);
  if (!titles.length) return ["personal training", "recovery zone"];
  // shuffle and take `count`
  const shuffled = [...titles].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

async function generateNurture(opts: {
  supabase: any;
  branchId: string | null;
  angle: Angle;
  prospectName: string;
  partialData: Record<string, unknown> | null;
  leadKnown: boolean;
  recentHashes: string[];
  recentTexts: string[];
  attempt: number;       // 1-indexed retry number for this lead
  maxAttempts: number;
  extraDiversityHint?: string;
}): Promise<string | null> {
  const { supabase, branchId, angle, prospectName, partialData, leadKnown, recentTexts, attempt, maxAttempts, extraDiversityHint } = opts;

  const missing: string[] = [];
  if (!partialData?.email && !leadKnown) missing.push("email");
  if (!partialData?.name && !leadKnown) missing.push("name");
  if (!partialData?.goal) missing.push("fitness goal");

  // Intensity ladder by attempt — DB angle still drives content; this just
  // tells the model how warm vs how direct to be.
  const intensityHint = attempt === 1
    ? "This is the FIRST follow-up — keep it light, welcoming, almost no ask."
    : attempt === 2
      ? "This is the SECOND follow-up — slightly more direct, one clear soft CTA."
      : "This is the FINAL follow-up — kind but more deliberate; offer a concrete next step (tour / callback).";

  const ctx = [
    `Prospect: ${prospectName}.`,
    `Attempt: ${attempt} of ${maxAttempts}. ${intensityHint}`,
    partialData ? `Partial lead data: ${JSON.stringify(partialData)}` : "",
    missing.length ? `Missing fields: ${missing.join(", ")}.` : "",
    `\nAngle: ${angle.label} (slug=${angle.slug}, tone=${angle.tone}).`,
    `Angle instruction: ${angle.prompt_hint}`,
    "",
    "Hard rules for this nurture message:",
    "- ONE short WhatsApp message, max 320 characters.",
    "- Use the prospect's first name once if available.",
    "- One soft CTA only (tour, callback, reply with question) — and only if attempt > 1.",
    "- Never quote prices, plan names, PT package names, or session counts.",
    "- Plain conversational tone — no emoji spam, no bullet lists.",
    "- Do NOT repeat any of the previous nurture messages listed below — pick a different angle/opening/wording.",
    extraDiversityHint ? `- ${extraDiversityHint}` : "",
    "",
    recentTexts.length ? `Previously sent nurture messages to AVOID repeating:\n${recentTexts.map((t, i) => `${i + 1}. ${t}`).join("\n")}` : "",
    "",
    "Generate the nurture message body only (no greeting prefix beyond a natural opener, no signature).",
  ].filter(Boolean).join("\n");


  try {
    const built = await buildSystemPrompt({
      supabase,
      purpose: "lead_nurture",
      branchId,
      userMessage: `${angle.label} nurture for ${prospectName}: ${angle.prompt_hint}`,
      identity: { role: "lead", senderId: prospectName, name: prospectName },
      dynamicContext: ctx,
    });
    const r = await generateOnce({
      purpose: "lead_nurture",
      branchId,
      userMessage: ctx,
      systemOverride: built.prompt,
      supabase,
    });
    const txt = r.content?.trim();
    return txt || null;
  } catch (e) {
    console.warn("[lead-nurture] generateNurture failed:", (e as Error).message);
    return null;
  }
}

// ─── handler ────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const apikey = req.headers.get("apikey") || "";
    const sysCall = req.headers.get("x-system-call") || "";
    const isSystem = bearer === supabaseKey || (apikey === supabaseKey && sysCall === "automation-brain");
    if (!isSystem) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: purposeRow } = await supabase
      .from("ai_purposes")
      .select("enabled, ops_config")
      .eq("purpose", "lead_nurture")
      .is("branch_id", null)
      .maybeSingle();

    const ops = ((purposeRow?.ops_config as Record<string, any>) ?? {});
    // UI-driven cadence (HandleOpsSettings → ai_purposes.ops_config):
    //   delay_hours    — wait before the first nudge (retryCount === 0)
    //   cooldown_hours — wait between subsequent nudges (retryCount >= 1)
    //   max_retries    — total nudges per lead
    const delayHours: number = Number(ops.delay_hours) > 0 ? Number(ops.delay_hours) : 2;
    const cooldownHours: number = Number(ops.cooldown_hours) > 0 ? Number(ops.cooldown_hours) : 6;
    const maxRetries: number = Number(ops.max_retries) > 0 ? Number(ops.max_retries) : 3;
    // WhatsApp 24h freeform window is a protocol constant — not user-tunable.
    const WHATSAPP_FREEFORM_WINDOW_HOURS = 24;
    const config = {
      enabled: ops.enabled ?? purposeRow?.enabled ?? true,
    };
    if (!config.enabled) {
      return new Response(JSON.stringify({ message: "Lead nurture disabled" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: staleChats, error: chatErr } = await supabase
      .from("whatsapp_chat_settings")
      .select(
        "id, phone_number, branch_id, nurture_retry_count, partial_lead_data, last_nurture_at, platform, do_not_contact, do_not_contact_until, handoff_reason, last_nurture_hash",
      )
      .eq("bot_active", true)
      .eq("do_not_contact", false)
      .is("handoff_reason", null);

    if (chatErr) {
      return new Response(JSON.stringify({ error: chatErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let nudgedCount = 0;
    let resetCount = 0;
    const decisions: any[] = [];

    for (const chat of staleChats || []) {
      if (chat.do_not_contact) continue;
      if (chat.do_not_contact_until && new Date(chat.do_not_contact_until) > new Date()) continue;
      if (chat.handoff_reason) continue;

      // Skip non-fitness intents.
      try {
        const { data: mem } = await supabase
          .from("ai_memory")
          .select("current_intent")
          .eq("platform", chat.platform || "whatsapp")
          .eq("contact_key", chat.phone_number)
          .maybeSingle();
        if (mem?.current_intent === "non_fitness") {
          await supabase
            .from("whatsapp_chat_settings")
            .update({
              bot_active: false,
              do_not_contact: true,
              handoff_reason: "non_fitness_inquiry",
              paused_at: new Date().toISOString(),
            })
            .eq("id", chat.id);
          continue;
        }
      } catch (e) {
        console.warn("[lead-nurture] ai_memory lookup failed:", (e as Error).message);
      }

      const { data: lastMsg } = await supabase
        .from("whatsapp_messages")
        .select("direction, created_at")
        .eq("phone_number", chat.phone_number)
        .eq("branch_id", chat.branch_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!lastMsg) continue;

      if (lastMsg.direction === "inbound") {
        if ((chat.nurture_retry_count || 0) > 0) {
          await supabase
            .from("whatsapp_chat_settings")
            .update({ nurture_retry_count: 0 })
            .eq("id", chat.id);
          resetCount++;
        }
        continue;
      }

      const retryCount = chat.nurture_retry_count || 0;
      if (retryCount >= maxRetries) continue;

      // Per-retry wait: schedule_minutes[retryCount] minutes since last outbound.
      const waitHours = retryCount === 0 ? delayHours : cooldownHours;
      const dueAt = new Date(new Date(lastMsg.created_at).getTime() + waitHours * 3600 * 1000);
      if (dueAt > new Date()) continue;
      // Defensive: never re-send inside the same 30-minute bucket.
      if (chat.last_nurture_at) {
        const minGap = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        if (chat.last_nurture_at > minGap) continue;
      }

      const cleanPhone = chat.phone_number.replace(/^\+/, "");
      const { data: lead } = await supabase
        .from("leads")
        .select("id, full_name, status")
        .or(`phone.eq.${chat.phone_number},phone.eq.${cleanPhone},phone.eq.+${cleanPhone}`)
        .eq("branch_id", chat.branch_id)
        .limit(1)
        .maybeSingle();

      const partialData = chat.partial_lead_data as Record<string, any> | null;

      if (lead?.id) continue;
      const { data: linkedMember } = await supabase
        .from("members")
        .select("id")
        .eq("phone_number", chat.phone_number)
        .maybeSingle();
      if (linkedMember?.id) continue;

      const chatPlatform = chat.platform || "whatsapp";

      // Per-channel AI kill-switch
      try {
        const { isAiChannelEnabled } = await import("../_shared/ai-channel-toggle.ts");
        const channelOn = await isAiChannelEnabled(supabase, chat.branch_id, chatPlatform);
        if (!channelOn) continue;
      } catch (e) {
        console.warn("[lead-nurture] channel-toggle check failed:", (e as Error).message);
      }

      // ── 24h freeform window check (WhatsApp only). Outside = skip silently. ──
      if (chatPlatform === "whatsapp") {
        const sinceIso = new Date(Date.now() - WHATSAPP_FREEFORM_WINDOW_HOURS * 3600 * 1000).toISOString();
        const recipientDigits = chat.phone_number.replace(/\D/g, "");
        const { data: lastInbound } = await supabase
          .from("whatsapp_messages")
          .select("id")
          .eq("direction", "inbound")
          .eq("phone_number", recipientDigits)
          .gte("created_at", sinceIso)
          .limit(1)
          .maybeSingle();
        if (!lastInbound) {
          // Outside the WhatsApp 24h freeform window — nurture cannot reach
          // them without a template, and we explicitly DO NOT use templates
          // for nurture. Stamp last_nurture_at so we stop scanning this row
          // until they reply again. Re-engagement is a campaign concern.
          await supabase
            .from("whatsapp_chat_settings")
            .update({ last_nurture_at: new Date().toISOString() })
            .eq("id", chat.id);
          decisions.push({ phone: chat.phone_number, skipped: "outside_24h_window" });
          continue;
        }
      }



      // ── Pick angle + previous hashes ──
      const angle = await pickAngle(supabase, chat.id);
      const recentHashes = await lastNurtureHashes(supabase, chat.branch_id, chat.phone_number, 3);
      const { data: recentRows } = await supabase
        .from("whatsapp_messages")
        .select("content")
        .eq("phone_number", chat.phone_number)
        .eq("branch_id", chat.branch_id)
        .eq("direction", "outbound")
        .order("created_at", { ascending: false })
        .limit(3);
      const recentTexts = (recentRows ?? []).map((r: any) => r.content || "");

      const contactName = lead?.full_name || partialData?.name || partialData?.whatsapp_name || null;
      const prospectName = contactName || "there";

      // ── AI generation with similarity guard ──
      let candidate: string | null = null;
      let regenerated = false;
      let fallbackUsed = false;
      let candidateHash = "";

      const attempt = retryCount + 1;

      if (angle) {
        candidate = await generateNurture({
          supabase,
          branchId: chat.branch_id,
          angle,
          prospectName,
          partialData,
          leadKnown: !!lead,
          recentHashes,
          recentTexts,
          attempt,
          maxAttempts: maxRetries,
        });
        if (candidate) {
          candidateHash = await hashMessage(candidate);
          if (recentHashes.includes(candidateHash) || candidateHash === chat.last_nurture_hash) {
            regenerated = true;
            const retry = await generateNurture({
              supabase,
              branchId: chat.branch_id,
              angle,
              prospectName,
              partialData,
              leadKnown: !!lead,
              recentHashes,
              recentTexts,
              attempt,
              maxAttempts: maxRetries,
              extraDiversityHint:
                "The previous candidate matched a past message — phrase this COMPLETELY differently: different opener, different verb, different rhythm.",
            });
            if (retry) {
              candidate = retry;
              candidateHash = await hashMessage(retry);
            }
          }
        }
        // Still colliding or AI failed → DB fallback template (per-angle)
        if (!candidate || recentHashes.includes(candidateHash) || candidateHash === chat.last_nurture_hash) {
          fallbackUsed = true;
          candidate = renderFallback(angle.fallback_template, prospectName);
          candidateHash = await hashMessage(candidate);
        }
      } else {
        // No angles configured → last-ditch safe line (kept minimal; should not happen post-seed)
        candidate = `Hi ${prospectName}! Just checking in from Incline — happy to answer any questions or set up a quick tour whenever you're ready.`;
        candidateHash = await hashMessage(candidate);
        fallbackUsed = true;
      }

      // Freeform-only send (inside 24h window). No template path.
      try {
        const { data: msgData, error: msgErr } = await supabase
          .from("whatsapp_messages")
          .insert({
            branch_id: chat.branch_id,
            phone_number: chat.phone_number,
            contact_name: contactName,
            content: candidate,
            direction: "outbound",
            status: "pending",
            message_type: "text",
            platform: chatPlatform,
          })
          .select()
          .single();
        if (msgErr) {
          console.error(`[lead-nurture] insert failed for ${chat.phone_number}:`, msgErr.message);
          continue;
        }
        const sendUrl = chatPlatform === "whatsapp"
          ? `${supabaseUrl}/functions/v1/send-whatsapp`
          : `${supabaseUrl}/functions/v1/send-meta-dm`;
        const body = chatPlatform === "whatsapp"
          ? { message_id: msgData.id, phone_number: chat.phone_number, content: candidate, branch_id: chat.branch_id }
          : { message_id: msgData.id, platform: chatPlatform, recipient_id: chat.phone_number, content: candidate, branch_id: chat.branch_id };
        const sendRes = await fetch(sendUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!sendRes.ok) console.error(`[lead-nurture] send failed for ${chat.phone_number}: ${sendRes.status}`);
      } catch (sendErr) {
        console.error(`[lead-nurture] send error for ${chat.phone_number}:`, (sendErr as Error).message);
        continue;
      }

      // Persist history + hash
      const nowIso = new Date().toISOString();
      const historyEntry = {
        angle: angle?.slug ?? null,
        hash: candidateHash,
        regenerated,
        fallback: fallbackUsed,
        sent_at: nowIso,
      };
      // Read current history, append, cap at 20.
      const { data: cur } = await supabase
        .from("whatsapp_chat_settings")
        .select("nurture_angle_history")
        .eq("id", chat.id)
        .maybeSingle();
      const history = Array.isArray(cur?.nurture_angle_history) ? cur!.nurture_angle_history : [];
      const newHistory = [...history, historyEntry].slice(-20);

      await supabase
        .from("whatsapp_chat_settings")
        .update({
          nurture_retry_count: (chat.nurture_retry_count || 0) + 1,
          last_nurture_at: nowIso,
          last_nurture_text: candidate,
          last_nurture_hash: candidateHash,
          nurture_angle_history: newHistory,
        })
        .eq("id", chat.id);

      decisions.push({ phone: chat.phone_number, attempt, angle: angle?.slug, regenerated, fallback: fallbackUsed });
      nudgedCount++;
    }

    return new Response(
      JSON.stringify({ success: true, nudged: nudgedCount, retries_reset: resetCount, decisions }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    console.error("lead-nurture-followup error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
