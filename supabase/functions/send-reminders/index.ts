// send-reminders v2.2 — skip payment reminders when invoice is paid / void / zero balance.
import { captureEdgeError } from "../_shared/capture-edge-error.ts";
// Honest-delivery for ALL reminder types: payment, membership_expiry, class,
// PT, benefit. Each reminder honors the per-branch reminder_configurations
// channel (whatsapp / sms / email / notification), attempts the real provider
// call, and only counts the reminder as `sent` when the provider confirms.
// In-app notifications are still created in addition to outbound delivery.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Channel = "whatsapp" | "sms" | "email" | "notification";
type DeliveryStatus = "sent" | "failed" | "skipped";

interface DeliveryResult {
  status: DeliveryStatus;
  error: string | null;
  channel: Channel;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // System-call detection: Automation Brain (and other server workers) call
    // us with the service-role key in either `Authorization: Bearer …` OR the
    // `apikey` header (the new signing-keys gateway forbids putting an sb_
    // service key in BOTH, so workers send it only via `apikey`).
    const authHeader = req.headers.get("Authorization") ?? "";
    const apiKeyHeader = req.headers.get("apikey") ?? "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.replace("Bearer ", "").trim() : "";
    const isSystemCall = bearer === supabaseServiceKey || apiKeyHeader === supabaseServiceKey;
    let callerId: string;

    if (isSystemCall) {
      callerId = "system";
    } else {
      if (!authHeader.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      }
      const authClient = createClient(supabaseUrl, supabaseAnon, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(bearer);
      if (claimsError || !claimsData?.claims) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      }
      callerId = claimsData.claims.sub as string;

      // Role check: only staff+ can trigger reminders manually.
      const { data: roleData } = await adminClient
        .from("user_roles")
        .select("role")
        .eq("user_id", callerId)
        .in("role", ["owner", "admin", "manager", "staff"]);
      if (!roleData || roleData.length === 0) {
        return new Response(JSON.stringify({ error: "Forbidden: Staff access required" }), { status: 403, headers: corsHeaders });
      }
    }
    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const results = {
      payment_reminders: 0,
      birthday_wishes: 0,
      membership_expiry: 0,
      class_reminders: 0,
      pt_reminders: 0,
      benefit_reminders: 0,
      inactive_member_alerts: 0,
      task_reminders: 0,
      task_overdue_escalations: 0,
    };
    const failures = {
      payment_reminders: 0,
      membership_expiry: 0,
      class_reminders: 0,
      pt_reminders: 0,
      benefit_reminders: 0,
    };
    const notifications: any[] = [];
    const commLogs: any[] = [];

    // Load reminder configurations per branch
    const { data: allConfigs } = await adminClient.from("reminder_configurations").select("*").eq("is_enabled", true);
    const configMap = new Map<string, Map<string, any>>();
    for (const cfg of allConfigs || []) {
      if (!configMap.has(cfg.branch_id)) configMap.set(cfg.branch_id, new Map());
      configMap.get(cfg.branch_id)!.set(cfg.reminder_type, cfg);
    }

    function getConfig(branchId: string, type: string): any | null {
      return configMap.get(branchId)?.get(type) || null;
    }
    function isReminderEnabled(branchId: string, type: string): boolean {
      const cfg = getConfig(branchId, type);
      if (!cfg) return true; // default enabled
      return cfg.is_enabled !== false;
    }
    function getDaysBefore(branchId: string, type: string): number[] {
      const cfg = getConfig(branchId, type);
      if (!cfg || !cfg.days_before) return [7, 3, 1];
      return cfg.days_before;
    }
    function getChannel(branchId: string, type: string): Channel {
      const cfg = getConfig(branchId, type);
      const ch = (cfg?.channel || "notification") as Channel;
      return (["whatsapp", "sms", "email", "notification"] as Channel[]).includes(ch) ? ch : "notification";
    }

    /**
     * Attempt real outbound delivery via the matching provider edge function.
     * Returns honest status — `sent` only when the provider confirmed.
     */
    async function deliver(
      channel: Channel,
      params: {
        branchId: string;
        memberId?: string | null;
        phone?: string | null;
        email?: string | null;
        subject: string;
        message: string;
      },
    ): Promise<DeliveryResult> {
      try {
        if (channel === "notification") {
          // Caller is responsible for pushing into `notifications` separately.
          return { status: "skipped", error: "channel=notification (in-app only)", channel };
        }
        if (channel === "whatsapp") {
          if (!params.phone) {
            return { status: "skipped", error: "no phone number", channel };
          }
          // send-whatsapp requires a whatsapp_messages row first.
          const { data: msgRow, error: insErr } = await adminClient
            .from("whatsapp_messages")
            .insert({
              branch_id: params.branchId,
              phone_number: params.phone,
              direction: "outbound",
              content: params.message,
              status: "pending",
            })
            .select("id")
            .single();
          if (insErr || !msgRow) {
            return { status: "failed", error: insErr?.message || "msg insert failed", channel };
          }
          const { error } = await adminClient.functions.invoke("send-whatsapp", {
            body: {
              message_id: msgRow.id,
              phone_number: params.phone,
              content: params.message,
              branch_id: params.branchId,
            },
          });
          if (error) return { status: "failed", error: error.message, channel };
          return { status: "sent", error: null, channel };
        }
        if (channel === "sms") {
          if (!params.phone) {
            return { status: "skipped", error: "no phone number", channel };
          }
          const { error } = await adminClient.functions.invoke("send-sms", {
            body: {
              to: params.phone,
              message: params.message,
              branch_id: params.branchId,
              member_id: params.memberId || undefined,
            },
          });
          if (error) return { status: "failed", error: error.message, channel };
          return { status: "sent", error: null, channel };
        }
        if (channel === "email") {
          if (!params.email) {
            return { status: "skipped", error: "no email", channel };
          }
          const { error } = await adminClient.functions.invoke("send-email", {
            body: {
              to: params.email,
              subject: params.subject,
              html: `<p>${params.message}</p>`,
              branch_id: params.branchId,
              member_id: params.memberId || undefined,
            },
          });
          if (error) return { status: "failed", error: error.message, channel };
          return { status: "sent", error: null, channel };
        }
        return { status: "skipped", error: `unknown channel: ${channel}`, channel };
      } catch (err: any) {
        return { status: "failed", error: err?.message || String(err), channel };
      }
    }

    function logComm(
      result: DeliveryResult,
      params: { branchId: string; memberId?: string | null; recipient: string; subject: string; message: string },
    ) {
      // Only record an outbound row when something actually went out.
      if (result.status !== "sent") return;
      commLogs.push({
        branch_id: params.branchId,
        type: result.channel,
        recipient: params.recipient,
        subject: params.subject,
        content: params.message,
        status: "sent",
        member_id: params.memberId || null,
        sent_at: now.toISOString(),
      });
    }

    // ── 1. Payment reminders (with invoice context + Razorpay link) ──
    const { data: pendingReminders } = await adminClient
      .from("payment_reminders")
      .select("*, members:member_id (user_id, member_code, branch_id, profiles:user_id (full_name, phone, email)), invoices:invoice_id (id, invoice_number, total_amount, amount_paid, due_date, payment_due_date, status)")
      .eq("status", "pending")
      .lte("scheduled_for", now.toISOString());

    for (const reminder of pendingReminders || []) {
      const member = reminder.members as any;
      const invoice = reminder.invoices as any;
      if (!member?.user_id) continue;
      if (!isReminderEnabled(reminder.branch_id, "payment_due")) continue;

      // Skip if the invoice is already paid / voided / cancelled / refunded,
      // or if there is no outstanding balance left to collect.
      const totalAmt = Number(invoice?.total_amount || 0);
      const paidAmt = Number(invoice?.amount_paid || 0);
      const pendingAmt = Math.max(totalAmt - paidAmt, 0);
      const terminalStatuses = ["paid", "voided", "cancelled", "refunded"];
      const isTerminal = invoice?.status && terminalStatuses.includes(invoice.status);
      if (!invoice || isTerminal || pendingAmt < 1) {
        await adminClient
          .from("payment_reminders")
          .update({
            status: "skipped",
            skipped_reason: isTerminal ? `invoice_${invoice?.status}` : "no_balance",
            updated_at: new Date().toISOString(),
          })
          .eq("id", reminder.id);
        results.payment_reminders_skipped = (results.payment_reminders_skipped || 0) + 1;
        continue;
      }

      const name = member.profiles?.full_name || "Member";
      const isOverdue = !["due_soon", "before_due", "on_due"].includes(reminder.reminder_type);
      const triggerEvent = isOverdue ? "membership_overdue" : "payment_due";
      const reminderCopy = reminder.reminder_type === "due_soon" || reminder.reminder_type === "before_due"
        ? "due soon" : reminder.reminder_type === "on_due" ? "due today" : "overdue";

      // Mint a Razorpay payment link if invoice has dues and we don't have one cached
      let paymentLink = "";
      if (invoice?.id && pendingAmt >= 1) {
        try {
          const { data: existingLink } = await adminClient
            .from("payment_links")
            .select("short_url, status, expires_at")
            .eq("invoice_id", invoice.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (existingLink?.short_url && existingLink.status !== "paid" && (!existingLink.expires_at || existingLink.expires_at > now.toISOString())) {
            paymentLink = existingLink.short_url;
          } else {
            const { data: linkRes } = await adminClient.functions.invoke("create-razorpay-link", {
              body: {
                invoiceId: invoice.id,
                amount: pendingAmt,
                branchId: reminder.branch_id,
                customerName: name,
                customerPhone: member.profiles?.phone,
                customerEmail: member.profiles?.email,
              },
            });
            if (linkRes?.short_url) paymentLink = linkRes.short_url;
          }
        } catch (e) {
          console.warn("razorpay link mint failed:", (e as Error).message);
        }
      }

      // The approved Meta templates use {{amount_due}}, {{due_date}} and
      // {{item_description}} and already print "₹" in the body — so values must
      // be symbol-free and named exactly. Sending `pending_amount` instead left
      // the slots blank ("clear the outstanding amount of ₹").
      const rawDue = invoice?.payment_due_date || invoice?.due_date || "";
      const dueDateStr = rawDue
        ? new Date(rawDue).toLocaleDateString("en-IN", {
            day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
          })
        : "";
      const amountPlain = pendingAmt.toLocaleString("en-IN", { maximumFractionDigits: 0 }).replace(/,/g, '');
      const variables: Record<string, string> = {
        member_name: name,
        invoice_number: invoice?.invoice_number || "",
        amount_due: amountPlain,
        amount: amountPlain,
        amount_plain: amountPlain,
        pending_amount: amountPlain,
        total_amount: totalAmt.toLocaleString("en-IN", { maximumFractionDigits: 0 }),
        item_description: invoice?.invoice_number
          ? `invoice ${invoice.invoice_number}`
          : "membership",
        due_date: dueDateStr,
        payment_link: paymentLink || "https://theincline.in/my-invoices",
        event_key: triggerEvent,
      };

      // Never mail a half-written reminder ("₹" with no number, no date).
      if (!amountPlain || Number(pendingAmt) <= 0 || !dueDateStr) {
        await adminClient
          .from("payment_reminders")
          .update({
            status: "skipped",
            skipped_reason: !dueDateStr ? "missing_due_date" : "missing_amount",
          })
          .eq("id", reminder.id);
        results.payment_reminders_skipped = (results.payment_reminders_skipped || 0) + 1;
        continue;
      }


      notifications.push({
        user_id: member.user_id, branch_id: reminder.branch_id, title: "Payment Reminder",
        message: `Hi ${name}, ₹${pendingAmt.toFixed(0)} ${reminderCopy} on invoice ${invoice?.invoice_number || ""}.`,
        type: "warning", category: "payment", action_url: "/my-invoices",
      });

      // Resolve approved WhatsApp template for this event so Meta accepts it.
      const { data: tpl } = await adminClient
        .from("templates")
        .select("id, content, subject")
        .eq("type", "whatsapp")
        .eq("trigger_event", triggerEvent)
        .eq("meta_template_status", "APPROVED")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const subject = "Payment Reminder";
      const fallbackMsg = `Hi ${name}, ₹${pendingAmt.toFixed(0)} is ${reminderCopy} on invoice ${invoice?.invoice_number || ""}.${paymentLink ? ` Pay now: ${paymentLink}` : " Open the app to pay."}`;
      const channel = (reminder.channel as Channel) || getChannel(reminder.branch_id, "payment_due");

      // Use dispatcher directly so we can pass template_id + variables.
      let deliveryStatus: "sent" | "failed" | "skipped" = "skipped";
      let deliveryErr: string | null = null;
      try {
        const { error: dispErr } = await adminClient.functions.invoke("dispatch-communication", {
          body: {
            branch_id: reminder.branch_id,
            channel,
            category: "transactional",
            recipient: channel === "email" ? member.profiles?.email : member.profiles?.phone,
            template_id: channel === "whatsapp" ? tpl?.id ?? null : null,
            payload: {
              subject: tpl?.subject || subject,
              body: tpl?.content || fallbackMsg,
              variables,
            },
            dedupe_key: `payment_reminder:${reminder.id}`,
            member_id: reminder.member_id,
            force: false,
          },
        });
        if (dispErr) { deliveryStatus = "failed"; deliveryErr = dispErr.message; }
        else deliveryStatus = "sent";
      } catch (e) {
        deliveryStatus = "failed"; deliveryErr = (e as Error).message;
      }

      await adminClient
        .from("payment_reminders")
        .update({
          status: deliveryStatus,
          delivery_status: deliveryStatus,
          last_error: deliveryErr,
          attempt_count: (reminder.attempt_count || 0) + 1,
          sent_at: deliveryStatus === "sent" ? now.toISOString() : null,
          delivery_metadata: { payment_link: paymentLink || null, template_used: !!tpl?.id },
        })
        .eq("id", reminder.id);

      if (deliveryStatus === "sent") results.payment_reminders++;
      else if (deliveryStatus === "failed") failures.payment_reminders++;
    }

    // ── 2. Birthday wishes (in-app only — kept lightweight) ─────────
    const { data: birthdayProfiles } = await adminClient.from("profiles").select("id, full_name, date_of_birth, email, phone");
    for (const profile of birthdayProfiles || []) {
      if (!profile.date_of_birth) continue;
      const dob = new Date(profile.date_of_birth);
      if (dob.getMonth() === now.getMonth() && dob.getDate() === now.getDate()) {
        const { count } = await adminClient.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", profile.id).eq("category", "birthday").gte("created_at", today + "T00:00:00");
        if ((count || 0) > 0) continue;
        notifications.push({ user_id: profile.id, title: "🎂 Happy Birthday!", message: `Happy Birthday, ${profile.full_name || ""}! Wishing you a great day!`, type: "info", category: "birthday" });
        results.birthday_wishes++;
      }
    }

    // ── 3. Membership expiry reminders (HONEST delivery) ────────────
    const { data: activeBranches } = await adminClient.from("branches").select("id").eq("is_active", true);
    for (const branch of activeBranches || []) {
      if (!isReminderEnabled(branch.id, "membership_expiry")) continue;
      const channel = getChannel(branch.id, "membership_expiry");
      const daysBeforeArr = getDaysBefore(branch.id, "membership_expiry");

      for (const daysOut of daysBeforeArr) {
        const targetDate = new Date(now.getTime() + daysOut * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
        const { data: expiringMemberships } = await adminClient
          .from("memberships")
          .select("id, member_id, end_date, branch_id, members:member_id (user_id, member_code, profiles:user_id (full_name, phone, email)), membership_plans:plan_id (name)")
          .eq("status", "active").eq("end_date", targetDate).eq("branch_id", branch.id);

        for (const ms of expiringMemberships || []) {
          const member = ms.members as any;
          if (!member?.user_id) continue;
          const { count } = await adminClient.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", member.user_id).eq("category", "membership").ilike("message", `%${daysOut} day%`).gte("created_at", today + "T00:00:00");
          if ((count || 0) > 0) continue;
          const planName = (ms.membership_plans as any)?.name || "your plan";
          const memberName = member.profiles?.full_name || "Member";
          const message = `Hi ${memberName}, your membership (${planName}) expires in ${daysOut} day${daysOut > 1 ? "s" : ""}. Renew now to avoid interruption.`;
          const subject = "Membership Expiring Soon";

          notifications.push({
            user_id: member.user_id, branch_id: ms.branch_id, title: subject,
            message, type: "warning", category: "membership", action_url: "/my-membership",
          });

          const delivery = await deliver(channel, {
            branchId: ms.branch_id,
            memberId: ms.member_id,
            phone: member.profiles?.phone,
            email: member.profiles?.email,
            subject,
            message,
          });
          logComm(delivery, {
            branchId: ms.branch_id, memberId: ms.member_id,
            recipient: member.profiles?.email || member.profiles?.phone || member.member_code,
            subject, message,
          });

          if (delivery.status === "sent") results.membership_expiry++;
          else if (delivery.status === "failed") failures.membership_expiry++;
        }
      }
    }

    // ── 4. Class reminders (HONEST delivery) ────────────────────────
    const { data: tomorrowClasses } = await adminClient
      .from("class_bookings")
      .select("id, member_id, class_id, classes:class_id (name, scheduled_at, branch_id), members:member_id (user_id, member_code, profiles:user_id (full_name, phone, email))")
      .eq("status", "booked");
    for (const booking of tomorrowClasses || []) {
      const cls = booking.classes as any;
      if (!cls?.scheduled_at || cls.scheduled_at.split("T")[0] !== tomorrow) continue;
      if (!isReminderEnabled(cls.branch_id, "class_reminder")) continue;
      const member = booking.members as any;
      if (!member?.user_id) continue;
      const channel = getChannel(cls.branch_id, "class_reminder");
      const memberName = member.profiles?.full_name || "Member";
      const subject = "Class Tomorrow";
      const message = `Hi ${memberName}, reminder: you have "${cls.name}" scheduled for tomorrow. See you there!`;

      notifications.push({
        user_id: member.user_id, branch_id: cls.branch_id, title: subject,
        message, type: "info", category: "class", action_url: "/my-classes",
      });

      const delivery = await deliver(channel, {
        branchId: cls.branch_id,
        memberId: booking.member_id,
        phone: member.profiles?.phone,
        email: member.profiles?.email,
        subject,
        message,
      });
      logComm(delivery, {
        branchId: cls.branch_id, memberId: booking.member_id,
        recipient: member.profiles?.email || member.profiles?.phone || member.member_code,
        subject, message,
      });

      if (delivery.status === "sent") results.class_reminders++;
      else if (delivery.status === "failed") failures.class_reminders++;
    }

    // ── 5. PT session reminders (HONEST delivery) ───────────────────
    const { data: tomorrowPT } = await adminClient
      .from("pt_sessions")
      .select("id, member_pt_package_id, trainer_id, scheduled_at, member_pt_packages:member_pt_package_id (member_id, branch_id, members:member_id (user_id, member_code, profiles:user_id (full_name, phone, email)))")
      .eq("status", "scheduled").gte("scheduled_at", tomorrow + "T00:00:00").lt("scheduled_at", tomorrow + "T23:59:59");
    for (const session of tomorrowPT || []) {
      const pkg = session.member_pt_packages as any;
      const member = pkg?.members;
      if (!member?.user_id) continue;
      if (!isReminderEnabled(pkg.branch_id, "pt_reminder")) continue;
      const channel = getChannel(pkg.branch_id, "pt_reminder");
      const memberName = member.profiles?.full_name || "Member";
      const subject = "PT Session Tomorrow";
      const message = `Hi ${memberName}, reminder: you have a Personal Training session scheduled for tomorrow.`;

      notifications.push({
        user_id: member.user_id, branch_id: pkg.branch_id, title: subject,
        message, type: "info", category: "pt_session", action_url: "/my-pt-sessions",
      });

      const delivery = await deliver(channel, {
        branchId: pkg.branch_id,
        memberId: pkg.member_id,
        phone: member.profiles?.phone,
        email: member.profiles?.email,
        subject,
        message,
      });
      logComm(delivery, {
        branchId: pkg.branch_id, memberId: pkg.member_id,
        recipient: member.profiles?.email || member.profiles?.phone || member.member_code,
        subject, message,
      });

      if (delivery.status === "sent") results.pt_reminders++;
      else if (delivery.status === "failed") failures.pt_reminders++;
    }

    // ── 6. Benefit booking reminders (HONEST delivery) ──────────────
    // Read mode from request body: T-24h (default, daily) or T-2h (every 30 min)
    let reminderMode: "t24h" | "t2h" = "t24h";
    try {
      const body = await req.clone().json().catch(() => ({}));
      if (body?.mode === "benefit_t2h") reminderMode = "t2h";
    } catch (_) { /* default */ }

    let benefitQuery = adminClient
      .from("benefit_bookings")
      .select("id, member_id, slot_id, benefit_slots:slot_id (slot_date, start_time, branch_id, benefit_type), members:member_id (user_id, member_code, profiles:user_id (full_name, phone, email))")
      .eq("status", "booked")
      .order("created_at", { ascending: false })
      .limit(500);

    if (reminderMode === "t24h") {
      benefitQuery = benefitQuery.eq("benefit_slots.slot_date", tomorrow);
    } else {
      benefitQuery = benefitQuery.eq("benefit_slots.slot_date", today);
    }

    const { data: tomorrowBenefits } = await benefitQuery;
    const nowMs = now.getTime();
    for (const booking of tomorrowBenefits || []) {
      const slot = booking.benefit_slots as any;
      if (!slot) continue;

      // For T-2h mode: only fire if slot starts in 90-150 minutes
      if (reminderMode === "t2h") {
        const slotMs = new Date(`${slot.slot_date}T${slot.start_time}`).getTime();
        const minutesAway = (slotMs - nowMs) / 60000;
        if (minutesAway < 90 || minutesAway > 150) continue;
      } else {
        if (slot.slot_date !== tomorrow) continue;
      }

      if (!isReminderEnabled(slot.branch_id, "benefit_reminder")) continue;
      const member = booking.members as any;
      if (!member?.user_id) continue;
      const channel = getChannel(slot.branch_id, "benefit_reminder");
      const memberName = member.profiles?.full_name || "Member";
      const subject = reminderMode === "t2h" ? "Session in 2 hours" : "Benefit Booking Tomorrow";
      const message = reminderMode === "t2h"
        ? `Hi ${memberName}, your ${slot.benefit_type} session starts in about 2 hours at ${(slot.start_time || '').slice(0,5)}. See you soon!`
        : `Hi ${memberName}, reminder: you have a ${slot.benefit_type} booking tomorrow at ${(slot.start_time || '').slice(0,5)}.`;

      notifications.push({
        user_id: member.user_id, branch_id: slot.branch_id, title: subject,
        message, type: "info", category: "benefit", action_url: "/my-benefits",
      });

      const delivery = await deliver(channel, {
        branchId: slot.branch_id,
        memberId: booking.member_id,
        phone: member.profiles?.phone,
        email: member.profiles?.email,
        subject,
        message,
      });
      logComm(delivery, {
        branchId: slot.branch_id, memberId: booking.member_id,
        recipient: member.profiles?.email || member.profiles?.phone || member.member_code,
        subject, message,
      });

      if (delivery.status === "sent") results.benefit_reminders++;
      else if (delivery.status === "failed") failures.benefit_reminders++;
    }

    // ── 7. Inactive member alerts (in-app only, staff-targeted) ─────
    try {
      for (const branch of activeBranches || []) {
        if (!isReminderEnabled(branch.id, "inactive_member")) continue;
        const { data: inactiveMembers } = await adminClient.rpc("get_inactive_members", {
          p_branch_id: branch.id,
          p_days: 21,
          p_limit: 20,
        });

        for (const member of inactiveMembers || []) {
          const { count } = await adminClient.from("notifications").select("id", { count: "exact", head: true })
            .eq("category", "retention").ilike("message", `%${member.member_code}%`).gte("created_at", today + "T00:00:00");
          if ((count || 0) > 0) continue;

          const { count: nudgeCount } = await adminClient.from("retention_nudge_logs")
            .select("id", { count: "exact", head: true })
            .eq("member_id", member.member_id)
            .gt("stage_level", 0);

          const { data: branchStaff } = await adminClient
            .from("staff_branches")
            .select("user_id")
            .eq("branch_id", branch.id);
          const branchStaffIds = (branchStaff || []).map((s: any) => s.user_id);

          const { data: ownersAdmins } = await adminClient
            .from("user_roles")
            .select("user_id")
            .in("role", ["owner", "admin"]);
          const ownerAdminIds = (ownersAdmins || []).map((r: any) => r.user_id);

          const recipientIds = Array.from(new Set([...branchStaffIds, ...ownerAdminIds]));
          for (const uid of recipientIds) {
            notifications.push({
              user_id: uid, branch_id: branch.id,
              title: "⚠️ Warm Follow-Up Needed",
              message: `${member.full_name} (${member.member_code}) has been absent ${member.days_absent || '21+'}d. Automated nudges: ${Math.min(nudgeCount || 0, 3)}/3. Please call.`,
              type: "warning", category: "retention",
            });
          }

          results.inactive_member_alerts++;
        }
      }
    } catch (err) {
      console.error("Inactive member alerts error:", err);
    }

    // ── 8. Task reminders & overdue escalation ──────────────────────
    try {
      // 8a. Explicit task_reminders rows due now (one-shot, in_app)
      const { data: dueReminders } = await adminClient
        .from("task_reminders")
        .select("id, task_id, channel, tasks:task_id (id, title, branch_id, assigned_to, status, due_date)")
        .is("sent_at", null)
        .lte("remind_at", now.toISOString())
        .limit(500);
      for (const r of dueReminders || []) {
        const t: any = r.tasks;
        if (!t || t.status === "completed" || t.status === "cancelled") {
          await adminClient.from("task_reminders").update({ sent_at: now.toISOString() }).eq("id", r.id);
          continue;
        }
        if (t.assigned_to) {
          notifications.push({
            user_id: t.assigned_to, branch_id: t.branch_id,
            title: "Task reminder",
            message: `Reminder: "${t.title}"${t.due_date ? ` — due ${new Date(t.due_date).toLocaleDateString()}` : ""}`,
            type: "info", category: "task", action_url: "/tasks",
          });
        }
        await adminClient.from("task_reminders").update({ sent_at: now.toISOString() }).eq("id", r.id);
        results.task_reminders++;
      }

      // 8b. Auto reminder for tasks due within next 24h (one per day per task)
      const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
      const { data: dueSoon } = await adminClient
        .from("tasks")
        .select("id, title, branch_id, assigned_to, due_date, assigned_by, status")
        .in("status", ["pending", "in_progress"])
        .not("assigned_to", "is", null)
        .not("due_date", "is", null)
        .gte("due_date", now.toISOString())
        .lte("due_date", in24h)
        .limit(500);
      for (const t of dueSoon || []) {
        const { count } = await adminClient.from("notifications").select("id", { count: "exact", head: true })
          .eq("user_id", t.assigned_to!).eq("category", "task").ilike("message", `%${t.title}%`)
          .gte("created_at", today + "T00:00:00");
        if ((count || 0) > 0) continue;
        notifications.push({
          user_id: t.assigned_to, branch_id: t.branch_id,
          title: "Task due soon",
          message: `Task "${t.title}" is due ${new Date(t.due_date!).toLocaleString()}.`,
          type: "warning", category: "task", action_url: "/tasks",
        });
        results.task_reminders++;
      }

      // 8c. Overdue escalation (>24h past due) → assigner + branch managers
      const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const { data: overdue } = await adminClient
        .from("tasks")
        .select("id, title, branch_id, assigned_to, due_date, assigned_by, status")
        .in("status", ["pending", "in_progress"])
        .not("due_date", "is", null)
        .lt("due_date", past24h)
        .limit(500);
      for (const t of overdue || []) {
        const escalateTo = new Set<string>();
        if (t.assigned_by) escalateTo.add(t.assigned_by);

        // branch managers for this branch
        const { data: mgrLinks } = await adminClient
          .from("staff_branches").select("user_id").eq("branch_id", t.branch_id);
        const userIds = (mgrLinks || []).map((s: any) => s.user_id);
        if (userIds.length) {
          const { data: mgrRoles } = await adminClient
            .from("user_roles").select("user_id").in("user_id", userIds).in("role", ["manager", "owner", "admin"]);
          for (const m of mgrRoles || []) escalateTo.add(m.user_id);
        }

        for (const uid of escalateTo) {
          const { count } = await adminClient.from("notifications").select("id", { count: "exact", head: true })
            .eq("user_id", uid).eq("category", "task_overdue").ilike("message", `%${t.title}%`)
            .gte("created_at", today + "T00:00:00");
          if ((count || 0) > 0) continue;
          notifications.push({
            user_id: uid, branch_id: t.branch_id,
            title: "⚠️ Overdue task",
            message: `Task "${t.title}" is overdue (due ${new Date(t.due_date!).toLocaleDateString()}). Please follow up with the assignee.`,
            type: "warning", category: "task_overdue", action_url: "/tasks",
          });
          results.task_overdue_escalations++;
        }
      }
    } catch (err) {
      console.error("Task reminders error:", err);
    }

    // Bulk insert notifications
    if (notifications.length > 0) {
      const { error: notifErr } = await adminClient.from("notifications").insert(notifications);
      if (notifErr) console.error("Notification insert error:", notifErr);
    }

    if (commLogs.length > 0) {
      const { error: logErr } = await adminClient.from("communication_logs").insert(commLogs);
      if (logErr) console.error("Comm log insert error:", logErr);
    }

    // ─── Retention / cleanup sweeps (idempotent; safe to run every cron tick) ───
    let cleanup: any = {};
    try {
      const { data: cnRes } = await adminClient.rpc('cleanup_old_notifications');
      cleanup.notifications = cnRes;
    } catch (e: any) { console.error('cleanup_old_notifications failed', e?.message); }
    try {
      const { data: weRes } = await adminClient.rpc('expire_wallet_balances');
      cleanup.benefit_credit_expiry = weRes;
    } catch (e: any) { console.error('expire_wallet_balances failed', e?.message); }
    // Archive runs at most once a week (Sundays) to bound work.
    if (now.getUTCDay() === 0) {
      try {
        const { data: arRes } = await adminClient.rpc('archive_approval_audit_log');
        cleanup.approval_audit_archive = arRes;
      } catch (e: any) { console.error('archive_approval_audit_log failed', e?.message); }
    }

    const totalProcessed = Object.values(results).reduce((a, b) => a + b, 0);
    const totalFailed = Object.values(failures).reduce((a, b) => a + b, 0);

    console.log(`[send-reminders v2] sent=${totalProcessed} failed=${totalFailed} cleanup=${JSON.stringify(cleanup)}`, JSON.stringify({ results, failures }));

    return new Response(
      JSON.stringify({
        success: true,
        total_processed: totalProcessed,
        total_failed: totalFailed,
        details: results,
        failures,
        cleanup,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    await captureEdgeError('send-reminders', error);
    console.error("Reminders error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
