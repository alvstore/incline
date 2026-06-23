// _shared/leadCapture.ts
// v1.0.0 — Single source of truth that promotes a captured `ai_memory` row
// into a real `leads` row, so the CRM never silently loses a contact that the
// bot has fully onboarded (name + email + goal + plan_interest).
//
// Triggered from two places in the AI brain:
//   1. Right after the auto-learn pass (5c), so any answer that just filled
//      the last missing field is persisted BEFORE the deterministic
//      short-circuit returns its next-step prompt.
//   2. At the top of the callback-consent short-circuit (6b), so the founder
//      handoff always has a real leadId to link the task to.
// Also called by the safety-net cron (monitor-ai-lead-loss) to sweep any
// orphaned memory rows that slipped past the live path.
//
// Idempotent: deduplicates by phone variants and by email within the branch.

import { phoneVariants } from "./phone.ts";

type SupabaseClient = any;
type Platform = "whatsapp" | "instagram" | "messenger" | string;

export type EnsureLeadArgs = {
  branchId: string;
  senderId: string;
  platform: Platform;
  contactName?: string | null;
  memory: any | null;
  supabaseUrl: string;
  serviceKey: string;
};

export type EnsureLeadResult = {
  leadId: string | null;
  created: boolean;
  skipped:
    | "no_memory"
    | "no_email"
    | "insufficient_facts"
    | "is_member"
    | "exists"
    | "insert_failed"
    | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SOURCE_MAP: Record<string, string> = {
  whatsapp: "whatsapp_ai",
  instagram: "instagram_ai",
  messenger: "messenger_ai",
};

export async function ensureLeadFromMemory(
  supabase: SupabaseClient,
  args: EnsureLeadArgs,
): Promise<EnsureLeadResult> {
  const { branchId, senderId, platform, memory, contactName, supabaseUrl, serviceKey } = args;
  if (!memory) return { leadId: null, created: false, skipped: "no_memory" };

  const profile = memory.profile || {};
  const facts = memory.facts || {};

  const email = String(profile.email || "").trim();
  if (!EMAIL_RE.test(email)) return { leadId: null, created: false, skipped: "no_email" };

  const goal = String(facts.fitness_goal || facts.goal || "").trim();
  const plan = String(facts.plan_interest || "").trim();
  const wantsHuman = facts?.consent?.wants_human === true;
  if (!goal && !plan && !wantsHuman) {
    return { leadId: null, created: false, skipped: "insufficient_facts" };
  }

  const fullName =
    String(profile.full_name || "").trim() ||
    String(profile.first_name || "").trim() ||
    String(profile.name || "").trim() ||
    (contactName || "").trim() ||
    `${platform} Lead`;

  // Member-first guard: never create a lead for an active member.
  const isPhoneLike = /^\+?\d{10,15}$/.test(senderId);
  const variants = isPhoneLike ? phoneVariants(senderId) : [];
  if (variants.length > 0) {
    try {
      const { data: prof } = await supabase
        .from("profiles")
        .select("id")
        .in("phone", variants)
        .limit(1)
        .maybeSingle();
      if (prof?.id) {
        const { data: existingMember } = await supabase
          .from("members")
          .select("id")
          .eq("user_id", prof.id)
          .limit(1)
          .maybeSingle();
        if (existingMember) return { leadId: null, created: false, skipped: "is_member" };
      }
    } catch { /* non-fatal */ }
  }

  // Dedupe by phone variants within branch.
  if (variants.length > 0) {
    try {
      const { data: existingByPhone } = await supabase
        .from("leads")
        .select("id, status")
        .in("phone", variants)
        .eq("branch_id", branchId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingByPhone?.id) {
        // Backfill missing fields onto the existing row.
        const patch: Record<string, any> = { updated_at: new Date().toISOString() };
        if (fullName) patch.full_name = fullName;
        if (email) patch.email = email;
        if (goal) patch.fitness_goal = goal;
        if (plan) patch.plan_interest = plan.toLowerCase();
        if (existingByPhone.status === "new") patch.status = "contacted";
        try {
          await supabase.from("leads").update(patch).eq("id", existingByPhone.id);
        } catch { /* non-fatal */ }
        try {
          await supabase
            .from("whatsapp_chat_settings")
            .upsert(
              { branch_id: branchId, phone_number: senderId, captured_lead_id: existingByPhone.id },
              { onConflict: "branch_id,phone_number" },
            );
        } catch { /* non-fatal */ }
        return { leadId: existingByPhone.id, created: false, skipped: "exists" };
      }
    } catch { /* non-fatal */ }
  }

  // Dedupe by email within branch.
  try {
    const { data: existingByEmail } = await supabase
      .from("leads")
      .select("id")
      .eq("email", email)
      .eq("branch_id", branchId)
      .limit(1)
      .maybeSingle();
    if (existingByEmail?.id) {
      try {
        await supabase
          .from("whatsapp_chat_settings")
          .upsert(
            { branch_id: branchId, phone_number: senderId, captured_lead_id: existingByEmail.id },
            { onConflict: "branch_id,phone_number" },
          );
      } catch { /* non-fatal */ }
      return { leadId: existingByEmail.id, created: false, skipped: "exists" };
    }
  } catch { /* non-fatal */ }

  // Insert fresh lead.
  const phone = isPhoneLike ? senderId : `${platform}:${senderId}`;
  const leadRow: Record<string, any> = {
    phone,
    email,
    full_name: fullName,
    source: SOURCE_MAP[platform] || `${platform}_ai`,
    branch_id: branchId,
    status: "contacted",
    temperature: "warm",
    score: 60,
    fitness_goal: goal || null,
    goals: goal || null,
    plan_interest: plan ? plan.toLowerCase() : null,
    notes: `AI-captured via ${platform}. Sender: ${senderId}.`,
  };

  let newLeadId: string | null = null;
  try {
    const { data: inserted, error } = await supabase
      .from("leads")
      .insert(leadRow)
      .select("id")
      .single();
    if (error) {
      console.error("[ensureLeadFromMemory] insert failed:", error.message);
      return { leadId: null, created: false, skipped: "insert_failed" };
    }
    newLeadId = inserted?.id ?? null;
  } catch (e) {
    console.error("[ensureLeadFromMemory] insert exception:", (e as Error).message);
    return { leadId: null, created: false, skipped: "insert_failed" };
  }
  if (!newLeadId) return { leadId: null, created: false, skipped: "insert_failed" };

  // Link to chat settings.
  try {
    await supabase
      .from("whatsapp_chat_settings")
      .upsert(
        { branch_id: branchId, phone_number: senderId, captured_lead_id: newLeadId },
        { onConflict: "branch_id,phone_number" },
      );
  } catch { /* non-fatal */ }

  // Timeline entry.
  try {
    await supabase.from("lead_activities").insert({
      lead_id: newLeadId,
      branch_id: branchId,
      activity_type: "whatsapp_funnel_completed",
      title: "Lead captured by AI from chat funnel",
      metadata: {
        platform,
        phone: senderId,
        email,
        fitness_goal: goal || null,
        plan_interest: plan || null,
        wants_human: wantsHuman,
      },
    });
  } catch { /* non-fatal */ }

  // Notification fan-out (best effort).
  try {
    fetch(`${supabaseUrl}/functions/v1/notify-lead-created`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ lead_id: newLeadId, branch_id: branchId }),
    }).catch(() => { /* dispatcher is best-effort */ });
  } catch { /* noop */ }

  console.log(`[ensureLeadFromMemory] created lead ${newLeadId} for ${platform} ${senderId}`);
  return { leadId: newLeadId, created: true, skipped: null };
}
