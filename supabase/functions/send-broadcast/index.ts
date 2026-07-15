// v3.5.0 — Explicit-audience guard: never silently fall through to the
//          whole-branch members path when caller passed empty recipients/
//          member_ids. Members path now inserts per-recipient rows into
//          campaign_recipients so the delivery drawer works for member sends.
// v3.4.0 — Forward per-recipient variables to dispatcher; skip missing-name
//          recipients when a Meta template is used; auto-pause campaign on
//          terminal template errors (132000/132012/132018/132001/131051).
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

    // Explicit-audience guard: if the caller passed `recipients` or
    // `member_ids` (even as an empty array), that IS the audience. Do NOT
    // silently fall through to "broadcast to every member in the branch" —
    // that behaviour previously mis-sent to unrelated members and left the
    // originating campaign stuck at status='sending' with 0 recipients.
    const callerProvidedRecipients = Array.isArray(recipients);
    const callerProvidedMemberIds = Array.isArray(member_ids);
    const explicitAudienceEmpty =
      (callerProvidedRecipients && recipients.length === 0) &&
      (!callerProvidedMemberIds || member_ids.length === 0);
    if (explicitAudienceEmpty) {
      if (campaign_id) {
        await adminClient.from('campaigns').update({
          status: 'failed',
          recipients_count: 0,
          success_count: 0,
          failure_count: 0,
          last_run_error: 'audience_empty',
          sent_at: new Date().toISOString(),
        }).eq('id', campaign_id);
      }
      return json({ success: true, sent: 0, failed: 0, total: 0, reason: 'audience_empty' });
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

        const firstName = (r.full_name || '').trim().split(/\s+/)[0] || '';
        const nameFallback = firstName || r.full_name || 'there';
        const perVars: Record<string, string> = {
          member_name: r.full_name || 'there',
          full_name: r.full_name || 'there',
          first_name: firstName || 'there',
          name: nameFallback,
          // Meta positional aliases — templates with body `Hi {{1}},` (no
          // variables[] mapping saved locally) resolve directly from these.
          '1': nameFallback,
          v1: nameFallback,
          param1: nameFallback,
          ...(variables && typeof variables === 'object' ? variables : {}),
        };


        // Skip missing-name recipients on Meta template sends — otherwise
        // Meta rejects the whole batch with 132018 and the campaign fails.
        if (channel === 'whatsapp' && template_id && !r.full_name?.trim()) {
          failed++;
          recipientRows.push({
            campaign_id: campaign_id ?? null,
            source_type: r.source_type, source_ref_id: r.source_ref_id,
            full_name: r.full_name, phone: r.phone, email: r.email,
            status: 'skipped', error: 'missing_required_variable:name',
          });
          continue;
        }

        const personalized = message
          .replace(/\{\{member_name\}\}/g, perVars.member_name)
          .replace(/\{\{full_name\}\}/g, perVars.full_name)
          .replace(/\{\{first_name\}\}/g, perVars.first_name);

        try {
          const { data: dispatchRes, error: dispatchErr } = await adminClient.functions.invoke('dispatch-communication', {
            body: {
              branch_id,
              channel,
              recipient: target,
              category: 'marketing',
              payload: { subject: subject || undefined, body: personalized, variables: perVars },
              template_id: template_id || null,
              member_id: r.source_type === 'member' ? r.source_ref_id : null,
              dedupe_key: campaign_id ? `campaign:${campaign_id}:${r.source_type}:${r.source_ref_id}` : `broadcast:${Date.now()}:${r.source_type}:${r.source_ref_id}`,
              force: true,
              ...(attachment ? { attachment } : {}),
            },
          });
          const ok = !dispatchErr && ['sent', 'queued', 'deduped'].includes(String((dispatchRes as any)?.status || ''));
          if (ok) sent++; else failed++;
          const reasonStr = ok ? null : (dispatchErr?.message || (dispatchRes as any)?.reason || (dispatchRes as any)?.error || 'dispatch_failed');
          recipientRows.push({
            campaign_id: campaign_id ?? null,
            source_type: r.source_type, source_ref_id: r.source_ref_id,
            full_name: r.full_name, phone: r.phone, email: r.email,
            status: ok ? 'sent' : 'failed',
            error: reasonStr,
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

        // Auto-pause the campaign if a large share of failures share a
        // terminal Meta template code — prevents scheduled cron from
        // burning through the audience with the same broken template.
        const TERMINAL_CODES = ['132000', '132001', '132012', '132018', '131051'];
        const codeCounts: Record<string, number> = {};
        for (const row of recipientRows) {
          if (row.status !== 'failed' || !row.error) continue;
          const m = String(row.error).match(/\b(13\d{4})\b/);
          if (m && TERMINAL_CODES.includes(m[1])) {
            codeCounts[m[1]] = (codeCounts[m[1]] || 0) + 1;
          }
        }
        const [worstCode, worstCount] = Object.entries(codeCounts)
          .sort(([, a], [, b]) => b - a)[0] || [null, 0];
        const shouldPause = worstCode && worstCount >= 3
          && (worstCount / Math.max(1, recipients.length)) >= 0.25;

        await adminClient.from('campaigns').update({
          status: shouldPause
            ? 'paused'
            : (failed > 0 && sent === 0 ? 'failed' : 'sent'),
          recipients_count: recipients.length,
          success_count: sent,
          failure_count: failed,
          sent_at: new Date().toISOString(),
          ...(shouldPause ? {
            last_run_error: `Meta ${worstCode} on ${worstCount}/${recipients.length} recipients — auto-paused. Fix template or recipient data before resuming. Sample: ${recipientRows.filter((r) => r.status === 'failed').slice(0, 3).map((r) => `${r.phone}:${(r.error || '').slice(0, 80)}`).join(' | ')}`,
          } : {}),
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
    const memberRecipientRows: any[] = [];

    for (const member of members) {
      const profile = (member as any).profiles;
      if (!profile) continue;
      // Defence-in-depth — phone match against pre-loaded DNC set.
      if (profile.phone && dncDigits.has(digits(profile.phone))) {
        skippedDnc++;
        if (campaign_id) {
          memberRecipientRows.push({
            campaign_id,
            source_type: 'member',
            source_ref_id: member.id,
            full_name: profile.full_name || null,
            phone: profile.phone || null,
            email: profile.email || null,
            status: 'skipped',
            error: 'do_not_contact',
          });
        }
        continue;
      }

      const personalizedMsg = message
        .replace(/\{\{member_name\}\}/g, profile.full_name || "Member")
        .replace(/\{\{member_code\}\}/g, member.member_code || "");

      let recipient = channel === "email" ? profile.email : profile.phone;
      let status: 'sent' | 'failed' | 'skipped' = "failed";
      let errorReason: string | null = null;

      if (!recipient) {
        if (campaign_id) {
          memberRecipientRows.push({
            campaign_id,
            source_type: 'member',
            source_ref_id: member.id,
            full_name: profile.full_name || null,
            phone: profile.phone || null,
            email: profile.email || null,
            status: 'skipped',
            error: 'missing_channel_address',
          });
        }
        continue;
      }

      try {
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
        const ok = !dispatchErr && ['sent', 'queued', 'deduped'].includes(String((dispatchRes as any)?.status || ''));
        status = ok ? 'sent' : 'failed';
        if (!ok) errorReason = dispatchErr?.message || (dispatchRes as any)?.reason || (dispatchRes as any)?.error || 'dispatch_failed';
      } catch (e: any) {
        console.error(`Broadcast dispatch error for ${recipient}:`, e);
        status = 'failed';
        errorReason = e?.message || 'exception';
      }

      if (status === "sent") sent++;
      else failed++;

      if (campaign_id) {
        memberRecipientRows.push({
          campaign_id,
          source_type: 'member',
          source_ref_id: member.id,
          full_name: profile.full_name || null,
          phone: profile.phone || null,
          email: profile.email || null,
          status,
          error: errorReason,
          dispatched_at: new Date().toISOString(),
        });
      }
    }

    await adminClient.from("notifications").insert({
      user_id: userId, branch_id, title: "Broadcast Sent",
      message: `${channel.toUpperCase()} broadcast: ${sent} sent, ${failed} failed (${audience || 'custom'} audience)`,
      type: "info", category: "communication",
    });

    // If invoked from a campaign, update its counters & persist recipient rows.
    if (campaign_id) {
      try {
        if (memberRecipientRows.length > 0) {
          await adminClient.from('campaign_recipients').insert(memberRecipientRows);
        }
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
