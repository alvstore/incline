// v5.2.0 — Variant-aware phone matching, member-first dedupe guard before
//          lead INSERT, member-first hard rule injected into AI system prompt.
// v5.1.0 — Phase G: pinned to shared META_API_BASE (v25.0).
// v5.0.0 — Transactional AI Agent: 25+ self-service tools, payments, IG/FB parity
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllToolDefinitions } from "../_shared/ai-tools.ts";
import { executeSharedToolCall } from "../_shared/ai-tool-executor.ts";
import { META_API_BASE } from "../_shared/meta-config.ts";
import { phoneVariants } from "../_shared/phone.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, x-hub-signature, x-hub-signature-256",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type WhatsAppIntegration = {
  id: string;
  branch_id: string | null;
  config: Record<string, unknown>;
  credentials: Record<string, unknown>;
};

const integrationCache = new Map<string, WhatsAppIntegration | null>();
let fallbackBranchIdCache: string | null = null;
let fallbackBranchIdFetched = false;

// ─── Member context shape for tool execution ────────────────────────────────
interface MemberContext {
  memberId: string;
  membershipId: string | null;
  branchId: string;
  planId: string | null;
  memberName: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method === "GET") {
      return await handleVerification(req);
    }

    if (req.method === "POST") {
      return await handleEvent(req);
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json", Allow: "GET, POST, OPTIONS" },
    });
  } catch (error) {
    console.error("whatsapp-webhook error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─── Verification ──────────────────────────────────────────────────────────────

async function handleVerification(req: Request) {
  const url = new URL(req.url);
  const modeRaw = getQueryParam(url, ["hub.mode", "hub_mode", "mode"]);
  const verifyToken = getQueryParam(url, ["hub.verify_token", "hub_verify_token", "verify_token"]);
  const challenge = getQueryParam(url, ["hub.challenge", "hub_challenge", "challenge"]);
  const mode = modeRaw?.toLowerCase();

  if (mode !== "subscribe" || !verifyToken || !challenge) {
    const missingParams = [
      !modeRaw ? "hub.mode" : null,
      !verifyToken ? "hub.verify_token" : null,
      !challenge ? "hub.challenge" : null,
    ].filter(Boolean);

    return new Response(
      JSON.stringify({ error: "Invalid verification request", expected_mode: "subscribe", received_mode: modeRaw, missing_params: missingParams }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { data: integration, error } = await supabase
    .from("integration_settings")
    .select("id")
    .eq("integration_type", "whatsapp")
    .eq("is_active", true)
    .eq("config->>webhook_verify_token", verifyToken)
    .limit(1)
    .maybeSingle();

  if (error || !integration) {
    console.error("Invalid verify token", error);
    return new Response(JSON.stringify({ error: "Verification token not recognized" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(challenge, { status: 200, headers: { ...corsHeaders, "Content-Type": "text/plain" } });
}

function getQueryParam(url: URL, keys: string[]) {
  for (const key of keys) {
    const value = url.searchParams.get(key)?.trim();
    if (value) return value;
  }
  return null;
}

// ─── Event Handling ────────────────────────────────────────────────────────────

async function handleEvent(req: Request) {
  const bodyText = await req.text();
  let payload: any;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (payload?.object && payload.object !== "whatsapp_business_account") {
    return new Response(JSON.stringify({ status: "ignored" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Signature verification
  const phoneNumberIds = extractPhoneNumberIds(payload);
  const candidateIntegrations = await Promise.all(phoneNumberIds.map((id) => findIntegrationByPhoneNumberId(id)));
  const signatureSecrets: string[] = Array.from(
    new Set(
      candidateIntegrations
        .map(getWebhookSignatureSecret)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  );

  if (signatureSecrets.length > 0) {
    const signatureHeader = req.headers.get("x-hub-signature-256") ?? req.headers.get("x-hub-signature");
    if (!signatureHeader) {
      return new Response(JSON.stringify({ error: "Missing webhook signature" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const isValidSignature = await verifyWebhookSignature(bodyText, signatureHeader, signatureSecrets);
    if (!isValidSignature) {
      return new Response(JSON.stringify({ error: "Invalid webhook signature" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  if (entries.length === 0) {
    return new Response(JSON.stringify({ status: "ignored" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  for (const entry of entries) {
    if (!Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      const value = change?.value;
      const field = change?.field;

      if (field === "message_template_status_update") {
        await processTemplateStatusUpdate(value);
        continue;
      }

      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      const integration = await findIntegrationByPhoneNumberId(String(phoneNumberId));
      const resolvedBranchId = await resolveBranchId(integration, value);
      if (!resolvedBranchId) {
        console.warn("Unable to resolve branch_id for WhatsApp webhook event", phoneNumberId);
      }

      const insertedMessageIds = await processIncomingMessages(value, resolvedBranchId);
      await processStatusUpdates(value, resolvedBranchId);

      if (insertedMessageIds.length > 0 && resolvedBranchId) {
        for (const { id: msgId, phone_number } of insertedMessageIds) {
          try {
            await triggerAiAutoReply(msgId, phone_number, resolvedBranchId);
          } catch (err) {
            console.error("AI auto-reply error (non-blocking):", err);
          }
        }
      }
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── Template Status Updates ───────────────────────────────────────────────────

async function processTemplateStatusUpdate(value: any) {
  if (!value) return;
  const templateName = value.message_template_name;
  const templateStatus = value.event;
  const reason = value.reason || value.rejected_reason || null;

  if (!templateName || !templateStatus) return;

  const { error } = await supabase
    .from("whatsapp_templates")
    .update({
      status: templateStatus,
      rejected_reason: reason,
      synced_at: new Date().toISOString(),
    })
    .eq("name", templateName);

  if (error) {
    console.error("Failed to update whatsapp_templates status:", error);
  }

  await supabase
    .from("templates")
    .update({
      meta_template_status: templateStatus,
      meta_rejection_reason: reason,
    })
    .eq("meta_template_name", templateName)
    .not("meta_template_name", "is", null);
}

// ─── Incoming Messages ─────────────────────────────────────────────────────────

async function processIncomingMessages(value: any, branchId: string | null): Promise<{ id: string; phone_number: string }[]> {
  if (!branchId) return [];

  const messages = Array.isArray(value.messages) ? value.messages : [];
  const contactName = value.contacts?.[0]?.profile?.name ?? null;
  const insertedItems: { id: string; phone_number: string }[] = [];

  for (const message of messages) {
    if (!message?.from || !message?.id) continue;

    const { data: existing } = await supabase
      .from("whatsapp_messages")
      .select("id")
      .eq("whatsapp_message_id", message.id)
      .maybeSingle();

    if (existing) continue;

    const msgPayload = {
      branch_id: branchId,
      phone_number: message.from,
      contact_name: contactName,
      message_type: message.type ?? "text",
      content: extractMessageContent(message),
      media_url: extractMediaUrl(message),
      direction: "inbound",
      status: "received",
      whatsapp_message_id: message.id,
    };

    const { data, error } = await supabase.from("whatsapp_messages").insert(msgPayload).select("id").single();
    if (error) {
      console.error("Failed to insert WhatsApp inbound message", error);
    } else if (data) {
      insertedItems.push({ id: data.id, phone_number: message.from });
      await supabase.from("whatsapp_chat_settings").upsert(
        {
          branch_id: branchId,
          phone_number: message.from,
          is_unread: true,
        },
        { onConflict: "branch_id,phone_number" },
      );

      // Meta Ads attribution: extract referral data if present
      if (message.referral) {
        try {
          const adId = message.referral.source_id || message.referral.ad_id || null;
          const campaignName = message.referral.headline || message.referral.body || null;
          const sourceUrl = message.referral.source_url || null;
          if (adId || campaignName) {
            // Store attribution on any existing lead with this phone
            await supabase
              .from("leads")
              .update({
                ad_id: adId,
                campaign_name: campaignName,
                source: sourceUrl ? "meta_ad" : "whatsapp_ad",
              })
              .eq("phone", message.from)
              .is("ad_id", null);
            console.log("Meta ad attribution captured:", { phone: message.from, adId, campaignName });
          }
        } catch (refErr) {
          console.warn("Failed to extract Meta referral data:", refErr);
        }
      }
    }
  }

  return insertedItems;
}

// ─── Status Updates ────────────────────────────────────────────────────────────
// Mirrors Meta delivery callbacks (sent → delivered → read → failed) onto BOTH
// `whatsapp_messages` (CRM inbox) AND `communication_logs` (dispatcher audit
// trail) so Templates Health and per-template delivery stats stay accurate.

async function processStatusUpdates(value: any, branchId: string | null) {
  const statuses = Array.isArray(value.statuses) ? value.statuses : [];

  for (const status of statuses) {
    if (!status?.id) continue;
    const newStatus = String(status.status ?? "sent").toLowerCase();
    const errMsg = Array.isArray(status.errors) && status.errors.length
      ? `${status.errors[0]?.code ?? ''}: ${status.errors[0]?.title ?? status.errors[0]?.message ?? ''}`.trim()
      : null;

    // 1. WhatsApp inbox row
    let updateQuery = supabase
      .from("whatsapp_messages")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("whatsapp_message_id", status.id);
    if (branchId) updateQuery = updateQuery.eq("branch_id", branchId);
    const { error } = await updateQuery;
    if (error) console.error("Failed to update WhatsApp message status", error);

    // 2. Dispatcher audit trail — match by provider_message_id (wamid).
    //    `delivery_status` enum only has sent/failed; richer WhatsApp
    //    lifecycle (delivered/read) is stashed under delivery_metadata.
    try {
      const { data: log } = await supabase
        .from("communication_logs")
        .select("id, delivery_metadata")
        .eq("provider_message_id", status.id)
        .maybeSingle();
      if (log?.id) {
        const meta = (log.delivery_metadata as Record<string, unknown>) || {};
        const patch: Record<string, unknown> = {
          delivery_metadata: {
            ...meta,
            wa_status: newStatus,
            wa_status_at: new Date().toISOString(),
          },
        };
        if (newStatus === "failed") {
          patch.delivery_status = "failed";
          if (errMsg) patch.error_message = errMsg;
        }
        await supabase.from("communication_logs").update(patch).eq("id", log.id);
      }
    } catch (e) {
      console.warn("[whatsapp-webhook] communication_logs update failed:", e);
    }
  }
}

// ─── Epic 1: Enhanced Context Hydration ────────────────────────────────────────

interface HydratedContext {
  isMember: boolean;
  contextPrompt: string;
  memberName?: string;
  memberContext?: MemberContext;
}

async function hydrateContactContext(phoneNumber: string, branchId: string): Promise<HydratedContext> {
  const variants = phoneVariants(phoneNumber);

  // Check if member — single query with .in() across all phone variants
  if (variants.length > 0) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, full_name, phone")
      .in("phone", variants)
      .limit(1)
      .maybeSingle();

    if (profile) {
      const { data: member } = await supabase
        .from("members")
        .select("id, member_code, branch_id")
        .eq("user_id", profile.id)
        .limit(1)
        .maybeSingle();

      if (member) {
        const { data: memberships } = await supabase
          .from("memberships")
          .select("id, status, end_date, plan_id, branch_id, membership_plans(name)")
          .eq("member_id", member.id)
          .eq("status", "active")
          .limit(1);

        const activeMembership = memberships?.[0];
        const memberBranchId = member.branch_id || branchId;

        let contextLines = `Context: Speaking to ${profile.full_name || "a member"}, an Active Member (Code: ${member.member_code}).`;

        if (activeMembership) {
          const planName = (activeMembership as any).membership_plans?.name || "Unknown Plan";
          const daysLeft = activeMembership.end_date
            ? Math.max(0, Math.ceil((new Date(activeMembership.end_date).getTime() - Date.now()) / 86400000))
            : "N/A";
          contextLines += ` Plan: ${planName}, ${daysLeft} days remaining.`;
        }

        // Fetch PT sessions balance
        const { data: ptPackages } = await supabase
          .from("member_pt_packages")
          .select("id, sessions_remaining, sessions_total, expiry_date, pt_packages(name)")
          .eq("member_id", member.id)
          .eq("status", "active")
          .gt("sessions_remaining", 0);

        if (ptPackages && ptPackages.length > 0) {
          const ptSummary = ptPackages.map((p: any) =>
            `${(p as any).pt_packages?.name || "PT"}: ${p.sessions_remaining}/${p.sessions_total} sessions left`
          ).join(", ");
          contextLines += ` PT Sessions: ${ptSummary}.`;
        }

        // Fetch benefit balances (sauna, ice bath, etc.)
        if (activeMembership) {
          const { data: planBenefits } = await supabase
            .from("plan_benefits")
            .select("benefit_type, benefit_type_id, limit_count, frequency, benefit_types(name, code)")
            .eq("plan_id", activeMembership.plan_id);

          if (planBenefits && planBenefits.length > 0) {
            const benefitLines: string[] = [];
            for (const pb of planBenefits) {
              const benefitName = (pb as any).benefit_types?.name || pb.benefit_type || "Unknown";
              if (pb.frequency === "unlimited" || !pb.limit_count) {
                benefitLines.push(`${benefitName}: Unlimited`);
              } else {
                // Count usage
                let usageQuery = supabase
                  .from("benefit_usage")
                  .select("usage_count")
                  .eq("membership_id", activeMembership.id);

                if (pb.benefit_type_id) {
                  usageQuery = usageQuery.eq("benefit_type_id", pb.benefit_type_id);
                } else {
                  usageQuery = usageQuery.eq("benefit_type", pb.benefit_type);
                }

                // Apply frequency filter
                const now = new Date();
                if (pb.frequency === "daily") {
                  usageQuery = usageQuery.eq("usage_date", now.toISOString().split("T")[0]);
                } else if (pb.frequency === "weekly") {
                  const weekStart = new Date(now);
                  weekStart.setDate(now.getDate() - now.getDay());
                  usageQuery = usageQuery.gte("usage_date", weekStart.toISOString().split("T")[0]);
                } else if (pb.frequency === "monthly") {
                  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
                  usageQuery = usageQuery.gte("usage_date", monthStart);
                }
                // per_membership: no date filter

                const { data: usageRows } = await usageQuery;
                const totalUsed = (usageRows || []).reduce((sum: number, u: any) => sum + (u.usage_count || 0), 0);
                const remaining = Math.max(0, pb.limit_count - totalUsed);
                benefitLines.push(`${benefitName}: ${remaining}/${pb.limit_count} remaining (${pb.frequency})`);
              }
            }
            if (benefitLines.length > 0) {
              contextLines += ` Benefits: ${benefitLines.join("; ")}.`;
            }
          }
        }

        // Fetch pending invoices
        const { data: pendingInvoices } = await supabase
          .from("invoices")
          .select("id, total_amount, amount_paid, status, due_date")
          .eq("member_id", member.id)
          .in("status", ["pending", "partial"])
          .limit(5);

        if (pendingInvoices && pendingInvoices.length > 0) {
          const totalDues = pendingInvoices.reduce((sum: number, inv: any) =>
            sum + ((inv.total_amount || 0) - (inv.amount_paid || 0)), 0);
          contextLines += ` Pending Dues: ₹${totalDues} across ${pendingInvoices.length} invoice(s).`;
        }

        const memberContext: MemberContext = {
          memberId: member.id,
          membershipId: activeMembership?.id || null,
          branchId: memberBranchId,
          planId: activeMembership?.plan_id || null,
          memberName: profile.full_name || "Member",
        };

        return { isMember: true, contextPrompt: contextLines, memberName: profile.full_name || undefined, memberContext };
      }
    }
  }

  // Check if existing lead — variant-aware
  if (variants.length > 0) {
    const { data: lead } = await supabase
      .from("leads")
      .select("id, full_name, status, temperature")
      .in("phone", variants)
      .limit(1)
      .maybeSingle();

    if (lead) {
      return {
        isMember: false,
        contextPrompt: `Context: Speaking to ${lead.full_name || "a known lead"} (Lead status: ${lead.status}, Temperature: ${lead.temperature}).`,
      };
    }
  }

  return { isMember: false, contextPrompt: "Context: Speaking to an unregistered contact (potential new lead)." };
}

// ─── Epic 2: Production Tool Declarations ──────────────────────────────────────

function getMemberTools() {
  // v5.0.0 — Use shared registry (25+ tools across membership, bookings, payments, loyalty)
  return getAllToolDefinitions();
}


// ─── Epic 3: Tool Execution Router ─────────────────────────────────────────────

async function executeToolCall(
  toolName: string,
  args: Record<string, any>,
  ctx: MemberContext,
  phoneNumber: string,
  branchId: string,
): Promise<Record<string, any>> {
  try {
    switch (toolName) {
      case "get_membership_status": {
        const { data: memberships } = await supabase
          .from("memberships")
          .select("id, status, start_date, end_date, plan_id, membership_plans(name, price)")
          .eq("member_id", ctx.memberId)
          .order("end_date", { ascending: false })
          .limit(3);

        if (!memberships || memberships.length === 0) {
          return { status: "no_membership", message: "No membership found." };
        }

        const active = memberships.find((m: any) => m.status === "active");
        const current = active || memberships[0];
        const daysLeft = current.end_date
          ? Math.max(0, Math.ceil((new Date(current.end_date).getTime() - Date.now()) / 86400000))
          : null;

        // Pending dues
        const { data: pendingInv } = await supabase
          .from("invoices")
          .select("total_amount, amount_paid")
          .eq("member_id", ctx.memberId)
          .in("status", ["pending", "partial"]);

        const pendingDues = (pendingInv || []).reduce((s: number, i: any) =>
          s + ((i.total_amount || 0) - (i.amount_paid || 0)), 0);

        return {
          plan: (current as any).membership_plans?.name || "Unknown",
          status: current.status,
          start_date: current.start_date,
          end_date: current.end_date,
          days_left: daysLeft,
          pending_dues: `₹${pendingDues}`,
        };
      }

      case "get_benefit_balance": {
        if (!ctx.membershipId) {
          return { error: "No active membership to check benefits." };
        }

        const { data: planBenefits } = await supabase
          .from("plan_benefits")
          .select("benefit_type, benefit_type_id, limit_count, frequency, benefit_types(name, code)")
          .eq("plan_id", ctx.planId);

        if (!planBenefits || planBenefits.length === 0) {
          return { message: "No benefits found in your plan." };
        }

        const filterType = args.benefit_type?.toLowerCase();
        const results: Record<string, any>[] = [];

        for (const pb of planBenefits) {
          const name = (pb as any).benefit_types?.name || pb.benefit_type;
          const code = (pb as any).benefit_types?.code || pb.benefit_type;

          if (filterType && !code.toLowerCase().includes(filterType) && !name.toLowerCase().includes(filterType)) {
            continue;
          }

          if (pb.frequency === "unlimited" || !pb.limit_count) {
            results.push({ benefit: name, remaining: "Unlimited", frequency: pb.frequency });
            continue;
          }

          let usageQuery = supabase
            .from("benefit_usage")
            .select("usage_count")
            .eq("membership_id", ctx.membershipId);

          if (pb.benefit_type_id) {
            usageQuery = usageQuery.eq("benefit_type_id", pb.benefit_type_id);
          } else {
            usageQuery = usageQuery.eq("benefit_type", pb.benefit_type);
          }

          const now = new Date();
          if (pb.frequency === "daily") {
            usageQuery = usageQuery.eq("usage_date", now.toISOString().split("T")[0]);
          } else if (pb.frequency === "weekly") {
            const ws = new Date(now); ws.setDate(now.getDate() - now.getDay());
            usageQuery = usageQuery.gte("usage_date", ws.toISOString().split("T")[0]);
          } else if (pb.frequency === "monthly") {
            usageQuery = usageQuery.gte("usage_date", `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`);
          }

          const { data: usageRows } = await usageQuery;
          const used = (usageRows || []).reduce((s: number, u: any) => s + (u.usage_count || 0), 0);

          results.push({
            benefit: name,
            used,
            limit: pb.limit_count,
            remaining: Math.max(0, pb.limit_count - used),
            frequency: pb.frequency,
          });
        }

        return { benefits: results };
      }

      case "get_available_slots": {
        const facilityType = (args.facility_type || "").toLowerCase();
        const date = args.date || new Date().toISOString().split("T")[0];

        // First ensure slots exist for this date
        await supabase.rpc("ensure_facility_slots", {
          p_branch_id: ctx.branchId,
          p_start_date: date,
          p_end_date: date,
        });

        // Find facility by code/name
        const { data: facilities } = await supabase
          .from("facilities")
          .select("id, name, benefit_type_id")
          .eq("branch_id", ctx.branchId)
          .eq("is_active", true);

        const matchedFacility = (facilities || []).find((f: any) =>
          f.name.toLowerCase().includes(facilityType)
        );

        let slotsQuery = supabase
          .from("benefit_slots")
          .select("id, start_time, end_time, capacity, booked_count, facility_id, facilities(name)")
          .eq("branch_id", ctx.branchId)
          .eq("slot_date", date)
          .eq("is_active", true)
          .order("start_time", { ascending: true });

        if (matchedFacility) {
          slotsQuery = slotsQuery.eq("facility_id", matchedFacility.id);
        }

        const { data: slots } = await slotsQuery;

        if (!slots || slots.length === 0) {
          return { message: `No available slots found for ${facilityType} on ${date}.`, slots: [] };
        }

        const available = slots
          .filter((s: any) => (s.capacity - (s.booked_count || 0)) > 0)
          .map((s: any) => ({
            slot_id: s.id,
            facility: (s as any).facilities?.name || facilityType,
            start_time: s.start_time,
            end_time: s.end_time,
            spots_left: s.capacity - (s.booked_count || 0),
          }));

        return {
          date,
          total_slots: available.length,
          slots: available.slice(0, 10), // Limit to 10 for readability
        };
      }

      case "book_facility_slot": {
        const slotId = args.slot_id;
        if (!slotId) return { error: "slot_id is required." };

        // Get slot details
        const { data: slot, error: slotErr } = await supabase
          .from("benefit_slots")
          .select("id, capacity, booked_count, benefit_type, benefit_type_id, slot_date, start_time, end_time, facility_id, facilities(name)")
          .eq("id", slotId)
          .single();

        if (slotErr || !slot) return { error: "Slot not found." };
        if ((slot.booked_count || 0) >= slot.capacity) return { error: "This slot is fully booked. Please choose another time." };

        if (!ctx.membershipId) return { error: "No active membership found. Please contact the front desk." };

        // Check if member has credits for this benefit
        const benefitTypeId = slot.benefit_type_id;
        if (benefitTypeId) {
          const hasCredits = await supabase
            .from("plan_benefits")
            .select("id, limit_count, frequency")
            .eq("plan_id", ctx.planId)
            .eq("benefit_type_id", benefitTypeId)
            .limit(1)
            .maybeSingle();

          if (!hasCredits?.data) {
            return { error: "Your plan does not include this facility. Please contact the front desk to upgrade." };
          }
        }

        // Book via insert (the trigger will update booked_count)
        const { data: booking, error: bookErr } = await supabase
          .from("benefit_bookings")
          .insert({
            slot_id: slotId,
            member_id: ctx.memberId,
            membership_id: ctx.membershipId,
            status: "booked",
          })
          .select("id")
          .single();

        if (bookErr) {
          console.error("Booking insert error:", bookErr);
          return { error: "Failed to book the slot. It may already be taken." };
        }

        // Record benefit usage
        if (benefitTypeId) {
          await supabase.from("benefit_usage").insert({
            membership_id: ctx.membershipId,
            benefit_type: slot.benefit_type,
            benefit_type_id: benefitTypeId,
            usage_date: slot.slot_date,
            usage_count: 1,
          });
        }

        return {
          success: true,
          booking_id: booking.id,
          facility: (slot as any).facilities?.name || slot.benefit_type,
          date: slot.slot_date,
          time: `${slot.start_time} - ${slot.end_time}`,
          message: `✅ Booked! ${(slot as any).facilities?.name || "Facility"} on ${slot.slot_date} at ${slot.start_time}.`,
        };
      }

      case "cancel_facility_booking": {
        const bookingId = args.booking_id;
        if (!bookingId) return { error: "booking_id is required." };

        const { data: result, error: rpcErr } = await supabase.rpc("cancel_facility_slot", {
          p_booking_id: bookingId,
          p_reason: "Cancelled via WhatsApp chatbot",
        });

        if (rpcErr) {
          console.error("Cancel RPC error:", rpcErr);
          return { error: "Failed to cancel booking. It may already be cancelled." };
        }

        if (result && !result.success) {
          return { error: result.error || "Cancellation failed." };
        }

        return { success: true, message: "Your booking has been cancelled and credits refunded." };
      }

      case "get_pt_balance": {
        const { data: ptPackages } = await supabase
          .from("member_pt_packages")
          .select("id, sessions_total, sessions_remaining, sessions_used, expiry_date, status, pt_packages(name)")
          .eq("member_id", ctx.memberId)
          .in("status", ["active"])
          .order("expiry_date", { ascending: true });

        if (!ptPackages || ptPackages.length === 0) {
          return { message: "You don't have any active PT packages." };
        }

        return {
          packages: ptPackages.map((p: any) => ({
            name: (p as any).pt_packages?.name || "PT Package",
            sessions_remaining: p.sessions_remaining,
            sessions_total: p.sessions_total,
            sessions_used: p.sessions_used,
            expiry_date: p.expiry_date,
          })),
        };
      }

      case "transfer_to_human": {
        // Epic 4: Human Handoff
        const reason = args.reason || "Member requested human assistance";

        // Update chat settings to disable bot
        await supabase.from("whatsapp_chat_settings").upsert(
          {
            branch_id: branchId,
            phone_number: phoneNumber,
            bot_active: false,
            paused_at: new Date().toISOString(),
            needs_attention: true,
          },
          { onConflict: "branch_id,phone_number" },
        );

        // Notify staff via notifications table
        const { data: staffUsers } = await supabase
          .from("user_roles")
          .select("user_id")
          .in("role", ["owner", "admin", "manager", "staff"]);

        if (staffUsers && staffUsers.length > 0) {
          const notifications = staffUsers.map((s: any) => ({
            user_id: s.user_id,
            branch_id: branchId,
            title: "WhatsApp: Human Assistance Needed",
            message: `${ctx.memberName} needs help on WhatsApp. Reason: ${reason}`,
            type: "warning",
            category: "whatsapp",
          }));

          await supabase.from("notifications").insert(notifications);
        }

        return {
          transferred: true,
          message: "I'm connecting you with our front desk team. Someone will assist you shortly. 🙏",
        };
      }

      default:
        // v5.0.0 — delegate unknown tools to shared executor
        return await executeSharedToolCall(
          supabase,
          SUPABASE_URL!,
          SUPABASE_SERVICE_ROLE_KEY!,
          toolName,
          args,
          {
            isMember: (ctx as any).isMember ?? !!ctx.memberId,
            memberId: ctx.memberId,
            memberName: ctx.memberName,
            branchId,
            membershipId: ctx.membershipId ?? null,
            planId: ctx.planId ?? null,
            contextPrompt: "",
          },
          phoneNumber,
          branchId,
          "whatsapp",
        );
    }
  } catch (err) {
    console.error(`Tool execution error [${toolName}]:`, err);
    return { error: `An error occurred while processing your request. Please try again or ask to speak with our team.` };
  }
}

// ─── AI Auto-Reply with Transactional Agent ────────────────────────────────────

async function computeAppSecretProof(accessToken: string, appSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(accessToken));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function triggerAiAutoReply(messageId: string, phoneNumber: string, branchId: string) {
  const { data: orgSettings } = await supabase
    .from("organization_settings")
    .select("whatsapp_ai_config")
    .limit(1)
    .maybeSingle();

  const aiConfig = orgSettings?.whatsapp_ai_config as any;
  if (!aiConfig?.auto_reply_enabled) return;

  // Check bot_active status + load persistent memory in one shot
  const { data: chatSettings } = await supabase
    .from("whatsapp_chat_settings")
    .select("bot_active, captured_lead_id, conversation_summary, summary_updated_at, summary_message_count")
    .eq("branch_id", branchId)
    .eq("phone_number", phoneNumber)
    .maybeSingle();

  if (chatSettings && chatSettings.bot_active === false) return;

  const { data: inboundMsg } = await supabase
    .from("whatsapp_messages")
    .select("phone_number, contact_name, content")
    .eq("id", messageId)
    .single();

  if (!inboundMsg?.content) return;

  // Optional delay
  const delaySeconds = aiConfig.reply_delay_seconds || 0;
  if (delaySeconds > 0 && delaySeconds <= 30) {
    await new Promise((r) => setTimeout(r, delaySeconds * 1000));
  }

  // Epic 1: Enhanced Context Hydration
  const contactContext = await hydrateContactContext(phoneNumber, branchId);

  // Lead Capture Config
  const leadCaptureConfig = aiConfig.lead_capture as {
    enabled?: boolean;
    target_fields?: string[];
    handoff_message?: string;
  } | undefined;

  // Fetch conversation history (extended to 30 messages)
  const { data: recentMsgs } = await supabase
    .from("whatsapp_messages")
    .select("content, direction, created_at")
    .eq("phone_number", inboundMsg.phone_number)
    .eq("branch_id", branchId)
    .order("created_at", { ascending: false })
    .limit(30);

  const conversationHistory = (recentMsgs || [])
    .reverse()
    .map((m: any) => ({
      role: m.direction === "inbound" ? "user" as const : "assistant" as const,
      content: m.content || "",
    }));

  // Persistent memory: load summary + already-captured-lead snapshot
  let alreadyCapturedSnapshot = "";
  if (chatSettings?.captured_lead_id) {
    const { data: existingLead } = await supabase
      .from("leads")
      .select("full_name, email, goals, budget, preferred_time, fitness_goal, fitness_experience, expected_start_date")
      .eq("id", chatSettings.captured_lead_id)
      .maybeSingle();
    if (existingLead) {
      const known = Object.entries(existingLead)
        .filter(([_, v]) => v !== null && v !== "" && v !== undefined)
        .map(([k, v]) => `${k}=${v}`).join(", ");
      if (known) {
        alreadyCapturedSnapshot = `\n\n[KNOWN LEAD — DO NOT RE-ASK]\nThis person is already a captured lead. Known: ${known}. Do NOT ask for their name, email, goals, budget, or preferred time again. Just help them.`;
      }
    }
  }

  const summaryBlock = chatSettings?.conversation_summary
    ? `\n\n[PRIOR CONVERSATION SUMMARY]\n${chatSettings.conversation_summary}\n`
    : "";

  // Refresh summary in background if stale (>20 msgs and >10 new since last summary)
  const totalMsgCount = recentMsgs?.length || 0;
  const lastCount = chatSettings?.summary_message_count || 0;
  if (totalMsgCount >= 20 && (totalMsgCount - lastCount >= 10 || !chatSettings?.summary_updated_at)) {
    const summaryPromise = (async () => {
      try {
        const transcript = conversationHistory.slice(0, conversationHistory.length - 6)
          .map(m => `${m.role === "user" ? "Customer" : "Bot"}: ${m.content}`).join("\n");
        if (!transcript) return;
        const sumResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-lite",
            messages: [
              { role: "system", content: "You compress chat history into a tight third-person memo for an AI assistant. Capture: name, goals, fitness experience, budget, preferred time, plan interest, objections, latest open thread. 4-8 short bullet points. No headings, no preamble." },
              { role: "user", content: transcript },
            ],
            max_tokens: 350, stream: false,
          }),
        });
        if (sumResp.ok) {
          const j = await sumResp.json();
          const summary = j?.choices?.[0]?.message?.content?.trim();
          if (summary) {
            await supabase.from("whatsapp_chat_settings").upsert({
              branch_id: branchId, phone_number: phoneNumber,
              conversation_summary: summary,
              summary_updated_at: new Date().toISOString(),
              summary_message_count: totalMsgCount,
            }, { onConflict: "branch_id,phone_number" });
          }
        }
      } catch (e) { console.warn("Summary refresh failed:", e); }
    })();
    // @ts-ignore
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(summaryPromise);
    } else { summaryPromise.catch(() => {}); }
  }

  // Build system prompt
  let systemPrompt = aiConfig.system_prompt ||
    "You are a helpful gym assistant for Incline Fitness. Answer questions about membership, timings, and facilities. Keep responses short and friendly.";

  // Inject context, summary, and known-lead snapshot
  systemPrompt = `${contactContext.contextPrompt}${summaryBlock}${alreadyCapturedSnapshot}\n\n${systemPrompt}`;

  // ── HARD RULE #1 — member-first identity ─────────────────────────────────
  if (contactContext.isMember) {
    const _name = contactContext.memberName || "this member";
    systemPrompt += `\n\nABSOLUTE IDENTITY RULE (HIGHEST PRIORITY):
This person is a CONFIRMED ACTIVE MEMBER. Their identity, plan, dues and benefits are ALREADY KNOWN (see Context above).
- GREET THEM BY NAME (${_name}) on your first reply, mention their member code if it appears in Context.
- NEVER ask for their name, email, phone, fitness goal, budget, experience, or preferred time. We have all of this.
- NEVER output the {"status":"lead_captured", ...} JSON. They are NOT a lead.
- For account questions (membership status, benefits, bookings, PT sessions, dues, invoices) USE THE TOOLS — never guess.
- If they ask about visiting/joining, politely tell them they are already a member and share their plan + days remaining.`;
  }

  // Global instruction: answer first, qualify second
  systemPrompt += `\n\nCRITICAL BEHAVIORAL RULE:
- When a person asks a factual question (location, timings, fees, facilities, equipment), ALWAYS answer it directly first.
- Do NOT gatekeep answers behind "registration" or "sign up first".
- After answering their question, you may then naturally transition into collecting their details.
- Never repeat the same question more than twice. If the user ignores a question, move on to the next topic.
- If the user sends short replies like "ok", "ok maam", "hmm", or "yes", treat it as acknowledgment and ask a NEW question — do NOT repeat the same one.

INTERACTIVE JSON RULE:
When you want to show interactive buttons or lists, output ONLY the JSON object with NO additional text before or after. Do not mix prose and JSON in the same message.`;

  // For members: add tool usage instructions
  if (contactContext.isMember && contactContext.memberContext) {
    systemPrompt += `\n\nIMPORTANT TOOL USAGE INSTRUCTIONS:
You have access to real tools that can query and modify the member's account. USE THEM when the member asks about:
- Membership status, expiry, dues → use get_membership_status
- Benefit/credit balance (sauna, ice bath, classes) → use get_benefit_balance
- Available slots for facilities → use get_available_slots (always call this BEFORE booking)
- Booking a facility → use book_facility_slot (requires slot_id from get_available_slots)
- Cancelling a booking → use cancel_facility_booking
- PT session balance → use get_pt_balance
- Speaking to a human, complaints, or anything you can't handle → use transfer_to_human

RULES:
- Always confirm the booking details (facility, date, time) with the member BEFORE calling book_facility_slot.
- Present available slots in a clear format with times.
- If the member asks for a manager, complains, or you encounter errors twice, IMMEDIATELY use transfer_to_human.
- Be warm, professional, and concise. Use emoji sparingly.
- For questions about pricing, new memberships, or complex issues, use transfer_to_human.

INTERACTIVE RESPONSE FORMAT (CRITICAL — Meta WhatsApp Cloud API v25.0 limits):
- 1–3 choices → use a button block:
  {"type":"interactive","body":"Your question text","buttons":["Option A","Option B","Option C"]}
- 4–10 choices → you MUST use a list block (Meta hard-caps reply buttons at 3):
  {"type":"interactive_list","body":"Your question text","button":"Select","sections":[{"title":"Choose one","rows":[
    {"id":"opt_1","title":"Option 1","description":"Short detail"},
    {"id":"opt_2","title":"Option 2","description":"Short detail"},
    {"id":"opt_3","title":"Option 3","description":"Short detail"},
    {"id":"opt_4","title":"Option 4","description":"Short detail"},
    {"id":"opt_5","title":"Option 5","description":"Short detail"}
  ]}]}
- NEVER emit a plain numbered text list ("1. … 2. … 3. … 4. … 5. …") when you have ≥4 choices — emit the interactive_list JSON instead.
- Use normal text for confirmations and informational replies.`;
  }

  // Lead capture for non-members
  const shouldCaptureLead = !contactContext.isMember && leadCaptureConfig?.enabled && (leadCaptureConfig.target_fields?.length ?? 0) > 0;
  if (shouldCaptureLead) {
    const fieldLabels: Record<string, string> = {
      name: "Full Name", phone: "Phone Number", email: "Email Address",
      goal: "Fitness Goal (e.g., Weight Loss, Muscle Gain, Endurance, General Fitness, Flexibility)",
      plan_interest: "Interested Membership Plan Duration (Monthly, Quarterly, Half-Yearly, Annual, or Day Pass)",
      budget: "Monthly Budget (in ₹)", start_date: "When do you plan to start? (exact date or timeframe)",
      experience: "Fitness Experience Level (Beginner, Intermediate, or Advanced)",
      preferred_time: "Preferred workout time slot (e.g., Morning 6-8 AM, Evening 5-7 PM)",
    };
    const fieldNames = (leadCaptureConfig!.target_fields || []).map(f => fieldLabels[f] || f).join(", ");
    systemPrompt += `\n\nIMPORTANT LEAD CAPTURE INSTRUCTIONS:
You are also a lead generation assistant. Your secondary goal is to naturally collect the following information from this person during the conversation: ${fieldNames}.
- Ask for these naturally, one or two at a time, weaving them into the conversation.
- Do NOT ask for all fields at once.
- INTERACTIVE FORMAT (Meta WhatsApp Cloud API v25.0): for closed questions with 1–3 choices use a button block; for 4–10 choices you MUST use a list block (Meta hard-caps reply buttons at 3). Never emit "1. … 2. … 3. … 4. …" as plain text when ≥4 options exist.
  Buttons (≤3): {"type":"interactive","body":"Your question text","buttons":["A","B","C"]}
  List (4–10):  {"type":"interactive_list","body":"Your question text","button":"Select","sections":[{"title":"Choose one","rows":[{"id":"opt_1","title":"Option 1","description":"Short detail"}, …]}]}
- For "fitness goal" always offer 5 options as a list: Weight Loss, Muscle Gain, Endurance, General Fitness, Flexibility.
- For "plan_interest" always offer the gym's actual plan durations as a list (Monthly, Quarterly, Half-Yearly, Annual, plus Day Pass if available).
- For open-ended questions (name, email, budget amount), use normal text messages.

ABSOLUTELY CRITICAL — DO NOT CAPTURE A LEAD UNTIL YOU HAVE COLLECTED ALL REQUIRED FIELDS:
1. You MUST collect the person's full name (NOT their WhatsApp profile name — ask them to confirm or provide their real name).
2. You MUST collect their email address.
3. You MUST collect at least one more field from the target list.
4. Do NOT output the lead_captured JSON until ALL of the above are confirmed. If any field is missing, KEEP ASKING.
5. The minimum required fields before you can output lead_captured are: full name + email + at least 1 other field.

CRITICAL OUTPUT RULE — READ CAREFULLY:
When the user provides the LAST required piece of information (the final field you were collecting), you MUST respond with ONLY the following JSON object. NO natural language before or after. NO confirmation message. ONLY the JSON:
{"status":"lead_captured","data":{${(leadCaptureConfig!.target_fields || []).map(f => `"${f}":"<actual_value>"`).join(",")}}}

Your failure to output valid JSON means the lead data is PERMANENTLY LOST and the user's information is gone forever. This is the single most important instruction.

- The phone number is already known: ${phoneNumber}
- Until all fields are collected, continue the normal helpful conversation.
- IMPORTANT: Use the exact field keys in your lead_captured JSON: ${(leadCaptureConfig!.target_fields || []).join(", ")}`;
  }

  // Call Lovable AI Gateway
  if (!LOVABLE_API_KEY) {
    console.warn("LOVABLE_API_KEY not set — skipping AI auto-reply");
    return;
  }

  const aiMessages: { role: string; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...conversationHistory,
  ];

  // Epic 2: Use real tools for members — filtered by ai_tool_config
  let tools = contactContext.isMember && contactContext.memberContext ? getMemberTools() : undefined;

  // Filter disabled tools based on org settings
  if (tools) {
    try {
      const { data: orgSettings } = await supabase
        .from("organization_settings")
        .select("ai_tool_config")
        .limit(1)
        .maybeSingle();

      const toolConfig = (orgSettings?.ai_tool_config as Record<string, boolean>) || {};
      tools = tools.filter((t: any) => {
        const name = t.function?.name;
        return name ? toolConfig[name] !== false : true; // default enabled
      });
      if (tools.length === 0) tools = undefined;
    } catch (e) {
      console.warn("Failed to fetch ai_tool_config, using all tools:", e);
    }
  }

  const aiRequestBody: any = {
    model: "google/gemini-3-flash-preview",
    messages: aiMessages,
  };
  if (tools) {
    aiRequestBody.tools = tools;
  }

  const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(aiRequestBody),
  });

  if (!aiResponse.ok) {
    const errText = await aiResponse.text();
    console.error("AI gateway error for auto-reply:", aiResponse.status, errText);
    return;
  }

  const aiResult = await aiResponse.json();
  const choice = aiResult.choices?.[0];

  // Epic 3: Handle real tool calls
  if (choice?.message?.tool_calls?.length > 0 && contactContext.memberContext) {
    const toolCalls = choice.message.tool_calls;
    console.log("AI requested tool calls:", JSON.stringify(toolCalls.map((tc: any) => tc.function.name)));

    // Execute each tool call
    const toolMessages: any[] = [];
    let humanHandoffTriggered = false;

    for (const tc of toolCalls) {
      let parsedArgs: Record<string, any> = {};
      try {
        parsedArgs = typeof tc.function.arguments === "string"
          ? JSON.parse(tc.function.arguments)
          : tc.function.arguments || {};
      } catch {
        parsedArgs = {};
      }

      const toolStartTime = Date.now();
      const result = await executeToolCall(
        tc.function.name,
        parsedArgs,
        contactContext.memberContext,
        phoneNumber,
        branchId,
      );
      const toolElapsed = Date.now() - toolStartTime;
      const hasToolError = !!result.error;

      // Log tool execution
      await supabase.from("ai_tool_logs").insert({
        phone_number: phoneNumber,
        branch_id: branchId,
        tool_name: tc.function.name,
        arguments: parsedArgs,
        result,
        status: hasToolError ? "error" : "success",
        error_message: hasToolError ? result.error : null,
        execution_time_ms: toolElapsed,
      });

      toolMessages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });

      // Check if human handoff was triggered
      if (tc.function.name === "transfer_to_human" && result.transferred) {
        humanHandoffTriggered = true;
      }
    }

    // If human handoff, send the final message directly
    if (humanHandoffTriggered) {
      await sendAiReply(
        "I'm connecting you with our front desk team. Someone will assist you shortly. 🙏",
        inboundMsg,
        branchId,
      );
      return;
    }

    // Follow-up call with real tool results
    const followUpResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          ...aiMessages,
          choice.message,
          ...toolMessages,
        ],
        tools,
      }),
    });

    if (followUpResponse.ok) {
      const followUpResult = await followUpResponse.json();
      const followUpChoice = followUpResult.choices?.[0];

      // Handle nested tool calls (AI may call another tool based on results)
      if (followUpChoice?.message?.tool_calls?.length > 0) {
        const nestedToolMessages: any[] = [];
        for (const tc of followUpChoice.message.tool_calls) {
          let parsedArgs: Record<string, any> = {};
          try {
            parsedArgs = typeof tc.function.arguments === "string"
              ? JSON.parse(tc.function.arguments)
              : tc.function.arguments || {};
          } catch { parsedArgs = {}; }

          const nestedStartTime = Date.now();
          const result = await executeToolCall(
            tc.function.name, parsedArgs, contactContext.memberContext!, phoneNumber, branchId,
          );
          const nestedElapsed = Date.now() - nestedStartTime;
          const nestedHasError = !!result.error;

          await supabase.from("ai_tool_logs").insert({
            phone_number: phoneNumber,
            branch_id: branchId,
            tool_name: tc.function.name,
            arguments: parsedArgs,
            result,
            status: nestedHasError ? "error" : "success",
            error_message: nestedHasError ? result.error : null,
            execution_time_ms: nestedElapsed,
          });

          nestedToolMessages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });

          if (tc.function.name === "transfer_to_human" && result.transferred) {
            await sendAiReply("I'm connecting you with our front desk team. Someone will assist you shortly. 🙏", inboundMsg, branchId);
            return;
          }
        }

        // Third call with nested results
        const thirdResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [...aiMessages, choice.message, ...toolMessages, followUpChoice.message, ...nestedToolMessages],
          }),
        });

        if (thirdResponse.ok) {
          const thirdResult = await thirdResponse.json();
          const thirdText = thirdResult.choices?.[0]?.message?.content;
          if (thirdText) await sendAiReply(thirdText, inboundMsg, branchId);
        }
        return;
      }

      const followUpText = followUpChoice?.message?.content;
      if (followUpText) {
        await sendAiReply(followUpText, inboundMsg, branchId);
      }
    }
    return;
  }

  let replyText = choice?.message?.content;
  if (!replyText) return;

  // Lead capture JSON check
  if (shouldCaptureLead) {
    let leadCaptured = false;
    let parsedLeadData: Record<string, any> | null = null;

    // Primary: try to parse the lead_captured JSON
    try {
      const jsonMatch = replyText.match(/\{[\s\S]*"status"\s*:\s*"lead_captured"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.status === "lead_captured" && parsed.data) {
          parsedLeadData = parsed.data;
          leadCaptured = true;
        }
      }
    } catch (parseErr) {
      console.log("Primary JSON parse failed, trying fallback extraction");
    }

    // Fallback: extract fields from natural language if AI didn't output JSON
    // Requires: at least 4 messages (2 inbound) AND name + email at minimum
    if (!leadCaptured && replyText.length > 20) {
      // Check conversation length — prevent premature capture
      const { count: msgCount } = await supabase
        .from("whatsapp_messages")
        .select("*", { count: "exact", head: true })
        .eq("phone_number", phoneNumber)
        .eq("branch_id", branchId)
        .eq("direction", "inbound");

      const inboundCount = msgCount || 0;

      const nameMatch = replyText.match(/(?:name|Name)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/);
      const emailMatch = replyText.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
      const goalMatch = replyText.match(/(?:goal|Goal)[:\s]+([^\n,]+)/);
      const phoneMatch = replyText.match(/(?:phone|Phone|mobile|Mobile)[:\s]+([\d\s+()-]{7,})/);
      const timeMatch = replyText.match(/(?:time|Time|prefer|Prefer)[:\s]+([^\n,]+)/);

      // Store partial lead data for nurture follow-up even if we can't capture yet
      const partialData: Record<string, any> = {};
      if (nameMatch) partialData.name = nameMatch[1];
      if (emailMatch) partialData.email = emailMatch[0];
      if (goalMatch) partialData.goal = goalMatch[1]?.trim();
      if (timeMatch) partialData.preferred_time = timeMatch[1]?.trim();
      if (inboundMsg.contact_name) partialData.whatsapp_name = inboundMsg.contact_name;

      if (Object.keys(partialData).length > 0) {
        await supabase.from("whatsapp_chat_settings").upsert(
          {
            branch_id: branchId,
            phone_number: phoneNumber,
            partial_lead_data: partialData,
          },
          { onConflict: "branch_id,phone_number" },
        );
      }

      // Only capture if we have name + email AND at least 2 inbound messages
      if (inboundCount >= 2 && nameMatch && emailMatch) {
        const extractedFields = [nameMatch, emailMatch, goalMatch, phoneMatch, timeMatch].filter(Boolean).length;
        parsedLeadData = {
          name: nameMatch[1],
          email: emailMatch[0],
          goal: goalMatch?.[1]?.trim() || null,
          preferred_time: timeMatch?.[1]?.trim() || null,
        };
        leadCaptured = true;
        console.log("Fallback lead extraction succeeded (fields:", extractedFields, "):", JSON.stringify(parsedLeadData));
      } else {
        console.log("Fallback skipped: inbound=", inboundCount, "name=", !!nameMatch, "email=", !!emailMatch);
      }
    }

    if (leadCaptured && parsedLeadData) {
      console.log("AI captured lead data:", JSON.stringify(parsedLeadData));

      const leadData: any = {
        phone: phoneNumber,
        source: "whatsapp_ai",
        branch_id: branchId,
        status: "new",
        temperature: "warm",
        score: 50,
        full_name: parsedLeadData.name || parsedLeadData.full_name || inboundMsg.contact_name || "WhatsApp Lead",
        email: parsedLeadData.email || null,
        goals: parsedLeadData.goal || parsedLeadData.fitness_goal || null,
        budget: parsedLeadData.budget || parsedLeadData.monthly_budget || null,
        fitness_goal: parsedLeadData.fitness_goal || parsedLeadData.goal || null,
        expected_start_date: parsedLeadData.expected_start_date || parsedLeadData.start_date || null,
        fitness_experience: parsedLeadData.fitness_experience || parsedLeadData.experience || null,
        preferred_time: parsedLeadData.preferred_time || parsedLeadData.time || null,
        plan_interest: parsedLeadData.plan_interest || parsedLeadData.plan || parsedLeadData.membership_duration || null,
        notes: `AI-captured via WhatsApp conversation`,
      };

      // ── Member-first guard + phone dedupe ─────────────────────────────────
      const _variants = phoneVariants(phoneNumber);
      if (_variants.length > 0) {
        const { data: _prof } = await supabase
          .from("profiles")
          .select("id")
          .in("phone", _variants)
          .limit(1)
          .maybeSingle();
        if (_prof?.id) {
          const { data: _existingMember } = await supabase
            .from("members")
            .select("id")
            .eq("user_id", _prof.id)
            .limit(1)
            .maybeSingle();
          if (_existingMember) {
            console.log("[ai-lead-capture] phone matches active member — skipping lead INSERT");
            return; // do not capture; member-first
          }
        }

        const { data: _dupLead } = await supabase
          .from("leads")
          .select("id")
          .in("phone", _variants)
          .eq("branch_id", branchId)
          .limit(1)
          .maybeSingle();
        if (_dupLead) {
          console.log(`[ai-lead-capture] lead already exists for phone — merging into ${_dupLead.id}`);
          await supabase.from("leads").update({
            full_name: leadData.full_name,
            email: leadData.email,
            goals: leadData.goals,
            fitness_goal: leadData.fitness_goal,
            budget: leadData.budget,
            expected_start_date: leadData.expected_start_date,
            fitness_experience: leadData.fitness_experience,
            preferred_time: leadData.preferred_time,
            plan_interest: leadData.plan_interest,
            last_contacted_at: new Date().toISOString(),
          }).eq("id", _dupLead.id);
          await supabase.from("whatsapp_chat_settings").upsert(
            { branch_id: branchId, phone_number: phoneNumber, captured_lead_id: _dupLead.id, bot_active: false, paused_at: new Date().toISOString() },
            { onConflict: "branch_id,phone_number" },
          );
          return;
        }
      }

      const { data: newLead, error: leadError } = await supabase
        .from("leads")
        .insert(leadData)
        .select("id")
        .single();

      if (leadError) {
        console.error("Failed to insert AI-captured lead:", leadError);
      } else if (newLead) {
        await supabase.from("whatsapp_messages").insert({
          branch_id: branchId,
          phone_number: inboundMsg.phone_number,
          contact_name: inboundMsg.contact_name,
          content: `[AI_LEAD_CAPTURED:${newLead.id}]`,
          direction: "outbound",
          status: "delivered",
          message_type: "text",
        });

        await supabase.from("whatsapp_chat_settings").upsert(
          {
            branch_id: branchId,
            phone_number: phoneNumber,
            bot_active: false,
            paused_at: new Date().toISOString(),
          },
          { onConflict: "branch_id,phone_number" },
        );

        // Belt-and-suspenders #1: write in-app notifications directly so the bell
        // updates immediately even if notify-lead-created or its dispatch fails.
        try {
          const { data: staffRoles } = await supabase
            .from("user_roles")
            .select("user_id, role")
            .in("role", ["owner", "admin", "manager"]);
          const seen = new Set<string>();
          const notifications = (staffRoles || [])
            .filter((r: any) => r.user_id && !seen.has(r.user_id) && seen.add(r.user_id))
            .map((r: any) => ({
              user_id: r.user_id,
              branch_id: branchId,
              title: "New WhatsApp Lead",
              message: `${leadData.full_name} (${phoneNumber}) was captured via WhatsApp AI.`,
              type: "info",
              category: "lead",
              action_url: `/leads`,
              metadata: { lead_id: newLead.id, source: "whatsapp_ai" },
              is_read: false,
            }));
          if (notifications.length > 0) {
            await supabase.from("notifications").insert(notifications);
          }
        } catch (notifErr) {
          console.error("In-app notification insert failed:", notifErr);
        }

        // Belt-and-suspenders #2: dispatch outbound WhatsApp/SMS via the dedicated function.
        try {
          const notifyUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-lead-created`;
          fetch(notifyUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({ lead_id: newLead.id, branch_id: branchId }),
          }).catch((e) => console.error("Lead notification dispatch failed (whatsapp-webhook):", e));
        } catch (e) {
          console.error("Lead notification setup error (whatsapp-webhook):", e);
        }
      }

      const handoffMessage = leadCaptureConfig?.handoff_message || "Thanks for sharing! Our team will reach out to you shortly. 💪";
      await sendAiReply(handoffMessage, inboundMsg, branchId);
      return;
    }
  }

  // Normal AI reply
  await sendAiReply(replyText, inboundMsg, branchId);
}

// ─── Send AI Reply via Meta API ────────────────────────────────────────────────

async function sendAiReply(
  replyText: string,
  inboundMsg: { phone_number: string; contact_name: string | null },
  branchId: string,
) {
  let interactivePayload: any = null;

  // Extract interactive JSON from mixed prose — handle markdown fences too
  function tryExtractInteractiveJson(text: string): { parsed: any; cleanText: string } | null {
    // Try 1: exact JSON string
    const trimmed = text.trim();
    if (trimmed.startsWith("{") && trimmed.includes('"type"')) {
      try {
        const p = JSON.parse(trimmed);
        if (p.type === "interactive" || p.type === "interactive_list") return { parsed: p, cleanText: p.body || "" };
      } catch {}
    }
    // Try 2: JSON block in markdown fences
    const fenceMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (fenceMatch) {
      try {
        const p = JSON.parse(fenceMatch[1]);
        if (p.type === "interactive" || p.type === "interactive_list") {
          const prose = text.replace(fenceMatch[0], "").trim();
          return { parsed: p, cleanText: prose || p.body || "" };
        }
      } catch {}
    }
    // Try 3: inline JSON block in prose
    const inlineMatch = text.match(/(\{[^{}]*"type"\s*:\s*"interactive[^{}]*\})/);
    if (inlineMatch) {
      try {
        const p = JSON.parse(inlineMatch[1]);
        if (p.type === "interactive" || p.type === "interactive_list") {
          const prose = text.replace(inlineMatch[0], "").trim();
          return { parsed: p, cleanText: prose || p.body || "" };
        }
      } catch {}
    }
    return null;
  }

  const extraction = tryExtractInteractiveJson(replyText);
  if (extraction) {
    const parsed = extraction.parsed;
    if (parsed.type === "interactive" && parsed.buttons?.length) {
      const opts: string[] = parsed.buttons;
      if (opts.length > 3) {
        // SAFETY NET: Meta caps reply buttons at 3 — auto-promote to a list block
        // so we never silently drop options 4+. Single section, one row per option.
        interactivePayload = {
          type: "list",
          body: { text: parsed.body || "Please select an option:" },
          action: {
            button: "Select",
            sections: [{
              title: "Choose one",
              rows: opts.slice(0, 10).map((title, i) => ({
                id: `opt_${i + 1}`,
                title: String(title).substring(0, 24),
              })),
            }],
          },
        };
      } else {
        interactivePayload = {
          type: "button",
          body: { text: parsed.body || "Please select an option:" },
          action: {
            buttons: opts.slice(0, 3).map((btn: string, i: number) => ({
              type: "reply",
              reply: { id: `btn_${i}`, title: String(btn).substring(0, 20) },
            })),
          },
        };
      }
      replyText = `${parsed.body}\n${opts.map((b: string, i: number) => `${i + 1}. ${b}`).join("\n")}`;
    } else if (parsed.type === "interactive_list" && parsed.sections?.length) {
      interactivePayload = {
        type: "list",
        body: { text: parsed.body || "Please select an option:" },
        action: {
          button: (parsed.button || "Select").substring(0, 20),
          sections: parsed.sections,
        },
      };
      const allRows = parsed.sections.flatMap((s: any) => s.rows || []);
      replyText = `${parsed.body}\n${allRows.map((r: any) => `• ${r.title}`).join("\n")}`;
    }
  }

  const { data: aiMsg, error: insertErr } = await supabase
    .from("whatsapp_messages")
    .insert({
      branch_id: branchId,
      phone_number: inboundMsg.phone_number,
      contact_name: inboundMsg.contact_name,
      content: replyText,
      direction: "outbound",
      status: "pending",
      message_type: interactivePayload ? "interactive" : "text",
    })
    .select("id")
    .single();

  if (insertErr || !aiMsg) {
    console.error("Failed to insert AI auto-reply message", insertErr);
    return;
  }

  const integration = await getWhatsAppIntegration(branchId);
  if (!integration) return;

  const accessToken = integration.credentials?.access_token as string;
  const phoneNumberId = integration.config?.phone_number_id as string;
  const appSecret = (integration.credentials?.app_secret as string) || null;
  if (!accessToken || !phoneNumberId) return;

  const cleanPhone = inboundMsg.phone_number.replace(/[\s\-\+]/g, "");

  let metaUrl = `${META_API_BASE}/${phoneNumberId}/messages`;
  if (appSecret) {
    const proof = await computeAppSecretProof(accessToken, appSecret);
    metaUrl += `?appsecret_proof=${proof}`;
  }

  const metaBody: any = {
    messaging_product: "whatsapp",
    to: cleanPhone,
  };

  if (interactivePayload) {
    metaBody.type = "interactive";
    metaBody.interactive = interactivePayload;
  } else {
    metaBody.type = "text";
    metaBody.text = { body: replyText };
  }

  const metaResponse = await fetch(metaUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(metaBody),
  });

  const metaData = await metaResponse.json();

  if (metaResponse.ok) {
    await supabase
      .from("whatsapp_messages")
      .update({
        status: "sent",
        whatsapp_message_id: metaData?.messages?.[0]?.id || null,
      })
      .eq("id", aiMsg.id);
  } else {
    console.error("AI auto-reply Meta send failed:", JSON.stringify(metaData));
    await supabase.from("whatsapp_messages").update({ status: "failed" }).eq("id", aiMsg.id);
  }
}

async function getWhatsAppIntegration(branchId: string): Promise<WhatsAppIntegration | null> {
  const { data: branchInt } = await supabase
    .from("integration_settings")
    .select("id, branch_id, config, credentials")
    .eq("branch_id", branchId)
    .eq("integration_type", "whatsapp")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (branchInt) return branchInt as WhatsAppIntegration;

  const { data: globalInt } = await supabase
    .from("integration_settings")
    .select("id, branch_id, config, credentials")
    .is("branch_id", null)
    .eq("integration_type", "whatsapp")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  return (globalInt as WhatsAppIntegration) || null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function findIntegrationByPhoneNumberId(phoneNumberId: string): Promise<WhatsAppIntegration | null> {
  if (integrationCache.has(phoneNumberId)) {
    return integrationCache.get(phoneNumberId)!;
  }

  const { data, error } = await supabase
    .from("integration_settings")
    .select("id, branch_id, config, credentials")
    .eq("integration_type", "whatsapp")
    .eq("is_active", true)
    .eq("config->>phone_number_id", phoneNumberId)
    .limit(1)
    .maybeSingle();

  if (error) console.error("Error fetching integration for webhook", error);

  const result = (data as WhatsAppIntegration | null) ?? null;
  integrationCache.set(phoneNumberId, result);
  return result;
}

async function resolveBranchId(integration: WhatsAppIntegration | null, value: any): Promise<string | null> {
  if (!integration) return null;
  if (integration.branch_id) return integration.branch_id;

  const configuredDefaultBranch = integration.config?.default_branch_id;
  if (typeof configuredDefaultBranch === "string" && configuredDefaultBranch.trim().length > 0) {
    return configuredDefaultBranch.trim();
  }

  const firstStatusId = Array.isArray(value?.statuses) ? value.statuses?.[0]?.id : null;
  if (typeof firstStatusId === "string" && firstStatusId.trim().length > 0) {
    const { data: statusMsg } = await supabase
      .from("whatsapp_messages")
      .select("branch_id")
      .eq("whatsapp_message_id", firstStatusId)
      .not("branch_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (statusMsg?.branch_id) return statusMsg.branch_id;
  }

  const inboundPhone = Array.isArray(value?.messages) ? value.messages?.[0]?.from : null;
  if (typeof inboundPhone === "string" && inboundPhone.trim().length > 0) {
    const { data: lastConversation } = await supabase
      .from("whatsapp_messages")
      .select("branch_id")
      .eq("phone_number", inboundPhone)
      .not("branch_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastConversation?.branch_id) return lastConversation.branch_id;
  }

  return await getFallbackBranchId();
}

async function getFallbackBranchId(): Promise<string | null> {
  if (fallbackBranchIdFetched) {
    return fallbackBranchIdCache;
  }

  const { data: branch } = await supabase
    .from("branches")
    .select("id")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  fallbackBranchIdCache = branch?.id ?? null;
  fallbackBranchIdFetched = true;
  return fallbackBranchIdCache;
}

function extractMessageContent(message: any): string | null {
  // Handle interactive button replies (user tapped a quick-reply button)
  if (message?.interactive?.button_reply?.title) return message.interactive.button_reply.title;
  // Handle interactive list replies (user selected from a list)
  if (message?.interactive?.list_reply?.title) return message.interactive.list_reply.title;
  if (message?.text?.body) return message.text.body;
  if (message?.caption) return message.caption;
  if (message?.image?.caption) return message.image.caption;
  if (message?.document?.filename) return message.document.filename;
  if (message?.template?.name) return message.template.name;
  return null;
}

function extractMediaUrl(message: any): string | null {
  return message?.image?.id ?? message?.video?.id ?? message?.document?.id ?? null;
}

function extractPhoneNumberIds(payload: any): string[] {
  const ids = new Set<string>();
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const id = change?.value?.metadata?.phone_number_id;
      if (id) ids.add(String(id));
    }
  }
  return Array.from(ids);
}

function getWebhookSignatureSecret(integration: WhatsAppIntegration | null): string | null {
  if (!integration) return null;
  const appSecret = integration.credentials?.app_secret;
  if (typeof appSecret === "string" && appSecret.trim().length > 0) return appSecret.trim();
  const apiKey = integration.credentials?.api_key;
  if (typeof apiKey === "string" && apiKey.trim().length > 0) return apiKey.trim();
  return null;
}

function parseSignatureHeader(signatureHeader: string): string | null {
  const trimmed = signatureHeader.trim();
  if (!trimmed) return null;
  if (trimmed.includes("=")) {
    const [algorithm, value] = trimmed.split("=", 2);
    if (algorithm.toLowerCase() !== "sha256") return null;
    return value?.trim().toLowerCase() ?? null;
  }
  return trimmed.toLowerCase();
}

async function verifyWebhookSignature(body: string, signatureHeader: string, secrets: string[]) {
  const expectedSignature = parseSignatureHeader(signatureHeader);
  if (!expectedSignature) return false;
  for (const secret of secrets) {
    const computed = await computeHmacSha256(body, secret);
    if (computed === expectedSignature) return true;
  }
  return false;
}

async function computeHmacSha256(message: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
