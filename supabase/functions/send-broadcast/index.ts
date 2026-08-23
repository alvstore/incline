// v6.1.0 — Canonical v2 audience resolver; Meta 131049 is terminal per recipient.
// v6.0.0 — Replaced every from-edge `adminClient.functions.invoke(...)` with a
//          raw-fetch `invokeEdge` helper (25s AbortController timeout, real
//          status + body surfaced). The SDK path was silently normalising
//          every non-2xx / abort as "Failed to send a request to the Edge
//          Function" which is why marketing broadcasts stalled with 0/0 and
//          275 phantom failures despite the MM API being healthy.
//          Also: handleChunk campaign lookup now retries on transient errors
//          instead of exiting with the misleading "campaign not found" log,
//          and pacing back-off (131049/130472) is persisted into
//          campaigns.fallback_policy.pacing_state so the next chunk isolate
//          doesn't repeat the same throttle mistake.
// v5.0.0 — Chunked, resumable broadcast pipeline. Campaign-driven sends now
//          run through mode='materialize' → mode='chunk' (self-invoking, 20
//          recipients per isolate, 1.5s pacing, SKIP LOCKED batch claim).
//          Legacy 'auto' path kept for ad-hoc member_ids ≤ 20.
// v4.3.0 — Batched flush of campaign_recipients (every 5) so partial progress
//          persists if the edge isolate is recycled mid-send. Fixes the
//          "337 total / 0 recipients / 0 sent" phantom-sent race. Auto-pause
//          recomputes from campaign_recipients (in-memory buffer is cleared).
// v4.2.0 — Accept system calls (service-role bearer OR apikey+x-system-call)
//          so process-scheduled-campaigns / automation-brain can invoke without
//          a user JWT. Restores triggered sends for scheduled campaigns.
// v4.1.0 — Auto-fallback to RCS/SMS on Meta pacing (131049/130472) when
//          `campaigns.fallback_policy.on_pacing` is true. Records
//          `fallback_used/fallback_channel/pacing_code` on campaign_recipients.
// v4.0.0 — Background execution: ACK 202 immediately, then run the full
//          dispatch loop inside EdgeRuntime.waitUntil so the browser stops
//          spinning and campaigns can send to 300+ recipients without
//          hitting client/proxy timeouts. Progress writes every ~5 recipients.
// v3.5.0 — Explicit-audience guard.
// v3.4.0 — Per-recipient variables + auto-pause on terminal template errors.
// v3.3.0 — Attachment kind 'video' supported.
// v3.1.0 — Route through dispatch-communication with Meta template support.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

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
    const apikeyHeader = req.headers.get("apikey") || "";
    const sysCall = req.headers.get("x-system-call") || "";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;

    // System-call gate — allows scheduled-campaigns cron and automation-brain
    // to invoke without a user JWT. Either:
    //   1. Authorization: Bearer <SERVICE_ROLE_KEY>, OR
    //   2. apikey: <SERVICE_ROLE_KEY> + x-system-call: <caller>
    const bearer = (authHeader || "").replace(/^Bearer\s+/i, "").trim();
    const isSystem =
      (bearer && bearer === supabaseServiceKey) ||
      (apikeyHeader === supabaseServiceKey && sysCall.length > 0);

    let userId: string | null = null;

    if (!isSystem) {
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      }
      const authClient = createClient(supabaseUrl, supabaseAnon, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(authHeader.replace("Bearer ", ""));
      if (claimsError || !claimsData?.claims) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      }
      userId = claimsData.claims.sub as string;
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    if (!isSystem && userId) {
      const { data: roleData } = await adminClient
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .in("role", ["owner", "admin", "manager", "staff"]);
      if (!roleData || roleData.length === 0) {
        return new Response(JSON.stringify({ error: "Forbidden: Staff access required" }), { status: 403, headers: corsHeaders });
      }
    }

    const body = await req.json();
    const { channel, message, audience, branch_id, subject, member_ids, recipients, campaign_id, template_id, variables, attachment_url, attachment_kind, attachment_filename, retry } = body;
    const rawMode: string | undefined = body.mode;
    const retrySuffix = retry ? `:retry:${Date.now()}` : '';

    const attachment = attachment_url
      ? {
          url: attachment_url,
          filename: attachment_filename || (attachment_kind === 'image' ? 'image.jpg' : attachment_kind === 'video' ? 'video.mp4' : 'document.pdf'),
          content_type: attachment_kind === 'image' ? 'image/jpeg' : attachment_kind === 'video' ? 'video/mp4' : 'application/pdf',
          kind: (attachment_kind === 'image' ? 'image' : attachment_kind === 'video' ? 'video' : 'document') as 'image' | 'document' | 'video',
        }
      : undefined;

    // ── Mode router (v5.0.0) ──────────────────────────────────────────
    // Every campaign-driven send with a non-trivial audience now goes
    // through materialize → chunk instead of the legacy giant loop, so
    // no single isolate ever handles >20 recipients.
    const audienceSize = Array.isArray(recipients) ? recipients.length
                       : Array.isArray(member_ids) ? member_ids.length
                       : 0;
    const CHUNKED_THRESHOLD = 20;
    const effectiveMode = rawMode
      ?? (campaign_id && audienceSize > CHUNKED_THRESHOLD ? 'materialize' : 'auto');

    if (effectiveMode === 'materialize') {
      return await handleMaterialize({
        adminClient, supabaseUrl, supabaseServiceKey,
        campaign_id, recipients, member_ids, branch_id,
        corsHeaders,
      });
    }
    if (effectiveMode === 'chunk') {
      // Meta-aware defaults: 15 msg/chunk × 2.5s pacing = ~24 msg/min ≈ 1440/hr,
      // safe for a tier-1K WhatsApp Business number. handleChunk auto-tightens
      // these on the fly when Meta returns 131049/130472 and persists the
      // adjusted values into campaigns.fallback_policy.pacing_state.
      return await handleChunk({
        adminClient, supabaseUrl, supabaseServiceKey,
        campaign_id,
        batch_size: Number(body.batch_size) || 15,
        pacing_ms: Number(body.pacing_ms) || 2500,
        chunk_gap_ms: Number(body.chunk_gap_ms) || 3000,
        corsHeaders,
      });
    }

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
        // `members` has no phone column — phones live on the linked profile.
        adminClient.from("members").select("user_id").eq("branch_id", branch_id).eq("do_not_contact", true),
      ]);
      for (const r of (dncChats.data || [])) dncDigits.add(digits((r as any).phone_number));
      for (const r of (dncLeads.data || [])) dncDigits.add(digits((r as any).phone));
      const dncUserIds = (dncMembers.data || []).map((r: any) => r.user_id).filter(Boolean);
      if (dncUserIds.length > 0) {
        const { data: dncProfiles } = await adminClient.from("profiles").select("phone").in("id", dncUserIds);
        for (const r of (dncProfiles || [])) dncDigits.add(digits((r as any).phone));
      }
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

    // ── Estimate total & ACK 202 immediately, then run the dispatch loop
    //    in the background via EdgeRuntime.waitUntil. This unblocks the
    //    browser (previous behaviour stalled the wizard for 60-300s on a
    //    300-recipient campaign until the client-side invoke timed out).
    const estimatedTotal = Array.isArray(recipients) && recipients.length > 0
      ? recipients.length
      : (Array.isArray(member_ids) && member_ids.length > 0 ? member_ids.length : 0);

    if (campaign_id) {
      await adminClient.from('campaigns').update({
        status: 'sending',
        recipients_count: estimatedTotal,
        success_count: 0,
        delivered_count: 0,
        read_count: 0,
        failure_count: 0,
        last_run_error: null,
        last_progress_at: new Date().toISOString(),
      }).eq('id', campaign_id);
    }

    const runBroadcast = async () => {
      try {
        await dispatchLoop();
      } catch (e: any) {
        console.error('[send-broadcast bg] fatal:', e);
        if (campaign_id) {
          try {
            await adminClient.from('campaigns').update({
              status: 'failed',
              last_run_error: `background_error: ${e?.message || String(e)}`.slice(0, 500),
              sent_at: new Date().toISOString(),
            }).eq('id', campaign_id);
          } catch { /* swallow */ }
        }
      }
    };

    // Fire-and-forget: keep isolate alive past the response.
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(runBroadcast());
    } else {
      // Local dev fallback — don't await, but at least kick it off.
      runBroadcast();
    }

    // Immediately ACK to caller.
    return json({
      accepted: true,
      background: true,
      campaign_id: campaign_id || null,
      total: estimatedTotal,
    }, 202);

    // ---------------------------------------------------------------
    // Below: the actual dispatch pipeline, moved into a nested closure
    // so it runs after the ACK. It closes over all variables above.
    // ---------------------------------------------------------------
    async function dispatchLoop() {
    // Load campaign fallback policy (default: on_pacing = true).
    let fallbackOnPacing = true;
    if (campaign_id) {
      try {
        const { data: c } = await adminClient
          .from('campaigns').select('fallback_policy').eq('id', campaign_id).maybeSingle();
        const fp = (c as any)?.fallback_policy;
        if (fp && typeof fp === 'object' && fp.on_pacing === false) fallbackOnPacing = false;
      } catch { /* default true */ }
    }

    // Attempt RCS/SMS fallback for a WhatsApp send that Meta paced.
    // Returns { ok, channel, error }.
    async function tryPacingFallback(
      r: { source_type: string; source_ref_id: string; phone?: string; email?: string; full_name?: string },
      personalized: string,
      perVars: Record<string, string> | undefined,
    ): Promise<{ ok: boolean; channel: string; error: string | null }> {
      if (!r.phone) return { ok: false, channel: 'rcs', error: 'no_phone_for_fallback' };
      try {
        const { data: fbRes, error: fbErr } = await invokeEdge(supabaseUrl, supabaseServiceKey, 'dispatch-communication', {
          body: {
            branch_id,
            channel: 'rcs', // dispatch-communication routes rcs→sms fallback internally
            recipient: r.phone,
            category: 'marketing',
            payload: { body: personalized, variables: perVars },
            member_id: r.source_type === 'member' ? r.source_ref_id : null,
            dedupe_key: campaign_id
              ? `campaign:${campaign_id}:${r.source_type}:${r.source_ref_id}:fallback:${Date.now()}`
              : `broadcast:${Date.now()}:${r.source_type}:${r.source_ref_id}:fallback`,
            force: true,
          },
        });
        const ok = !fbErr && ['sent', 'queued', 'deduped'].includes(String((fbRes as any)?.status || ''));
        const usedChannel = String((fbRes as any)?.channel_used || (fbRes as any)?.channel || 'rcs');
        return {
          ok,
          channel: usedChannel,
          error: ok ? null : (fbErr?.message || (fbRes as any)?.reason || (fbRes as any)?.error || 'fallback_failed'),
        };
      } catch (e: any) {
        return { ok: false, channel: 'rcs', error: e?.message || 'fallback_exception' };
      }
    }

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
          // Per-recipient token substitution inside incoming variable values —
          // lets RCS/Telinfy templates receive `{{first_name}}` tokens that
          // resolve to the actual recipient's name, not a literal string.
          ...(variables && typeof variables === 'object'
            ? Object.fromEntries(
                Object.entries(variables as Record<string, unknown>).map(([k, v]) => [
                  k,
                  typeof v === 'string'
                    ? v
                        .replace(/\{\{\s*first_name\s*\}\}/gi, firstName || 'there')
                        .replace(/\{\{\s*full_name\s*\}\}/gi, r.full_name || 'there')
                        .replace(/\{\{\s*member_name\s*\}\}/gi, r.full_name || 'there')
                        .replace(/\{\{\s*email\s*\}\}/gi, r.email || '')
                    : v,
                ]),
              )
            : {}),
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
          .replace(/\{\{first_name\}\}/g, perVars.first_name)
          .replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, k: string) => perVars[k] ?? m);

        try {
          const { data: dispatchRes, error: dispatchErr } = await invokeEdge(supabaseUrl, supabaseServiceKey, 'dispatch-communication', {
            body: {
              branch_id,
              channel,
              recipient: target,
              category: 'marketing',
              payload: { subject: subject || undefined, body: personalized, variables: perVars },
              template_id: template_id || null,
              member_id: r.source_type === 'member' ? r.source_ref_id : null,
              dedupe_key: campaign_id ? `campaign:${campaign_id}:${r.source_type}:${r.source_ref_id}${retrySuffix}` : `broadcast:${Date.now()}:${r.source_type}:${r.source_ref_id}`,
              force: true,
              ...(attachment ? { attachment } : {}),
            },
          });
          const ok = !dispatchErr && ['sent', 'queued', 'deduped'].includes(String((dispatchRes as any)?.status || ''));
          let reasonStr = ok ? null : (dispatchErr?.message || (dispatchRes as any)?.reason || (dispatchRes as any)?.error || 'dispatch_failed');
          let pacingCode: number | null = null;
          let fallbackUsed = false;
          let fallbackChannel: string | null = null;
          let finalStatus: 'sent' | 'failed' = ok ? 'sent' : 'failed';
          let providerRoute: string | null = (dispatchRes as any)?.provider_route ?? (channel === 'whatsapp' ? 'cloud_api' : channel);

          if (!ok && channel === 'whatsapp' && fallbackOnPacing) {
            pacingCode = extractPacingCode(reasonStr) ?? extractPacingCode(JSON.stringify((dispatchRes as any) || {}));
            if (pacingCode) {
              const fb = await tryPacingFallback(r, personalized, perVars);
              fallbackUsed = true;
              fallbackChannel = fb.channel;
              if (fb.ok) {
                finalStatus = 'sent';
                reasonStr = `paced_${pacingCode}_fallback_via_${fb.channel}`;
                providerRoute = fb.channel; // rcs | sms
              } else {
                reasonStr = `paced_${pacingCode}; fallback_${fb.channel}_failed: ${fb.error}`;
              }
            }
          }

          if (finalStatus === 'sent') sent++; else failed++;
          recipientRows.push({
            campaign_id: campaign_id ?? null,
            source_type: r.source_type, source_ref_id: r.source_ref_id,
            full_name: r.full_name, phone: r.phone, email: r.email,
            status: finalStatus,
            error: reasonStr,
            dispatched_at: new Date().toISOString(),
            fallback_used: fallbackUsed,
            fallback_channel: fallbackChannel,
            pacing_code: pacingCode,
            provider_route: providerRoute,
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

        // Progress ping every 5 recipients so the UI polls something fresh.
        // Also FLUSH the recipient rows to campaign_recipients — previously we
        // held them in memory until end-of-loop, so an isolate recycle killed
        // all visibility (campaign showed 337 total / 0 sent / 0 recipients).
        if (campaign_id && ((sent + failed) % 5 === 0)) {
          try {
            await adminClient.from('campaigns').update({
              success_count: sent,
              failure_count: failed,
              last_progress_at: new Date().toISOString(),
            }).eq('id', campaign_id);
          } catch { /* progress writes are best-effort */ }
          if (recipientRows.length > 0) {
            try {
              await adminClient.from('campaign_recipients').insert(recipientRows);
              recipientRows.length = 0; // clear after flush
            } catch (e) { console.warn('[send-broadcast] flush recipients failed:', e); }
          }
        }
      }

      if (campaign_id && recipientRows.length > 0) {
        try { await adminClient.from('campaign_recipients').insert(recipientRows); }
        catch (e) { console.warn('[send-broadcast] final flush failed:', e); }
        recipientRows.length = 0;
      }

      // Auto-pause the campaign if a large share of failures share a
      // terminal Meta template code — prevents scheduled cron from
      // burning through the audience with the same broken template.
      // We recompute from campaign_recipients (since in-memory buffer was
      // flushed in batches during the loop).
      if (campaign_id) {
        const TERMINAL_CODES = ['132000', '132001', '132012', '132018', '131051'];
        const codeCounts: Record<string, number> = {};
        let sampleFails: Array<{ phone: string | null; error: string | null }> = [];
        try {
          const { data: failedRows } = await adminClient
            .from('campaign_recipients')
            .select('phone, error')
            .eq('campaign_id', campaign_id)
            .eq('status', 'failed');
          for (const row of (failedRows || [])) {
            const err = String((row as any).error || '');
            const m = err.match(/\b(13\d{4})\b/);
            if (m && TERMINAL_CODES.includes(m[1])) {
              codeCounts[m[1]] = (codeCounts[m[1]] || 0) + 1;
            }
          }
          sampleFails = (failedRows || []).slice(0, 3).map((r: any) => ({ phone: r.phone, error: r.error }));
        } catch { /* best effort */ }
        const [worstCode, worstCount] = Object.entries(codeCounts)
          .sort(([, a], [, b]) => b - a)[0] || [null, 0];
        const shouldPause = worstCode && (worstCount as number) >= 3
          && ((worstCount as number) / Math.max(1, recipients.length)) >= 0.25;

        await adminClient.from('campaigns').update({
          status: shouldPause
            ? 'paused'
            : (failed > 0 && sent === 0 ? 'failed' : 'sent'),
          recipients_count: recipients.length,
          success_count: sent,
          failure_count: failed,
          sent_at: new Date().toISOString(),
          ...(shouldPause ? {
            last_run_error: `Meta ${worstCode} on ${worstCount}/${recipients.length} recipients — auto-paused. Fix template or recipient data before resuming. Sample: ${sampleFails.map((r) => `${r.phone}:${(r.error || '').slice(0, 80)}`).join(' | ')}`,
          } : {}),
        }).eq('id', campaign_id);
      }

      await adminClient.from('notifications').insert({
        user_id: userId, branch_id, title: 'Broadcast Sent',
        message: `${channel.toUpperCase()} broadcast: ${sent} sent, ${failed} failed (${recipients.length} recipients across members/leads/contacts)`,
        type: 'info', category: 'communication',
      });

      return;
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
      else { console.log("No active members"); return; }
    } else if (audience === "expiring") {
      const today = new Date();
      const sevenDays = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
      const { data: expiringIds } = await adminClient
        .from("memberships").select("member_id").eq("status", "active").eq("branch_id", branch_id)
        .lte("end_date", sevenDays.toISOString().split("T")[0]).gte("end_date", today.toISOString().split("T")[0]);
      const ids = [...new Set((expiringIds || []).map((m: any) => m.member_id))];
      if (ids.length > 0) membersQuery = membersQuery.in("id", ids);
      else { console.log("No expiring members"); return; }
    } else if (audience === "expired") {
      const { data: expiredIds } = await adminClient
        .from("memberships").select("member_id").eq("branch_id", branch_id)
        .lt("end_date", new Date().toISOString().split("T")[0]);
      const ids = [...new Set((expiredIds || []).map((m: any) => m.member_id))];
      if (ids.length > 0) membersQuery = membersQuery.in("id", ids);
      else { console.log("No expired members"); return; }
    }

    const { data: members, error: membersError } = await membersQuery;
    if (membersError) throw membersError;

    if (!members || members.length === 0) {
      return;
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

      const fullName = String(profile.full_name || '').trim();
      const firstName = fullName.split(/\s+/)[0] || '';
      const nameFallback = firstName || fullName || 'there';
      const perVars: Record<string, string> = {
        member_name: fullName || 'there',
        full_name: fullName || 'there',
        first_name: firstName || 'there',
        name: nameFallback,
        member_code: member.member_code || '',
        '1': nameFallback,
        v1: nameFallback,
        param1: nameFallback,
        ...(variables && typeof variables === 'object'
          ? Object.fromEntries(
              Object.entries(variables as Record<string, unknown>).map(([k, v]) => [
                k,
                typeof v === 'string'
                  ? v
                      .replace(/\{\{\s*first_name\s*\}\}/gi, firstName || 'there')
                      .replace(/\{\{\s*full_name\s*\}\}/gi, fullName || 'there')
                      .replace(/\{\{\s*member_name\s*\}\}/gi, fullName || 'there')
                      .replace(/\{\{\s*member_code\s*\}\}/gi, member.member_code || '')
                      .replace(/\{\{\s*email\s*\}\}/gi, profile.email || '')
                  : String(v ?? ''),
              ]),
            )
          : {}),
      };

      if (channel === 'whatsapp' && template_id && !fullName) {
        failed++;
        if (campaign_id) {
          memberRecipientRows.push({
            campaign_id,
            source_type: 'member',
            source_ref_id: member.id,
            full_name: null,
            phone: profile.phone || null,
            email: profile.email || null,
            status: 'skipped',
            error: 'missing_required_variable:name',
          });
        }
        continue;
      }

      const personalizedMsg = message
        .replace(/\{\{\s*member_name\s*\}\}/gi, perVars.member_name)
        .replace(/\{\{\s*full_name\s*\}\}/gi, perVars.full_name)
        .replace(/\{\{\s*first_name\s*\}\}/gi, perVars.first_name)
        .replace(/\{\{\s*member_code\s*\}\}/gi, perVars.member_code)
        .replace(/\{\{\s*1\s*\}\}/g, perVars['1'])
        .replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, k: string) => perVars[k] ?? m);

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
        const { data: dispatchRes, error: dispatchErr } = await invokeEdge(supabaseUrl, supabaseServiceKey, 'dispatch-communication', {
          body: {
            branch_id,
            channel,
            recipient,
            category: 'marketing',
            payload: { subject: subject || undefined, body: personalizedMsg, variables: perVars },
            template_id: template_id || null,
            member_id: member.id,
            dedupe_key: campaign_id ? `campaign:${campaign_id}:member:${member.id}${retrySuffix}` : `broadcast:${Date.now()}:member:${member.id}`,
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

      // Progress ping + flush every 5 recipients — same reason as the
      // recipients path: don't lose all visibility if the isolate is recycled.
      if (campaign_id && ((sent + failed) % 5 === 0)) {
        try {
          await adminClient.from('campaigns').update({
            success_count: sent,
            failure_count: failed,
            last_progress_at: new Date().toISOString(),
          }).eq('id', campaign_id);
        } catch { /* best effort */ }
        if (memberRecipientRows.length > 0) {
          try {
            await adminClient.from('campaign_recipients').insert(memberRecipientRows);
            memberRecipientRows.length = 0;
          } catch (e) { console.warn('[send-broadcast members] flush failed:', e); }
        }
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

    return;
    } // end dispatchLoop
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

// Detect Meta pacing / low-quality throttle codes in an error string.
// 131049 = "not delivered to maintain healthy ecosystem engagement"
// 130472 = "user is in an experiment"
function extractPacingCode(errText: string | null | undefined): number | null {
  if (!errText) return null;
  const m = String(errText).match(/\b(131049|130472)\b/);
  return m ? parseInt(m[1], 10) : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// v5.0.0 chunked pipeline: materialize + chunk
// ═══════════════════════════════════════════════════════════════════════════

type MaterializeArgs = {
  adminClient: any;
  supabaseUrl: string;
  supabaseServiceKey: string;
  campaign_id?: string;
  recipients?: Array<any>;
  member_ids?: string[];
  branch_id?: string;
  corsHeaders: Record<string, string>;
};

async function handleMaterialize(a: MaterializeArgs): Promise<Response> {
  const { adminClient, supabaseUrl, supabaseServiceKey, campaign_id, corsHeaders } = a;
  if (!campaign_id) {
    return new Response(JSON.stringify({ error: 'mode=materialize requires campaign_id' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Idempotent: if recipients already exist for the campaign, just kick chunking.
  const { count: existing } = await adminClient.from('campaign_recipients')
    .select('*', { count: 'exact', head: true })
    .eq('campaign_id', campaign_id);
  if ((existing ?? 0) > 0) {
    kickChunk(supabaseUrl, supabaseServiceKey, campaign_id);
    return jsonResp({ accepted: true, already_materialized: existing }, 202, corsHeaders);
  }

  const { data: campaign } = await adminClient.from('campaigns')
    .select('id, branch_id, audience_filter').eq('id', campaign_id).single();
  if (!campaign) {
    return new Response(JSON.stringify({ error: 'campaign_not_found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const branchId = a.branch_id || campaign.branch_id;

  let rows: Array<{ source_type: string; source_ref_id: string; full_name: string | null; phone: string | null; email: string | null }> = [];

  if (Array.isArray(a.recipients) && a.recipients.length > 0) {
    rows = a.recipients.map((r: any) => ({
      source_type: r.source_type || 'contact',
      source_ref_id: r.source_ref_id,
      full_name: r.full_name || null,
      phone: r.phone || null,
      email: r.email || null,
    }));
  } else if (Array.isArray(a.member_ids) && a.member_ids.length > 0) {
    const { data: members } = await adminClient.from('members')
      .select('id, profiles:user_id (full_name, email, phone)')
      .in('id', a.member_ids);
    rows = (members || []).map((m: any) => ({
      source_type: 'member',
      source_ref_id: m.id,
      full_name: m.profiles?.full_name || null,
      phone: m.profiles?.phone || null,
      email: m.profiles?.email || null,
    }));
  } else {
    const filter = (campaign.audience_filter || {}) as any;
    const { data: resolved, error: rErr } = await adminClient.rpc('resolve_campaign_audience_v2', {
      p_branch_id: branchId, p_filter: filter, p_window_hours: 24,
    });
    if (rErr) {
      await adminClient.from('campaigns').update({
        status: 'failed', last_run_error: `audience_resolve_failed: ${rErr.message}`.slice(0, 500),
      }).eq('id', campaign_id);
      return new Response(JSON.stringify({ error: rErr.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    rows = (resolved || []).map((r: any) => ({
      source_type: r.source_type,
      source_ref_id: r.source_ref_id,
      full_name: r.full_name || null,
      phone: r.phone || null,
      email: r.email || null,
    }));
  }

  if (rows.length === 0) {
    await adminClient.from('campaigns').update({
      status: 'sent', recipients_count: 0, success_count: 0, failure_count: 0,
      sent_at: new Date().toISOString(), last_run_error: 'audience_empty',
    }).eq('id', campaign_id);
    return jsonResp({ accepted: true, materialized: 0, note: 'audience_empty' }, 200, corsHeaders);
  }

  const toInsert = rows.map(r => ({
    campaign_id, source_type: r.source_type, source_ref_id: r.source_ref_id,
    full_name: r.full_name, phone: r.phone, email: r.email,
    status: 'pending', attempt: 0,
  }));
  for (let i = 0; i < toInsert.length; i += 500) {
    const slice = toInsert.slice(i, i + 500);
    const { error: insErr } = await adminClient.from('campaign_recipients').insert(slice);
    if (insErr) console.warn('[materialize] insert slice failed:', insErr.message);
  }

  await adminClient.from('campaigns').update({
    status: 'sending', recipients_count: rows.length,
    success_count: 0, failure_count: 0,
    last_run_error: null, last_progress_at: new Date().toISOString(),
  }).eq('id', campaign_id);

  kickChunk(supabaseUrl, supabaseServiceKey, campaign_id);
  return jsonResp({ accepted: true, materialized: rows.length }, 202, corsHeaders);
}

type ChunkArgs = {
  adminClient: any;
  supabaseUrl: string;
  supabaseServiceKey: string;
  campaign_id?: string;
  batch_size: number;
  pacing_ms: number;
  chunk_gap_ms: number;
  corsHeaders: Record<string, string>;
};

async function handleChunk(a: ChunkArgs): Promise<Response> {
  const { adminClient, supabaseUrl, supabaseServiceKey, campaign_id, batch_size, pacing_ms, chunk_gap_ms, corsHeaders } = a;
  if (!campaign_id) {
    return new Response(JSON.stringify({ error: 'mode=chunk requires campaign_id' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const work = async () => {
    try {
      // Load campaign with error surfacing. PGRST116 = no rows (real "not
      // found"); anything else is a transient error and we requeue instead
      // of quietly giving up (which is what left prior chunks stuck).
      const { data: campaign, error: loadErr } = await adminClient.from('campaigns')
        .select('id, branch_id, channel, template_id, template_variables, message, subject, attachment_url, attachment_kind, attachment_filename, fallback_policy, status')
        .eq('id', campaign_id).maybeSingle();
      if (loadErr) {
        console.error('[chunk] campaign load error, will retry:', campaign_id, loadErr);
        setTimeout(() => kickChunk(supabaseUrl, supabaseServiceKey, campaign_id), 5000);
        return;
      }
      if (!campaign) { console.warn('[chunk] campaign truly missing', campaign_id); return; }
      if (campaign.status === 'paused' || campaign.status === 'failed') {
        console.log('[chunk] campaign', campaign_id, 'is', campaign.status, '— stopping.');
        return;
      }

      const branchId = campaign.branch_id;
      const channel = campaign.channel;
      const templateId = campaign.template_id;
      const attachment = campaign.attachment_url ? {
        url: campaign.attachment_url,
        filename: campaign.attachment_filename || 'document.pdf',
        content_type: campaign.attachment_kind === 'image' ? 'image/jpeg'
                    : campaign.attachment_kind === 'video' ? 'video/mp4' : 'application/pdf',
        kind: (campaign.attachment_kind === 'image' ? 'image'
             : campaign.attachment_kind === 'video' ? 'video' : 'document') as 'image' | 'document' | 'video',
      } : undefined;
      const fallbackPolicy = (campaign.fallback_policy as any) || {};
      const fallbackOnPacing = fallbackPolicy?.on_pacing !== false;

      // Adaptive pacing: pick up prior back-off state so a fresh isolate
      // doesn't reset to defaults and immediately re-trip Meta throttles.
      // v5.1.0 — channel-aware defaults. WhatsApp is the only channel Meta
      // paces (131049); Email/SMS/RCS get bigger, faster chunks but still go
      // through the same chunked pipeline (no giant isolate, resumable).
      const pacingState = fallbackPolicy?.pacing_state || {};
      const channelDefaults = channel === 'whatsapp'
        ? { batch: batch_size, pace: pacing_ms }
        : channel === 'email'
          ? { batch: 40, pace: 400 }
          : { batch: 25, pace: 800 };
      let effectiveBatchSize = Number(pacingState.batch_size) || channelDefaults.batch;
      let effectivePacingMs = Number(pacingState.pacing_ms) || channelDefaults.pace;
      let pacingHits = 0; // chunk-local counter



      const digits = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '');
      const dnc = new Set<string>();
      try {
        const [c1, c2, c3] = await Promise.all([
          adminClient.from('whatsapp_chat_settings').select('phone_number').eq('branch_id', branchId).eq('do_not_contact', true),
          adminClient.from('leads').select('phone').eq('branch_id', branchId).eq('do_not_contact', true),
          // `members` has no phone column — phones live on the linked profile.
          adminClient.from('members').select('user_id').eq('branch_id', branchId).eq('do_not_contact', true),
        ]);
        for (const r of (c1.data || [])) dnc.add(digits((r as any).phone_number));
        for (const r of (c2.data || [])) dnc.add(digits((r as any).phone));
        const dncUserIds = (c3.data || []).map((r: any) => r.user_id).filter(Boolean);
        if (dncUserIds.length > 0) {
          const { data: dncProfiles } = await adminClient.from('profiles').select('phone').in('id', dncUserIds);
          for (const r of (dncProfiles || [])) dnc.add(digits((r as any).phone));
        }
      } catch { /* best effort */ }

      const { data: batch, error: claimErr } = await adminClient.rpc('claim_broadcast_batch', {
        p_campaign_id: campaign_id, p_limit: effectiveBatchSize,
      });
      if (claimErr) { console.error('[chunk] claim failed:', claimErr); return; }
      const rows: any[] = batch || [];

      for (const r of rows) {
        let status: 'sent' | 'failed' | 'skipped' = 'failed';
        let error: string | null = null;
        let pacingCode: number | null = null;
        let fallbackUsed = false;
        let fallbackChannel: string | null = null;
        let providerRoute: string | null = channel === 'whatsapp' ? 'cloud_api' : channel;

        if ((r.attempt || 0) > 3) {
          await adminClient.from('campaign_recipients').update({
            status: 'failed', error: 'max_attempts_exceeded', dispatched_at: new Date().toISOString(),
          }).eq('id', r.id);
          continue;
        }

        const target = channel === 'email' ? r.email : r.phone;
        if (!target) {
          await adminClient.from('campaign_recipients').update({
            status: 'skipped', error: 'missing_channel_address', dispatched_at: new Date().toISOString(),
          }).eq('id', r.id);
          continue;
        }
        if (r.phone && dnc.has(digits(r.phone))) {
          await adminClient.from('campaign_recipients').update({
            status: 'skipped', error: 'do_not_contact', dispatched_at: new Date().toISOString(),
          }).eq('id', r.id);
          continue;
        }

        const firstName = String(r.full_name || '').trim().split(/\s+/)[0] || '';
        const nameFallback = firstName || r.full_name || 'there';
        const perVars: Record<string, string> = {
          member_name: r.full_name || 'there',
          full_name: r.full_name || 'there',
          first_name: firstName || 'there',
          name: nameFallback,
          '1': nameFallback, v1: nameFallback, param1: nameFallback,
          // Campaign-wide fixed slot values ({{2}}, {{3}}, …) set in the wizard.
          ...(campaign.template_variables && typeof campaign.template_variables === 'object'
            ? Object.fromEntries(
                Object.entries(campaign.template_variables as Record<string, unknown>)
                  .filter(([, v]) => typeof v === 'string' && String(v).trim())
                  .map(([k, v]) => [k, String(v)
                    .replace(/\{\{\s*first_name\s*\}\}/gi, firstName || 'there')
                    .replace(/\{\{\s*full_name\s*\}\}/gi, r.full_name || 'there')
                    .replace(/\{\{\s*member_name\s*\}\}/gi, r.full_name || 'there')]),
              )
            : {}),
        };

        if (channel === 'whatsapp' && templateId && !String(r.full_name || '').trim()) {
          await adminClient.from('campaign_recipients').update({
            status: 'skipped', error: 'missing_required_variable:name', dispatched_at: new Date().toISOString(),
          }).eq('id', r.id);
          continue;
        }

        const personalized = String(campaign.message || '')
          .replace(/\{\{\s*member_name\s*\}\}/gi, perVars.member_name)
          .replace(/\{\{\s*full_name\s*\}\}/gi, perVars.full_name)
          .replace(/\{\{\s*first_name\s*\}\}/gi, perVars.first_name)
          .replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, k: string) => perVars[k] ?? m);

        try {
          const { data: dRes, error: dErr } = await invokeEdge(supabaseUrl, supabaseServiceKey, 'dispatch-communication', {
            body: {
              branch_id: branchId, channel, recipient: target, category: 'marketing',
              payload: { subject: campaign.subject || undefined, body: personalized, variables: perVars },
              template_id: templateId || null,
              member_id: r.source_type === 'member' ? r.source_ref_id : null,
              dedupe_key: `campaign:${campaign_id}:${r.source_type}:${r.source_ref_id}:a${r.attempt || 1}`,
              force: true,
              ...(attachment ? { attachment } : {}),
            },
          });
          const ok = !dErr && ['sent', 'queued', 'deduped'].includes(String((dRes as any)?.status || ''));
          status = ok ? 'sent' : 'failed';
          if (!ok) error = dErr?.message || (dRes as any)?.reason || (dRes as any)?.error || 'dispatch_failed';
          providerRoute = (dRes as any)?.provider_route ?? providerRoute;

          if (!ok && channel === 'whatsapp' && r.phone) {
            const m = String(error || '').match(/\b(131049|130472)\b/);
            if (m) {
              pacingCode = parseInt(m[1], 10);
              pacingHits += 1;
              if (fallbackOnPacing) {
                const { data: fbRes, error: fbErr } = await invokeEdge(supabaseUrl, supabaseServiceKey, 'dispatch-communication', {
                  body: {
                    branch_id: branchId, channel: 'rcs', recipient: r.phone, category: 'marketing',
                    payload: { body: personalized, variables: perVars },
                    member_id: r.source_type === 'member' ? r.source_ref_id : null,
                    dedupe_key: `campaign:${campaign_id}:${r.source_type}:${r.source_ref_id}:a${r.attempt || 1}:fallback`,
                    force: true,
                  },
                });
                const fbOk = !fbErr && ['sent', 'queued', 'deduped'].includes(String((fbRes as any)?.status || ''));
                fallbackUsed = true;
                fallbackChannel = String((fbRes as any)?.channel_used || (fbRes as any)?.channel || 'rcs');
                if (fbOk) {
                  status = 'sent';
                  error = `paced_${pacingCode}_fallback_via_${fallbackChannel}`;
                  providerRoute = fallbackChannel;
                } else {
                  error = `paced_${pacingCode}; fallback_${fallbackChannel}_failed: ${fbErr?.message || (fbRes as any)?.reason || 'unknown'}`;
                }
              } else {
                // 131049 is terminal for this payload. A future intentional
                // campaign may try after cooldown; this row must not loop.
                status = 'failed';
                error = `paced_${pacingCode}_terminal`;
              }
            }
          }
        } catch (e: any) {
          status = 'failed';
          error = e?.message || 'exception';
        }

        await adminClient.from('campaign_recipients').update({
          status, error, pacing_code: pacingCode,
          fallback_used: fallbackUsed, fallback_channel: fallbackChannel,
          provider_route: providerRoute, dispatched_at: new Date().toISOString(),
        }).eq('id', r.id);

        if (effectivePacingMs > 0) await new Promise(res => setTimeout(res, effectivePacingMs));
      }

      // Pacing back-off — tighten the rate before the next chunk isolate
      // starts. Persist into fallback_policy.pacing_state so the next
      // isolate (fresh memory) picks up the adjusted values. If >50% of
      // this chunk was throttled, cool the campaign down for 15 min so the
      // watchdog resumes it after Meta's window rolls over.
      const chunkThrottleRatio = rows.length > 0 ? pacingHits / rows.length : 0;
      const heavyThrottle = chunkThrottleRatio >= 0.5 && pacingHits >= 3;
      let nextBatchSize = effectiveBatchSize;
      let nextPacingMs = effectivePacingMs;
      if (pacingHits > 0) {
        nextBatchSize = Math.max(5, Math.floor(effectiveBatchSize / 2));
        nextPacingMs = Math.min(30000, Math.floor(effectivePacingMs * 1.5));
      }
      const newPacingState = (pacingHits > 0 || pacingState.batch_size)
        ? { batch_size: nextBatchSize, pacing_ms: nextPacingMs, updated_at: new Date().toISOString(), last_hits: pacingHits }
        : null;



      // Recompute counters from DB (source of truth).
      const [sentAgg, failedAgg, pendingAgg] = await Promise.all([
        adminClient.from('campaign_recipients').select('*', { count: 'exact', head: true })
          .eq('campaign_id', campaign_id).eq('status', 'sent'),
        adminClient.from('campaign_recipients').select('*', { count: 'exact', head: true })
          .eq('campaign_id', campaign_id).eq('status', 'failed'),
        adminClient.from('campaign_recipients').select('*', { count: 'exact', head: true })
          .eq('campaign_id', campaign_id).in('status', ['pending', 'dispatching']),
      ]);
      const sentCount = sentAgg.count ?? 0;
      const failedCount = failedAgg.count ?? 0;
      const remaining = pendingAgg.count ?? 0;

      let shouldPause = false;
      let pauseReason = '';
      if (failedCount >= 3) {
        const { data: recentFails } = await adminClient.from('campaign_recipients')
          .select('phone, error').eq('campaign_id', campaign_id).eq('status', 'failed').limit(500);
        const TERMINAL = ['132000', '132001', '132012', '132018', '131051'];
        const counts: Record<string, number> = {};
        for (const row of (recentFails || [])) {
          const m = String((row as any).error || '').match(/\b(13\d{4})\b/);
          if (m && TERMINAL.includes(m[1])) counts[m[1]] = (counts[m[1]] || 0) + 1;
        }
        const [worst, wc] = Object.entries(counts).sort(([, x], [, y]) => y - x)[0] || [null, 0];
        if (worst && (wc as number) >= 3 && ((wc as number) / Math.max(1, failedCount)) >= 0.25) {
          shouldPause = true;
          pauseReason = `Meta ${worst} on ${wc}/${failedCount} failed recipients — auto-paused. Fix template before resuming.`;
        }
      }

      const done = remaining === 0;

      // Compose next fallback_policy with updated pacing_state (if any).
      const nextFallbackPolicy = newPacingState
        ? { ...fallbackPolicy, pacing_state: newPacingState }
        : fallbackPolicy;

      // Heavy throttle → push last_progress_at 15 min into the future so the
      // stalled-campaign watchdog waits before resuming; Meta's per-hour
      // window will roll over by then.
      const nextProgressAt = heavyThrottle
        ? new Date(Date.now() + 15 * 60 * 1000).toISOString()
        : new Date().toISOString();

      await adminClient.from('campaigns').update({
        status: shouldPause ? 'paused' : (done ? (sentCount === 0 && failedCount > 0 ? 'failed' : 'sent') : 'sending'),
        success_count: sentCount,
        failure_count: failedCount,
        last_progress_at: nextProgressAt,
        fallback_policy: nextFallbackPolicy,
        ...(done ? { sent_at: new Date().toISOString() } : {}),
        ...(shouldPause ? { last_run_error: pauseReason } : {}),
        ...(heavyThrottle && !shouldPause ? { last_run_error: `pacing_backoff: ${pacingHits}/${rows.length} throttled, cooldown 15m` } : {}),
      }).eq('id', campaign_id);

      if (!done && !shouldPause && !heavyThrottle) {
        await new Promise(res => setTimeout(res, chunk_gap_ms));
        kickChunk(supabaseUrl, supabaseServiceKey, campaign_id);
      }
    } catch (e: any) {
      console.error('[chunk] fatal:', e?.message || e);
      await adminClient.from('campaigns').update({
        last_run_error: `chunk_error: ${e?.message || String(e)}`.slice(0, 500),
        last_progress_at: new Date().toISOString(),
      }).eq('id', campaign_id);
    }
  };

  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(work());
  } else {
    work();
  }
  return jsonResp({ accepted: true, chunk: true, campaign_id, batch_size }, 202, corsHeaders);
}

function kickChunk(supabaseUrl: string, serviceKey: string, campaign_id: string) {
  const url = `${supabaseUrl}/functions/v1/send-broadcast`;
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'x-system-call': 'broadcast-chunk',
    },
    body: JSON.stringify({ mode: 'chunk', campaign_id }),
  }).catch((e) => console.warn('[kickChunk] fetch failed:', e?.message || e));
}

/**
 * Raw-fetch replacement for `adminClient.functions.invoke(...)` when calling
 * one edge function from inside another. The SDK path inside the Deno edge
 * runtime silently collapses every non-2xx / abort / network hiccup into the
 * generic "Failed to send a request to the Edge Function" string — which is
 * exactly what stalled the marketing broadcasts (275 phantom failures on
 * `CHOOSE_WHAT_DESERVES` all shared that error). Raw fetch with an explicit
 * AbortController surfaces the real status + body so callers can classify the
 * failure (pace-limited, template-config, network, etc.).
 *
 * Returns a `{ data, error }` shape compatible with the SDK so existing call
 * sites don't need any further rewrite.
 */
async function invokeEdge(
  supabaseUrl: string,
  serviceKey: string,
  fnName: string,
  args: { body: unknown },
): Promise<{ data: any; error: { message: string; status?: number } | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'x-system-call': 'send-broadcast',
      },
      body: JSON.stringify(args?.body ?? {}),
      signal: controller.signal,
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) {
      const msg = String(data?.error || data?.message || data?.reason || text || `edge_${fnName}_${res.status}`).slice(0, 400);
      return { data, error: { message: msg, status: res.status } };
    }
    return { data, error: null };
  } catch (e: any) {
    const isAbort = e?.name === 'AbortError';
    return { data: null, error: { message: isAbort ? `edge_${fnName}_timeout_25s` : `edge_${fnName}_fetch_failed: ${e?.message || String(e)}` } };
  } finally {
    clearTimeout(timer);
  }
}

function jsonResp(body: unknown, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}


