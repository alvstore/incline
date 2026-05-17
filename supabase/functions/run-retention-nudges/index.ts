// run-retention-nudges v2.1.0 — routes through dispatch-communication; skips members with frozen membership
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const results = { stage_1: 0, stage_2: 0, stage_3: 0, skipped_cooldown: 0, skipped_returned: 0, skipped_frozen: 0 };

    // Get all active branches
    const { data: branches } = await adminClient.from("branches").select("id").eq("is_active", true);
    if (!branches?.length) {
      return new Response(JSON.stringify({ success: true, message: "No active branches", results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get all active retention templates ordered by stage
    const { data: templates } = await adminClient
      .from("retention_templates")
      .select("*")
      .eq("is_active", true)
      .order("stage_level", { ascending: true });

    if (!templates?.length) {
      return new Response(JSON.stringify({ success: true, message: "No active templates", results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    for (const branch of branches) {
      // Get inactive members (5+ days absent, up to 200)
      const { data: inactiveMembers } = await adminClient.rpc("get_inactive_members", {
        p_branch_id: branch.id,
        p_days: 5,
        p_limit: 200,
      });

      if (!inactiveMembers?.length) continue;

      for (const member of inactiveMembers) {
        const daysAbsent = member.days_absent || 0;

        // DO-NOT-CONTACT GUARD: skip if member opted out of outreach.
        const { data: dncRow } = await adminClient
          .from("members")
          .select("do_not_contact, do_not_contact_until")
          .eq("id", member.member_id)
          .maybeSingle();
        if (dncRow?.do_not_contact) {
          continue;
        }
        if (dncRow?.do_not_contact_until && new Date(dncRow.do_not_contact_until) > new Date()) {
          continue;
        }

        // FREEZE GUARD: skip if member has any frozen membership currently
        const { count: frozenCount } = await adminClient
          .from("memberships")
          .select("id", { count: "exact", head: true })
          .eq("member_id", member.member_id)
          .eq("status", "frozen");
        if ((frozenCount || 0) > 0) {
          results.skipped_frozen++;
          continue;
        }

        // Find the appropriate template based on days absent
        // Stage 1 = first threshold, Stage 2 = second, Stage 3 = third
        // We trigger at exact thresholds or slightly past (within 2 days buffer)
        let matchedTemplate = null;
        for (const tmpl of templates) {
          if (daysAbsent >= tmpl.days_trigger && daysAbsent < tmpl.days_trigger + 3) {
            matchedTemplate = tmpl;
            break;
          }
        }
        // Also allow exact match for higher stages if lower ones were already sent
        if (!matchedTemplate) {
          for (const tmpl of templates) {
            if (daysAbsent >= tmpl.days_trigger) {
              matchedTemplate = tmpl;
            }
          }
        }

        if (!matchedTemplate) continue;

        // SPAM GUARD: Check if this member already received this stage_level within 30 days
        const { count: recentNudgeCount } = await adminClient
          .from("retention_nudge_logs")
          .select("id", { count: "exact", head: true })
          .eq("member_id", member.member_id)
          .eq("stage_level", matchedTemplate.stage_level)
          .gte("sent_at", thirtyDaysAgo);

        if ((recentNudgeCount || 0) > 0) {
          results.skipped_cooldown++;
          continue;
        }

        // RESET GUARD: If member has attendance after their last nudge, skip
        const { data: lastNudge } = await adminClient
          .from("retention_nudge_logs")
          .select("sent_at")
          .eq("member_id", member.member_id)
          .order("sent_at", { ascending: false })
          .limit(1);

        if (lastNudge?.length) {
          const { count: attendanceAfterNudge } = await adminClient
            .from("member_attendance")
            .select("id", { count: "exact", head: true })
            .eq("member_id", member.member_id)
            .gte("check_in", lastNudge[0].sent_at);

          if ((attendanceAfterNudge || 0) > 0) {
            results.skipped_returned++;
            continue;
          }
        }

        // Personalize message (used as dispatcher fallback_body for SMS/Email
        // and when no Meta-approved WhatsApp template is bound to the event).
        const personalizedMessage = matchedTemplate.message_body.replace(
          /{member_name}/g,
          member.full_name || "there",
        );

        const channels: string[] = matchedTemplate.channels || ["whatsapp"];
        const eventKey = `retention_stage_${matchedTemplate.stage_level}`;
        const subject = `Stage ${matchedTemplate.stage_level}: ${matchedTemplate.stage_name}`;

        let anySent = false;
        const channelResults: Record<string, string> = {};

        for (const channel of channels) {
          const recipient =
            channel === "email"
              ? member.email || ""
              : member.phone || "";
          if (!recipient) {
            channelResults[channel] = "skipped:no_recipient";
            continue;
          }

          try {
            const dispatchRes = await fetch(
              `${supabaseUrl}/functions/v1/dispatch-communication`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${supabaseServiceKey}`,
                },
                body: JSON.stringify({
                  branch_id: branch.id,
                  channel,
                  category: "retention_nudge",
                  recipient,
                  member_id: member.member_id,
                  payload: {
                    subject,
                    body: personalizedMessage,
                    variables: { member_name: member.full_name || "there", event_key: eventKey },
                    use_branded_template: channel === "email",
                  },
                  dedupe_key: `retention:${matchedTemplate.stage_level}:${member.member_id}:${channel}`,
                  ttl_seconds: 7 * 24 * 60 * 60,
                }),
              },
            );

            const body = await dispatchRes.json().catch(() => ({}));
            channelResults[channel] = body?.status || (dispatchRes.ok ? "sent" : "failed");
            if (dispatchRes.ok && (body?.status === "sent" || body?.status === "queued")) {
              anySent = true;
            }
          } catch (channelErr) {
            console.error(`dispatch ${channel} error:`, channelErr);
            channelResults[channel] = "failed";
          }
        }

        // Insert nudge log
        await adminClient.from("retention_nudge_logs").insert({
          member_id: member.member_id,
          branch_id: branch.id,
          template_id: matchedTemplate.id,
          stage_level: matchedTemplate.stage_level,
          channel: channels.join(","),
          status: anySent ? "sent" : "failed",
          message_content: personalizedMessage,
        });

        if (!anySent) continue;

        const stageKey = `stage_${matchedTemplate.stage_level}` as keyof typeof results;
        if (stageKey in results) {
          (results as any)[stageKey]++;
        }
      }
    }

    const totalSent = results.stage_1 + results.stage_2 + results.stage_3;
    console.log(
      `Retention nudges completed: ${totalSent} sent, ${results.skipped_cooldown} cooldown, ${results.skipped_returned} returned`,
    );

    return new Response(JSON.stringify({ success: true, total_sent: totalSent, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Retention nudges error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
