// v3.3.0 — Attachment kind 'video' supported (mapped via dispatcher).
// v3.1.0 — Route all broadcast sends through dispatch-communication with Meta template support.
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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = claimsData.claims.sub as string;

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: roleData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .in("role", ["owner", "admin", "manager", "staff"]);
    if (!roleData || roleData.length === 0) {
      return new Response(JSON.stringify({ error: "Forbidden: Staff access required" }), { status: 403, headers: corsHeaders });
    }

    const { channel, message, audience, branch_id, subject, member_ids, recipients, campaign_id, template_id, variables, attachment_url, attachment_kind, attachment_filename } = await req.json();

    const attachment = attachment_url
      ? {
          url: attachment_url,
          filename: attachment_filename || (attachment_kind === 'image' ? 'image.jpg' : attachment_kind === 'video' ? 'video.mp4' : 'document.pdf'),
          content_type: attachment_kind === 'image' ? 'image/jpeg' : attachment_kind === 'video' ? 'video/mp4' : 'application/pdf',
          kind: (attachment_kind === 'image' ? 'image' : attachment_kind === 'video' ? 'video' : 'document') as 'image' | 'document' | 'video',
        }
      : undefined;

    if (!channel || !message || !branch_id) {
      return new Response(JSON.stringify({ error: "Missing required fields: channel, message, branch_id" }), {
        status: 400, headers: corsHeaders,
      });
    }

    // ── Do-Not-Contact filter: load opted-out phones (digits-only) for this branch
    // up-front so both recipient paths can skip them. Email is matched via the
    // member/lead rows we already join.
    const digits = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");
    const dncDigits = new Set<string>();
    try {
      const [dncChats, dncLeads, dncMembers] = await Promise.all([
        adminClient.from("whatsapp_chat_settings").select("phone_number").eq("branch_id", branch_id).eq("do_not_contact", true),
        adminClient.from("leads").select("phone").eq("branch_id", branch_id).eq("do_not_contact", true),
        adminClient.from("members").select("phone_number").eq("branch_id", branch_id).eq("do_not_contact", true),
      ]);
      for (const r of (dncChats.data || [])) dncDigits.add(digits((r as any).phone_number));
      for (const r of (dncLeads.data || [])) dncDigits.add(digits((r as any).phone));
      for (const r of (dncMembers.data || [])) dncDigits.add(digits((r as any).phone_number));
    } catch (e) {
      console.warn("[send-broadcast] do-not-contact load failed (continuing):", e);
    }

    // ---- Path A: caller passed an explicit resolved recipient list (members + leads + contacts) ----
    if (Array.isArray(recipients) && recipients.length > 0) {
      let sent = 0, failed = 0, skipped_dnc = 0;
      const recipientRows: any[] = [];

      for (const r of recipients) {
        const target = channel === 'email' ? r.email : r.phone;
        if (!target) {
          recipientRows.push({
            campaign_id: campaign_id ?? null,
            source_type: r.source_type, source_ref_id: r.source_ref_id,
            full_name: r.full_name, phone: r.phone, email: r.email,
            status: 'skipped', error: 'missing_channel_address',
          });
          continue;
        }
        // DNC skip — phone-based; we always have a phone on every source.
        if (r.phone && dncDigits.has(digits(r.phone))) {
          skipped_dnc++;
          recipientRows.push({
            campaign_id: campaign_id ?? null,
            source_type: r.source_type, source_ref_id: r.source_ref_id,
            full_name: r.full_name, phone: r.phone, email: r.email,
            status: 'skipped', error: 'do_not_contact',
          });
          continue;
        }

        const personalized = message
          .replace(/\{\{member_name\}\}/g, r.full_name || 'there')
          .replace(/\{\{full_name\}\}/g, r.full_name || 'there');

        try {
          const { data: dispatchRes, error: dispatchErr } = await adminClient.functions.invoke('dispatch-communication', {
            body: {
              branch_id,
              channel,
              recipient: target,
              category: 'marketing',
              payload: { subject: subject || undefined, body: personalized, variables: variables || undefined },
              template_id: template_id || null,
              member_id: r.source_type === 'member' ? r.source_ref_id : null,
              dedupe_key: campaign_id ? `campaign:${campaign_id}:${r.source_type}:${r.source_ref_id}` : `broadcast:${Date.now()}:${r.source_type}:${r.source_ref_id}`,
              force: true,
              ...(attachment ? { attachment } : {}),
            },
          });
          const ok = !dispatchErr && ['sent', 'queued', 'deduped'].includes(String((dispatchRes as any)?.status || ''));
          if (ok) sent++; else failed++;
          recipientRows.push({
            campaign_id: campaign_id ?? null,
            source_type: r.source_type, source_ref_id: r.source_ref_id,
            full_name: r.full_name, phone: r.phone, email: r.email,
            status: ok ? 'sent' : 'failed',
            error: ok ? null : (dispatchErr?.message || (dispatchRes as any)?.error || 'dispatch_failed'),
            dispatched_at: new Date().toISOString(),
          });
        } catch (e: any) {
          failed++;
          recipientRows.push({
            campaign_id: campaign_id ?? null,
            source_type: r.source_type, source_ref_id: r.source_ref_id,
            full_name: r.full_name, phone: r.phone, email: r.email,
            status: 'failed', error: e?.message || 'exception',
            dispatched_at: new Date().toISOString(),
          });
        }
      }

      if (campaign_id && recipientRows.length > 0) {
        await adminClient.from('campaign_recipients').insert(recipientRows);
        await adminClient.from('campaigns').update({
          status: failed > 0 && sent === 0 ? 'failed' : 'sent',
          recipients_count: recipients.length,
          success_count: sent,
          failure_count: failed,
          sent_at: new Date().toISOString(),
        }).eq('id', campaign_id);
      }

      await adminClient.from('notifications').insert({
        user_id: userId, branch_id, title: 'Broadcast Sent',
        message: `${channel.toUpperCase()} broadcast: ${sent} sent, ${failed} failed (${recipients.length} recipients across members/leads/contacts)`,
        type: 'info', category: 'communication',
      });

      return json({ success: true, sent, failed, total: recipients.length });
    }

    // Resolve recipients (skip members who asked us to stop messaging).
    let membersQuery = adminClient
      .from("members")
      .select("id, user_id, member_code, profiles:user_id (full_name, phone, email)")
      .eq("branch_id", branch_id)
      .eq("do_not_contact", false);

    // Explicit member id list (used by Campaign Builder) takes priority over audience preset
    if (Array.isArray(member_ids) && member_ids.length > 0) {
      membersQuery = membersQuery.in("id", member_ids);
    } else if (audience === "active") {
      const { data: activeMemberIds } = await adminClient
        .from("memberships").select("member_id").eq("status", "active").eq("branch_id", branch_id)
        .gte("end_date", new Date().toISOString().split("T")[0]);
      const ids = [...new Set((activeMemberIds || []).map((m: any) => m.member_id))];
      if (ids.length > 0) membersQuery = membersQuery.in("id", ids);
      else return json({ success: true, sent: 0, message: "No active members found" });
    } else if (audience === "expiring") {
      const today = new Date();
      const sevenDays = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
      const { data: expiringIds } = await adminClient
        .from("memberships").select("member_id").eq("status", "active").eq("branch_id", branch_id)
        .lte("end_date", sevenDays.toISOString().split("T")[0]).gte("end_date", today.toISOString().split("T")[0]);
      const ids = [...new Set((expiringIds || []).map((m: any) => m.member_id))];
      if (ids.length > 0) membersQuery = membersQuery.in("id", ids);
      else return json({ success: true, sent: 0, message: "No expiring members found" });
    } else if (audience === "expired") {
      const { data: expiredIds } = await adminClient
        .from("memberships").select("member_id").eq("branch_id", branch_id)
        .lt("end_date", new Date().toISOString().split("T")[0]);
      const ids = [...new Set((expiredIds || []).map((m: any) => m.member_id))];
      if (ids.length > 0) membersQuery = membersQuery.in("id", ids);
      else return json({ success: true, sent: 0, message: "No expired members found" });
    }

    const { data: members, error: membersError } = await membersQuery;
    if (membersError) throw membersError;

    if (!members || members.length === 0) {
      return json({ success: true, sent: 0, message: "No recipients found" });
    }

    let sent = 0;
    let failed = 0;

    let skippedDnc = 0;
    for (const member of members) {
      const profile = (member as any).profiles;
      if (!profile) continue;
      // Defence-in-depth — phone match against pre-loaded DNC set.
      if (profile.phone && dncDigits.has(digits(profile.phone))) {
        skippedDnc++;
        continue;
      }

      const personalizedMsg = message
        .replace(/\{\{member_name\}\}/g, profile.full_name || "Member")
        .replace(/\{\{member_code\}\}/g, member.member_code || "");

      let recipient = channel === "email" ? profile.email : profile.phone;
      let status = "failed";

      try {
        if (!recipient) {
          continue;
        }
        const { data: dispatchRes, error: dispatchErr } = await adminClient.functions.invoke('dispatch-communication', {
          body: {
            branch_id,
            channel,
            recipient,
            category: 'marketing',
            payload: { subject: subject || undefined, body: personalizedMsg, variables: variables || undefined },
            template_id: template_id || null,
            member_id: member.id,
            dedupe_key: campaign_id ? `campaign:${campaign_id}:member:${member.id}` : `broadcast:${Date.now()}:member:${member.id}`,
            force: true,
            ...(attachment ? { attachment } : {}),
          },
        });
        status = !dispatchErr && ['sent', 'queued', 'deduped'].includes(String((dispatchRes as any)?.status || '')) ? "sent" : "failed";
      } catch (e) {
        console.error(`Broadcast dispatch error for ${recipient}:`, e);
        status = "failed";
      }

      if (status === "sent") sent++;
      else failed++;

    }

    await adminClient.from("notifications").insert({
      user_id: userId, branch_id, title: "Broadcast Sent",
      message: `${channel.toUpperCase()} broadcast: ${sent} sent, ${failed} failed (${audience || 'custom'} audience)`,
      type: "info", category: "communication",
    });

    // If invoked from a campaign, update its counters & status
    if (campaign_id) {
      try {
        await adminClient.from("campaigns").update({
          status: failed > 0 && sent === 0 ? "failed" : "sent",
          recipients_count: members.length,
          success_count: sent,
          failure_count: failed,
          sent_at: new Date().toISOString(),
        }).eq("id", campaign_id);
      } catch (e) {
        console.warn("campaign update failed:", e);
      }
    }

    return json({ success: true, sent, failed, total: members.length });
  } catch (error: any) {
    console.error("Broadcast error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
