// v1.0.0 — Sarvam Voice Agent API tools (HTTPS tool endpoint).
//
// Registered in Sarvam → Build → Tools as HTTPS tools. Authenticated with the
// shared tool token stored in the integration config and sent by Sarvam as the
// X-Incline-Tool-Key header. No Sarvam credential is used or returned here.
//
// Tools: get_member_context | get_class_schedule | book_callback | mark_do_not_contact
import { admin, corsHeaders, json, redact } from "../_shared/sarvam.ts";
import { normalizePhone } from "../_shared/phone.ts";

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

const RATE_LIMIT_PER_MINUTE = 60;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const started = Date.now();
  let tool = "unknown";
  let phone = "";
  let branchId: string | null = null;
  const sb = admin();

  try {
    if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

    const supplied = req.headers.get("x-incline-tool-key") || "";
    if (!supplied) return json({ ok: false, error: "Unauthorized" }, 401);
    const { data: rows } = await sb
      .from("voice_provider_integrations")
      .select("id, config")
      .eq("provider", "sarvam");
    const match = (rows || []).find((r: { config: Record<string, unknown> }) => {
      const stored = (r.config as { tool_token?: string })?.tool_token;
      return !!stored && timingSafeEqual(stored, supplied);
    });
    if (!match) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    tool = String(body?.tool || body?.name || "");
    const args = (body?.arguments ?? body?.args ?? body ?? {}) as Record<string, unknown>;
    phone = normalizePhone(String(args.phone ?? args.user_phone_number ?? ""));
    const memberCode = String(args.member_code ?? "").trim();
    const branchName = String(args.branch_name ?? "").trim();

    // Cheap rate limit: tool calls in the last minute across the ledger.
    const since = new Date(Date.now() - 60_000).toISOString();
    const { count } = await sb
      .from("ai_tool_logs")
      .select("id", { count: "exact", head: true })
      .eq("platform", "sarvam_voice")
      .gte("created_at", since);
    if ((count ?? 0) >= RATE_LIMIT_PER_MINUTE) {
      return json({ ok: false, error: "Rate limit reached, try again shortly." }, 429);
    }

    /** Resolve a branch id from a branch name (exact, then case-insensitive). */
    const resolveBranchByName = async (): Promise<string | null> => {
      if (!branchName) return null;
      const { data } = await sb
        .from("branches")
        .select("id")
        .ilike("name", branchName)
        .limit(1)
        .maybeSingle();
      return (data as { id?: string } | null)?.id ?? null;
    };

    const MEMBER_COLUMNS =
      "id, user_id, member_code, branch_id, status, lifecycle_state, do_not_contact, assigned_trainer_id";

    const withProfileName = async (member: Record<string, unknown> | null) => {
      if (!member) return null;
      branchId = (member.branch_id as string | null) ?? null;
      let fullName: string | null = null;
      if (member.user_id) {
        const { data: profile } = await sb
          .from("profiles")
          .select("full_name")
          .eq("id", member.user_id as string)
          .maybeSingle();
        fullName = (profile as { full_name?: string } | null)?.full_name ?? null;
      }
      return { ...member, full_name: fullName } as Record<string, unknown> & {
        id: string;
        user_id: string | null;
        member_code: string | null;
        branch_id: string | null;
        do_not_contact: boolean | null;
        assigned_trainer_id: string | null;
        full_name: string | null;
      };
    };

    /** Identify the caller by member_code first, then by phone number. */
    const resolveMember = async () => {
      if (memberCode) {
        let q = sb.from("members").select(MEMBER_COLUMNS).eq("member_code", memberCode);
        const scopedBranch = await resolveBranchByName();
        if (scopedBranch) q = q.eq("branch_id", scopedBranch);
        const { data: byCode } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (byCode) return await withProfileName(byCode as Record<string, unknown>);
      }
      if (!phone) return null;
      const { data: profiles } = await sb.from("profiles").select("id, full_name, phone").eq("phone", phone).limit(5);
      const ids = (profiles || []).map((p: { id: string }) => p.id);
      if (!ids.length) return null;
      const { data: member } = await sb
        .from("members")
        .select(MEMBER_COLUMNS)
        .in("user_id", ids)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!member) return null;
      branchId = member.branch_id as string | null;
      const profile = (profiles || []).find((p: { id: string }) => p.id === member.user_id) as
        | { full_name?: string }
        | undefined;
      return { ...member, full_name: profile?.full_name ?? null };
    };


    let result: Record<string, unknown>;

    if (tool === "get_member_context") {
      const member = await resolveMember();
      if (!member) {
        result = { found: false, message: "No member matches this phone number." };
      } else {
        const [{ data: membership }, { data: lastVisit }, { data: branch }] = await Promise.all([
          sb.from("memberships").select("status, start_date, end_date, plan_id")
            .eq("member_id", member.id).order("end_date", { ascending: false }).limit(1).maybeSingle(),
          sb.from("member_attendance").select("check_in").eq("member_id", member.id)
            .order("check_in", { ascending: false }).limit(1).maybeSingle(),
          member.branch_id
            ? sb.from("branches").select("name").eq("id", member.branch_id).maybeSingle()
            : Promise.resolve({ data: null }),
        ]);
        let planName: string | null = null;
        if (membership?.plan_id) {
          const { data: plan } = await sb.from("membership_plans").select("name").eq("id", membership.plan_id)
            .maybeSingle();
          planName = plan?.name ?? null;
        }
        let trainerName: string | null = null;
        if (member.assigned_trainer_id) {
          const { data: trainer } = await sb.from("trainers").select("user_id").eq("id", member.assigned_trainer_id)
            .maybeSingle();
          if (trainer?.user_id) {
            const { data: tp } = await sb.from("profiles").select("full_name").eq("id", trainer.user_id).maybeSingle();
            trainerName = (tp as { full_name?: string } | null)?.full_name ?? null;
          }
        }
        const last = lastVisit?.check_in ? new Date(lastVisit.check_in as string) : null;
        result = {
          found: true,
          member_name: member.full_name,
          member_code: member.member_code,
          branch_name: (branch as { name?: string } | null)?.name ?? null,
          membership_status: membership?.status ?? null,
          plan_name: planName,
          plan_expiry: membership?.end_date ?? null,
          trainer_name: trainerName,
          last_visit_date: last ? last.toISOString().slice(0, 10) : null,
          days_absent: last ? Math.floor((Date.now() - last.getTime()) / 86_400_000) : null,
          do_not_contact: !!member.do_not_contact,
        };
      }
    } else if (tool === "get_class_schedule") {
      const member = await resolveMember();
      const target = (typeof args.branch_id === "string" ? args.branch_id : null) ?? member?.branch_id ?? null;
      if (!target) {
        result = { classes: [], message: "No branch could be resolved for this caller." };
      } else {
        const { data: classes } = await sb
          .from("classes")
          .select("name, class_type, scheduled_at, duration_minutes, venue")
          .eq("branch_id", target)
          .eq("is_active", true)
          .gte("scheduled_at", new Date().toISOString())
          .order("scheduled_at", { ascending: true })
          .limit(8);
        result = { classes: classes ?? [] };
      }
    } else if (tool === "book_callback") {
      const member = await resolveMember();
      const when = typeof args.callback_datetime === "string" ? args.callback_datetime : null;
      const note = typeof args.note === "string" ? args.note.slice(0, 500) : "";
      const target = member?.branch_id ?? null;
      if (!target) {
        result = { booked: false, message: "No branch could be resolved, callback not booked." };
      } else {
        const due = when ? new Date(when) : new Date();
        const { error } = await sb.from("tasks").insert({
          branch_id: target,
          title: "Voice AI: callback requested by member",
          description: `Requested during a Sarvam Voice AI call. Phone ${phone}.${note ? ` Note: ${note}` : ""}`,
          priority: "high",
          due_date: (Number.isNaN(due.getTime()) ? new Date() : due).toISOString().slice(0, 10),
          linked_entity_type: member ? "member" : null,
          linked_entity_id: member?.id ?? null,
        });
        if (error) throw new Error(error.message);
        result = { booked: true, message: "Callback noted for the team." };
      }
    } else if (tool === "mark_do_not_contact") {
      if (!phone) {
        result = { done: false, message: "No phone number supplied." };
      } else {
        const member = await resolveMember();
        const { error } = await sb.rpc("mark_do_not_contact", {
          p_phone: phone,
          p_branch_id: member?.branch_id ?? null,
          p_reason: typeof args.reason === "string" ? args.reason.slice(0, 200) : "voice_ai_opt_out",
          p_source: "sarvam_voice",
        });
        if (error) throw new Error(error.message);
        result = { done: true, message: "This number will not be contacted again." };
      }
    } else {
      return json({ ok: false, error: `Unknown tool: ${tool}` }, 400);
    }

    await sb.from("ai_tool_logs").insert({
      tool_name: tool,
      platform: "sarvam_voice",
      phone_number: phone || null,
      branch_id: branchId,
      arguments: args,
      result,
      status: "success",
      execution_time_ms: Date.now() - started,
    });

    return json({ ok: true, ...result });
  } catch (e) {
    const message = redact((e as Error)?.message || "Tool call failed");
    console.error("sarvam-agent-tools error:", message);
    await sb.from("ai_tool_logs").insert({
      tool_name: tool,
      platform: "sarvam_voice",
      phone_number: phone || null,
      branch_id: branchId,
      status: "error",
      error_message: message,
      execution_time_ms: Date.now() - started,
    }).then(() => {}, () => {});
    return json({ ok: false, error: message }, 500);
  }
});
