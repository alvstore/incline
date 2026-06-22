// _shared/handoff.ts
// v1.0.0 — Founder / human handoff orchestrator.
//
// Single source of truth invoked from the AI brain whenever a lead explicitly
// agrees to a callback (e.g. "Yeah sure" after the bot offers "want our team
// to call you?"). It atomically:
//
//   1. Creates a high-priority `tasks` row for the founder/manager team.
//   2. Stamps `whatsapp_chat_settings.founder_handoff_task_id`,
//      `handoff_requested_at`, `handoff_reason`.
//   3. Advances `leads.status` to 'qualified' and writes a `lead_activities`
//      entry of type `callback_requested`.
//   4. Fires a `lead_callback_requested` notification through the universal
//      dispatcher (`dispatch-communication`) so on/off integration toggles
//      and category preferences are respected.
//
// All steps are best-effort but bubbled back so the brain can decide whether
// to emit the deterministic "founder will call you" copy or fall back to a
// safe "let me try again" line. Crucially: if `tasks` insert fails, the
// caller MUST NOT promise a callback.

type SupabaseClient = any;

export type RequestFounderHandoffArgs = {
  branchId: string;
  chatPhone: string; // E.164 phone of the WhatsApp/IG/FB contact
  leadId: string | null;
  contactName: string | null;
  platform: "whatsapp" | "instagram" | "messenger" | string;
  reason: "founding_member_callback" | "manual_handoff" | string;
  summary?: string | null;
};

export type RequestFounderHandoffResult = {
  ok: boolean;
  taskId: string | null;
  alreadyHandled: boolean;
  error?: string;
};

export async function requestFounderHandoff(
  supabase: SupabaseClient,
  supabaseUrl: string,
  serviceKey: string,
  args: RequestFounderHandoffArgs,
): Promise<RequestFounderHandoffResult> {
  const {
    branchId, chatPhone, leadId, contactName, platform, reason, summary,
  } = args;

  // 0. Idempotency — if a handoff task already exists on this chat row in
  //    the last 24h, do nothing. Prevents duplicate tasks if the user says
  //    "yes" twice.
  try {
    const { data: existing } = await supabase
      .from("whatsapp_chat_settings")
      .select("founder_handoff_task_id, handoff_requested_at")
      .eq("branch_id", branchId)
      .eq("phone_number", chatPhone)
      .maybeSingle();
    if (existing?.founder_handoff_task_id && existing?.handoff_requested_at) {
      const ageMs = Date.now() - new Date(existing.handoff_requested_at).getTime();
      if (ageMs < 24 * 60 * 60 * 1000) {
        return { ok: true, taskId: existing.founder_handoff_task_id, alreadyHandled: true };
      }
    }
  } catch { /* non-fatal — continue */ }

  // 1. Create the task. We deliberately leave assigned_to NULL so any
  //    owner/admin/manager on the branch sees it in their queue. The
  //    notification (step 4) handles routing to the actual humans.
  const displayName = (contactName && contactName.trim()) || chatPhone;
  const dueDate = new Date();
  dueDate.setHours(dueDate.getHours() + 2); // 2-hour SLA
  const title = `Founding Member callback — ${displayName}`;
  const description =
    `Lead agreed to a callback on ${platform} ${chatPhone}.\n` +
    `Reason: ${reason}.\n` +
    (summary ? `Context: ${summary}\n` : "") +
    `Open the WhatsApp inbox for the full transcript.`;

  let taskId: string | null = null;
  try {
    const { data: task, error: taskErr } = await supabase
      .from("tasks")
      .insert({
        branch_id: branchId,
        title,
        description,
        priority: "high",
        status: "pending",
        due_date: dueDate.toISOString().slice(0, 10),
        linked_entity_type: leadId ? "lead" : null,
        linked_entity_id: leadId,
      })
      .select("id")
      .single();
    if (taskErr) throw taskErr;
    taskId = task?.id ?? null;
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error("[handoff] task insert failed:", msg);
    return { ok: false, taskId: null, alreadyHandled: false, error: `task_insert_failed:${msg}` };
  }

  // 2. Stamp the chat row so we don't re-fire and so the inbox UI can show
  //    "handoff requested" status.
  try {
    await supabase
      .from("whatsapp_chat_settings")
      .upsert(
        {
          branch_id: branchId,
          phone_number: chatPhone,
          founder_handoff_task_id: taskId,
          handoff_requested_at: new Date().toISOString(),
          handoff_reason: reason,
        },
        { onConflict: "branch_id,phone_number" },
      );
  } catch (e) {
    console.warn("[handoff] chat_settings stamp failed (non-fatal):", (e as Error).message);
  }

  // 3. Advance lead status + write activity timeline entry.
  if (leadId) {
    try {
      await supabase
        .from("leads")
        .update({ status: "qualified", updated_at: new Date().toISOString() })
        .eq("id", leadId)
        // Only escalate forward — never demote a converted/negotiation lead.
        .in("status", ["new", "contacted"]);
    } catch (e) {
      console.warn("[handoff] lead status update failed (non-fatal):", (e as Error).message);
    }
    try {
      await supabase.from("lead_activities").insert({
        lead_id: leadId,
        branch_id: branchId,
        activity_type: "callback_requested",
        title: "Callback requested via AI bot",
        notes: summary ? String(summary).slice(0, 800) : null,
        metadata: { platform, phone: chatPhone, task_id: taskId, reason },
      });
    } catch (e) {
      console.warn("[handoff] lead_activities insert failed (non-fatal):", (e as Error).message);
    }
  }

  // 4. Fire the universal dispatcher so the configured channels/integration
  //    toggles for `lead_callback_requested` (in-app notification, optional
  //    WhatsApp/email to the founder team) are honored. We never throw here;
  //    the task already exists.
  try {
    await fetch(`${supabaseUrl}/functions/v1/dispatch-communication`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        branch_id: branchId,
        channel: "in_app",
        category: "operational",
        recipient: "role:owner,admin,manager",
        payload: {
          subject: title,
          body: description,
          variables: {
            lead_id: leadId,
            phone: chatPhone,
            name: displayName,
            platform,
            task_id: taskId,
          },
          use_branded_template: false,
        },
        dedupe_key: `handoff:${taskId}`,
        force: true,
      }),
    }).catch(() => { /* dispatcher is best-effort */ });
  } catch { /* noop */ }

  return { ok: true, taskId, alreadyHandled: false };
}

// Heuristic to detect when the user explicitly agrees to a callback.
// Kept here so the brain and other callers share the same definition.
export const CALLBACK_YES_RE =
  /^\s*(?:yes(?:\s*please)?(?:\s*call)?|yeah(?:\s+sure)?|yep|yup|sure(?:\s*(?:please|do|go ahead))?|ok(?:ay)?(?:\s*(?:please|sure))?|please\s*(?:do|call)|go\s*ahead|do\s*it|haan(?:\s*ji)?|ji(?:\s*haan)?|theek\s*hai|sounds?\s+good|sure\s*thing|absolutely|definitely|🙏|👍|✅)\s*[.!]*\s*$/i;

// Detects whether the most recent assistant turn(s) actually offered a
// callback. We only trigger handoff when the user is responding to such an
// offer — bare "yes" to anything else (e.g. a goal question) must NOT create
// a task.
export const CALLBACK_OFFER_RE =
  /(call\s+you|give\s+you\s+a\s+call|team\s+(?:to\s+)?(?:call|reach\s+out)|lock\s+in\s+your\s+(?:founding\s+)?spot|founder\s+will\s+(?:call|reach)|connect\s+you\s+with\s+(?:our|the)\s+team|have\s+our\s+team\s+call)/i;

export function lastBotOfferedCallback(
  history: Array<{ role: string; content: string }>,
): boolean {
  if (!Array.isArray(history) || history.length === 0) return false;
  // Look at the most recent 1-2 assistant turns. We don't want to fire on a
  // stale offer from many turns ago.
  const recent = history.slice(-4).filter((m) => m.role === "assistant");
  if (recent.length === 0) return false;
  const lastAssistant = recent[recent.length - 1]?.content || "";
  return CALLBACK_OFFER_RE.test(lastAssistant);
}
