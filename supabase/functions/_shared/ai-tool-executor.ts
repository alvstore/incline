// Shared AI tool executor — used by whatsapp-webhook + meta-webhook
// v1.2.0 — persists tool-derived facts to ai_memory (contact, bookings)
import type { MemberContext } from "./ai-tools.ts";
import { upsertMemory } from "./ai-memory.ts";

type SB = any; // SupabaseClient (kept loose to avoid duplicate imports)

export async function executeSharedToolCall(
  supabase: SB,
  supabaseUrl: string,
  serviceRoleKey: string,
  toolName: string,
  args: Record<string, any>,
  ctx: MemberContext,
  phoneNumber: string,
  branchId: string,
  platform: "whatsapp" | "instagram" | "messenger" = "whatsapp",
): Promise<Record<string, any>> {
  try {
    switch (toolName) {
      // ─── Membership & Account ─────────────────────────────
      case "get_member_profile": {
        if (!ctx.memberId) return { error: "Not a registered member." };
        const { data: m } = await supabase
          .from("members")
          .select("id, member_code, branch_id, created_at, profiles(full_name, email, phone), branches(name)")
          .eq("id", ctx.memberId)
          .maybeSingle();
        if (!m) return { error: "Member not found." };
        const p: any = (m as any).profiles || {};
        return {
          member_code: (m as any).member_code,
          name: p.full_name,
          email: p.email,
          phone: p.phone,
          branch: (m as any).branches?.name,
          joined: (m as any).created_at,
        };
      }

      case "update_member_contact": {
        if (!ctx.memberId) return { error: "Not a registered member." };
        const updates: Record<string, any> = {};
        if (args.email) updates.email = args.email;
        if (args.phone) updates.phone = args.phone;
        if (Object.keys(updates).length === 0) return { error: "Provide email or phone to update." };
        const { data: m } = await supabase.from("members").select("user_id").eq("id", ctx.memberId).maybeSingle();
        if (!m?.user_id) return { error: "Profile not linked." };
        const { error } = await supabase.from("profiles").update(updates).eq("id", m.user_id);
        if (error) return { error: "Update failed." };
        await upsertMemory(supabase, branchId, platform, phoneNumber, {
          profile: updates,
          do_not_ask_add: Object.keys(updates),
        });
        return { success: true, message: "Contact updated. ✅" };
      }

      case "request_freeze": {
        if (!ctx.memberId || !ctx.membershipId) return { error: "No active membership to freeze." };
        if (!args.from_date || !args.to_date) return { error: "from_date and to_date are required." };
        const { data, error } = await supabase.from("approval_requests").insert({
          branch_id: branchId,
          approval_type: "membership_freeze",
          reference_type: "membership",
          reference_id: ctx.membershipId,
          status: "pending",
          request_data: {
            member_id: ctx.memberId,
            from_date: args.from_date,
            to_date: args.to_date,
            reason: args.reason || "Requested via WhatsApp",
            channel: platform,
          },
        }).select("id").single();
        if (error) return { error: "Failed to submit freeze request." };
        return { success: true, request_id: data.id, message: "Freeze request submitted for staff approval. ⏸️" };
      }

      case "request_resume": {
        if (!ctx.memberId || !ctx.membershipId) return { error: "No membership found." };
        const { data, error } = await supabase.from("approval_requests").insert({
          branch_id: branchId,
          approval_type: "membership_resume",
          reference_type: "membership",
          reference_id: ctx.membershipId,
          status: "pending",
          request_data: { member_id: ctx.memberId, channel: platform },
        }).select("id").single();
        if (error) return { error: "Failed to submit resume request." };
        return { success: true, request_id: data.id, message: "Resume request submitted. ▶️" };
      }

      // ─── Bookings ─────────────────────────────────────────
      // Find available facility slots (read-only helper for the AI).
      case "get_available_slots":
      case "find_facility_slots": {
        const date = args.date || new Date().toISOString().split("T")[0];
        let q = supabase
          .from("benefit_slots")
          .select("id, slot_date, start_time, end_time, capacity, booked_count, facilities(name)")
          .eq("branch_id", branchId)
          .eq("slot_date", date)
          .eq("is_active", true)
          .order("start_time", { ascending: true })
          .limit(20);
        if (args.facility_id) q = q.eq("facility_id", args.facility_id);
        const { data } = await q;
        const open = (data || []).filter((s: any) => (s.booked_count || 0) < (s.capacity || 0));
        return {
          date,
          slots: open.map((s: any) => ({
            slot_id: s.id,
            facility: s.facilities?.name || "Facility",
            start: s.start_time,
            end: s.end_time,
            available: (s.capacity || 0) - (s.booked_count || 0),
          })),
        };
      }

      // Authoritative facility booking via RPC — enforces slot lock,
      // entitlement check, duplicate prevention, and refund on cancel.
      case "book_facility":
      case "book_facility_slot": {
        if (!ctx.memberId) return { error: "Not a registered member." };
        if (!args.slot_id) return { error: "slot_id required." };
        const { data, error } = await supabase.rpc("book_facility_slot", {
          p_slot_id: args.slot_id,
          p_member_id: ctx.memberId,
          p_membership_id: ctx.membershipId ?? null,
          p_staff_id: null,
          p_source: platform,
          p_force: false,
          p_force_reason: null,
        });
        if (error) return { error: error.message || "Booking failed." };
        const result = data as any;
        if (!result?.success) {
          return {
            error: result?.error_message || result?.error || "Slot unavailable.",
            error_code: result?.error_code,
          };
        }
        return {
          success: true,
          booking_id: result.booking_id,
          message: `Booked. ✅`,
        };
      }

      case "cancel_booking":
      case "cancel_facility_booking": {
        if (!args.booking_id) return { error: "booking_id required." };
        const { data, error } = await supabase.rpc("cancel_facility_slot", {
          p_booking_id: args.booking_id,
          p_reason: args.reason || `Cancelled via ${platform}`,
          p_staff_id: null,
          p_override_deadline: false,
        });
        if (error) return { error: error.message || "Cancel failed." };
        const result = data as any;
        if (!result?.success) {
          return { error: result?.error_message || result?.error || "Could not cancel.", error_code: result?.error_code };
        }
        return { success: true, message: "Booking cancelled. ❎" };
      }

      case "list_my_bookings": {
        if (!ctx.memberId) return { error: "Not a registered member." };
        const { data } = await supabase
          .from("benefit_bookings")
          .select("id, status, benefit_slots(slot_date, start_time, end_time, facilities(name))")
          .eq("member_id", ctx.memberId)
          .in("status", ["booked", "confirmed"])
          .order("created_at", { ascending: false })
          .limit(10);
        const upcoming = (data || []).filter((b: any) => {
          const d = b.benefit_slots?.slot_date;
          return d && new Date(d) >= new Date(new Date().toISOString().split("T")[0]);
        }).map((b: any) => ({
          booking_id: b.id,
          facility: b.benefit_slots?.facilities?.name || "Facility",
          date: b.benefit_slots?.slot_date,
          time: `${b.benefit_slots?.start_time} - ${b.benefit_slots?.end_time}`,
          status: b.status,
        }));
        return { count: upcoming.length, bookings: upcoming };
      }

      // ─── Personal Training ────────────────────────────────
      case "list_trainers": {
        const { data } = await supabase
          .from("trainers_public")
          .select("id, full_name, specialization, bio")
          .eq("branch_id", branchId)
          .limit(10);
        return { trainers: data || [] };
      }

      case "book_pt_session": {
        if (!ctx.memberId) return { error: "Not a registered member." };
        if (!args.trainer_id || !args.scheduled_at) return { error: "trainer_id and scheduled_at required." };
        const { data: pkg } = await supabase
          .from("member_pt_packages")
          .select("id, sessions_remaining")
          .eq("member_id", ctx.memberId)
          .eq("status", "active")
          .gt("sessions_remaining", 0)
          .order("expiry_date", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (!pkg) return { error: "No active PT package with remaining sessions. Please purchase one." };
        const available = await supabase.rpc("check_trainer_slot_available", {
          _trainer_id: args.trainer_id,
          _scheduled_at: args.scheduled_at,
          _duration_minutes: args.duration_minutes || 60,
        });
        if (available.data === false) return { error: "Trainer not available at that time." };
        const { data: session, error } = await supabase.from("pt_sessions").insert({
          trainer_id: args.trainer_id,
          member_id: ctx.memberId,
          member_pt_package_id: pkg.id,
          branch_id: branchId,
          scheduled_at: args.scheduled_at,
          duration_minutes: args.duration_minutes || 60,
          status: "scheduled",
        }).select("id").single();
        if (error) return { error: "Failed to book session." };
        return { success: true, session_id: session.id, message: "PT session booked. 💪" };
      }

      case "cancel_pt_session": {
        if (!args.session_id) return { error: "session_id required." };
        const { error } = await supabase
          .from("pt_sessions")
          .update({ status: "cancelled" })
          .eq("id", args.session_id)
          .eq("member_id", ctx.memberId)
          .eq("status", "scheduled");
        if (error) return { error: "Failed to cancel session." };
        return { success: true, message: "Session cancelled." };
      }

      // ─── Payments & Billing ───────────────────────────────
      case "get_outstanding_dues": {
        if (!ctx.memberId) return { error: "Not a registered member." };
        const { data } = await supabase
          .from("invoices")
          .select("id, invoice_number, total_amount, amount_paid, due_date, status")
          .eq("member_id", ctx.memberId)
          .in("status", ["pending", "partial", "overdue"])
          .order("due_date", { ascending: true });
        const items = (data || []).map((i: any) => ({
          invoice_id: i.id,
          invoice_number: i.invoice_number,
          balance: Number(i.total_amount || 0) - Number(i.amount_paid || 0),
          due_date: i.due_date,
          status: i.status,
        }));
        const total = items.reduce((s: number, i: { balance: number }) => s + i.balance, 0);
        return { total_due: `₹${total.toFixed(2)}`, count: items.length, invoices: items };
      }

      case "list_invoices": {
        if (!ctx.memberId) return { error: "Not a registered member." };
        const { data } = await supabase
          .from("invoices")
          .select("id, invoice_number, total_amount, amount_paid, status, created_at, due_date")
          .eq("member_id", ctx.memberId)
          .order("created_at", { ascending: false })
          .limit(10);
        return { invoices: data || [] };
      }

      case "send_invoice_pdf": {
        if (!args.invoice_id) return { error: "invoice_id required." };
        const url = `${supabaseUrl.replace(".supabase.co", ".lovable.app")}/invoice/${args.invoice_id}`;
        return { success: true, message: `Here is your invoice: ${url}` };
      }

      case "create_payment_link": {
        if (!args.invoice_id) return { error: "invoice_id required." };
        try {
          const resp = await fetch(`${supabaseUrl}/functions/v1/create-razorpay-link`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({ invoice_id: args.invoice_id, branch_id: branchId }),
          });
          const data = await resp.json();
          if (!resp.ok || !data?.short_url) return { error: data?.error || "Failed to create payment link." };
          return { success: true, payment_link: data.short_url, message: `Pay securely here: ${data.short_url}` };
        } catch {
          return { error: "Payment link service unavailable." };
        }
      }

      case "get_wallet_balance": {
        if (!ctx.memberId) return { error: "Not a registered member." };
        const { data: wallet } = await supabase
          .from("wallets").select("id, balance").eq("member_id", ctx.memberId).maybeSingle();
        if (!wallet) return { balance: "₹0", transactions: [] };
        const { data: txns } = await supabase
          .from("wallet_transactions")
          .select("txn_type, amount, description, created_at")
          .eq("wallet_id", wallet.id)
          .order("created_at", { ascending: false }).limit(5);
        return { balance: `₹${wallet.balance}`, recent: txns || [] };
      }

      case "pay_with_wallet": {
        if (!ctx.memberId) return { error: "Not a registered member." };
        if (!args.invoice_id || !args.amount) return { error: "invoice_id and amount required." };
        const { data, error } = await supabase.rpc("record_payment", {
          p_branch_id: branchId,
          p_invoice_id: args.invoice_id,
          p_member_id: ctx.memberId,
          p_amount: args.amount,
          p_payment_method: "wallet",
          p_notes: `Paid via ${platform} bot`,
        });
        if (error || !data?.success) return { error: data?.error || "Payment failed." };
        return { success: true, message: `Paid ₹${args.amount} from wallet. New invoice status: ${data.new_status}.` };
      }

      // ─── Engagement & Loyalty ─────────────────────────────
      case "get_rewards_balance": {
        if (!ctx.memberId) return { error: "Not a registered member." };
        const { data } = await supabase
          .from("rewards_ledger")
          .select("points, reason, created_at")
          .eq("member_id", ctx.memberId)
          .order("created_at", { ascending: false }).limit(20);
        const total = (data || []).reduce((s: number, r: any) => s + (r.points || 0), 0);
        return { points: total, recent: (data || []).slice(0, 5) };
      }

      case "redeem_reward": {
        if (!ctx.memberId) return { error: "Not a registered member." };
        if (!args.points || args.points <= 0) return { error: "Valid points required." };
        const { data: ledger } = await supabase.from("rewards_ledger")
          .select("points").eq("member_id", ctx.memberId);
        const total = (ledger || []).reduce((s: number, r: any) => s + (r.points || 0), 0);
        if (total < args.points) return { error: `Insufficient points. Available: ${total}.` };
        const { error } = await supabase.from("rewards_ledger").insert({
          member_id: ctx.memberId,
          branch_id: branchId,
          points: -Math.abs(args.points),
          reason: args.reason || "Redeemed via bot",
          reference_type: "bot_redemption",
        });
        if (error) return { error: "Redemption failed." };
        return { success: true, message: `Redeemed ${args.points} points. Staff will arrange your reward. 🎁` };
      }

      case "get_referral_link": {
        if (!ctx.memberId) return { error: "Not a registered member." };
        const { data: m } = await supabase.from("members").select("member_code").eq("id", ctx.memberId).maybeSingle();
        const code = (m as any)?.member_code || ctx.memberId.slice(0, 8);
        const url = `https://incline.lovable.app/refer/${code}`;
        return { referral_code: code, link: url, message: `Share this with friends: ${url}` };
      }

      case "list_announcements": {
        const { data } = await supabase
          .from("announcements")
          .select("title, content, priority, expire_at")
          .eq("branch_id", branchId)
          .eq("is_active", true)
          .order("priority", { ascending: false }).limit(5);
        return { announcements: data || [] };
      }

      case "list_store_products": {
        let q = supabase.from("products")
          .select("id, name, price, category, description")
          .eq("branch_id", branchId).eq("is_active", true).limit(10);
        if (args.category) q = q.eq("category", args.category);
        const { data } = await q;
        return { products: data || [] };
      }

      // ─── Branch Info ──────────────────────────────────────
      case "get_branch_info": {
        const { data } = await supabase
          .from("branches")
          .select("name, address, city, phone, email, opening_time, closing_time")
          .eq("id", branchId).maybeSingle();
        return data || { error: "Branch not found." };
      }

      case "get_class_schedule": {
        const date = args.date || new Date().toISOString().split("T")[0];
        const { data } = await supabase
          .from("classes")
          .select("name, scheduled_at, duration_minutes, capacity, trainers_public(full_name)")
          .eq("branch_id", branchId)
          .eq("is_active", true)
          .gte("scheduled_at", `${date}T00:00:00`)
          .lt("scheduled_at", `${date}T23:59:59`)
          .order("scheduled_at", { ascending: true }).limit(20);
        return { date, classes: data || [] };
      }

      // ─── Group Class Bookings ─────────────────────────────
      case "book_class": {
        if (!ctx.memberId) return { error: "Not a registered member." };
        if (!args.class_id) return { error: "class_id required." };
        // Capacity check via existing booked count
        const { data: cls } = await supabase
          .from("classes")
          .select("id, name, capacity, scheduled_at, branch_id")
          .eq("id", args.class_id)
          .maybeSingle();
        if (!cls) return { error: "Class not found." };
        if (cls.branch_id !== branchId) return { error: "Class is at a different branch." };
        const { count: booked } = await supabase
          .from("class_bookings")
          .select("id", { count: "exact", head: true })
          .eq("class_id", args.class_id)
          .in("status", ["booked", "confirmed", "attended"]);
        if ((booked || 0) >= (cls.capacity || 0)) {
          return { error: "Class is full." };
        }
        // Prevent duplicate booking
        const { data: existing } = await supabase
          .from("class_bookings")
          .select("id")
          .eq("class_id", args.class_id)
          .eq("member_id", ctx.memberId)
          .in("status", ["booked", "confirmed"])
          .maybeSingle();
        if (existing) return { error: "You're already booked for this class.", booking_id: existing.id };
        const { data: booking, error } = await supabase
          .from("class_bookings")
          .insert({ class_id: args.class_id, member_id: ctx.memberId, status: "booked" })
          .select("id")
          .single();
        if (error) return { error: "Booking failed." };
        return { success: true, booking_id: booking.id, message: `Booked into ${cls.name}. ✅` };
      }

      case "cancel_class_booking": {
        if (!args.booking_id) return { error: "booking_id required." };
        const { error } = await supabase
          .from("class_bookings")
          .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancellation_reason: `Cancelled via ${platform}` })
          .eq("id", args.booking_id)
          .eq("member_id", ctx.memberId)
          .in("status", ["booked", "confirmed"]);
        if (error) return { error: "Cancel failed." };
        return { success: true, message: "Class booking cancelled." };
      }

      // ─── Renewal & Add-On Intents ─────────────────────────
      // Never charges directly — generates an invoice + Razorpay link.
      case "initiate_membership_renewal": {
        if (!ctx.memberId || !ctx.membershipId) {
          return { error: "No active membership to renew." };
        }
        // Resolve plan: explicit arg or current membership's plan
        let planId = args.plan_id || null;
        if (!planId) {
          const { data: ms } = await supabase
            .from("memberships")
            .select("plan_id")
            .eq("id", ctx.membershipId)
            .maybeSingle();
          planId = (ms as any)?.plan_id || null;
        }
        if (!planId) return { error: "Could not determine plan to renew." };
        const { data: plan } = await supabase
          .from("plans")
          .select("id, name, price, duration_days")
          .eq("id", planId)
          .maybeSingle();
        if (!plan) return { error: "Plan not found." };

        // Create a pending renewal invoice
        const { data: inv, error: invErr } = await supabase
          .from("invoices")
          .insert({
            branch_id: branchId,
            member_id: ctx.memberId,
            total_amount: plan.price,
            amount_paid: 0,
            status: "pending",
            invoice_type: "membership_renewal",
            notes: `Renewal for ${plan.name} (via ${platform} bot)`,
          })
          .select("id, invoice_number, total_amount")
          .single();
        if (invErr || !inv) return { error: "Failed to create renewal invoice." };

        // Try to attach a Razorpay payment link
        try {
          const resp = await fetch(`${supabaseUrl}/functions/v1/create-razorpay-link`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
            body: JSON.stringify({ invoice_id: inv.id, branch_id: branchId }),
          });
          const data = await resp.json();
          if (resp.ok && data?.short_url) {
            return {
              success: true,
              invoice_id: inv.id,
              invoice_number: inv.invoice_number,
              amount: `₹${plan.price}`,
              plan: plan.name,
              payment_link: data.short_url,
              message: `Renewal invoice for ${plan.name} (₹${plan.price}) ready. Pay securely: ${data.short_url}`,
            };
          }
        } catch (_) { /* fall through */ }
        return {
          success: true,
          invoice_id: inv.id,
          invoice_number: inv.invoice_number,
          amount: `₹${plan.price}`,
          plan: plan.name,
          message: `Renewal invoice ${inv.invoice_number} created for ₹${plan.price}. Staff will share a payment link shortly.`,
        };
      }

      case "purchase_addon_intent": {
        if (!ctx.memberId) return { error: "Not a registered member." };
        if (!args.package_id || !args.kind) return { error: "package_id and kind required." };
        const kind = String(args.kind).toLowerCase();
        const tableName = kind === "pt" ? "pt_packages" : "benefit_packages";
        const { data: pkg } = await supabase
          .from(tableName)
          .select("id, name, price")
          .eq("id", args.package_id)
          .maybeSingle();
        if (!pkg) return { error: "Package not found." };
        const checkoutUrl = `https://incline.lovable.app/member-dashboard?addon=${pkg.id}&kind=${kind}`;
        return {
          success: true,
          package: pkg.name,
          amount: `₹${pkg.price}`,
          checkout_link: checkoutUrl,
          message: `${pkg.name} (₹${pkg.price}) — open the app to confirm: ${checkoutUrl}`,
        };
      }

      case "list_branch_services": {
        const today = new Date().toISOString().split("T")[0];
        const [facilitiesRes, classesRes, benefitsRes, ptRes] = await Promise.all([
          supabase
            .from("facilities")
            .select("id, name, description, capacity")
            .eq("branch_id", branchId)
            .eq("is_active", true)
            .eq("under_maintenance", false)
            .limit(15),
          supabase
            .from("classes")
            .select("id, name, scheduled_at, capacity")
            .eq("branch_id", branchId)
            .eq("is_active", true)
            .gte("scheduled_at", `${today}T00:00:00`)
            .lt("scheduled_at", `${today}T23:59:59`)
            .order("scheduled_at", { ascending: true })
            .limit(10),
          supabase
            .from("benefit_packages")
            .select("id, name, benefit_type, quantity, price, validity_days")
            .eq("is_active", true)
            .or(`branch_id.eq.${branchId},branch_id.is.null`)
            .order("display_order", { ascending: true })
            .limit(10),
          supabase
            .from("pt_packages")
            .select("id, name, total_sessions, price, validity_days")
            .eq("is_active", true)
            .or(`branch_id.eq.${branchId},branch_id.is.null`)
            .order("price", { ascending: true })
            .limit(8),
        ]);
        return {
          facilities: facilitiesRes.data || [],
          classes_today: classesRes.data || [],
          benefit_addons: benefitsRes.data || [],
          pt_packages: ptRes.data || [],
        };
      }

      // ─── Request Status & Escalation ──────────────────────
      case "escalate_request": {
        if (!ctx.memberId) return { error: "Not a registered member." };
        if (!args.reason) return { error: "reason required." };
        const { data, error } = await supabase
          .from("approval_requests")
          .insert({
            branch_id: branchId,
            approval_type: "manual_escalation",
            reference_type: "member",
            reference_id: ctx.memberId,
            status: "pending",
            request_data: {
              member_id: ctx.memberId,
              category: args.category || "general",
              reason: args.reason,
              channel: platform,
            },
          })
          .select("id")
          .single();
        if (error) return { error: "Failed to escalate." };
        // Also flip bot off so a human can take over.
        await supabase
          .from("whatsapp_chat_settings")
          .upsert(
            { branch_id: branchId, phone_number: phoneNumber, bot_active: false },
            { onConflict: "branch_id,phone_number" },
          );
        return {
          success: true,
          request_id: data.id,
          message: "Flagged for staff review — a team member will be in touch shortly. 🙋",
        };
      }

      case "get_request_status": {
        if (!ctx.memberId) return { error: "Not a registered member." };
        const { data } = await supabase
          .from("approval_requests")
          .select("id, approval_type, status, created_at, reviewed_at, review_notes")
          .or(`reference_id.eq.${ctx.memberId},request_data->>member_id.eq.${ctx.memberId}`)
          .eq("branch_id", branchId)
          .order("created_at", { ascending: false })
          .limit(5);
        return {
          count: (data || []).length,
          requests: (data || []).map((r: any) => ({
            request_id: r.id,
            type: r.approval_type,
            status: r.status,
            submitted: r.created_at,
            reviewed: r.reviewed_at,
            notes: r.review_notes,
          })),
        };
      }

      default:
        return { error: `Tool not implemented in shared executor: ${toolName}` };
    }
  } catch (err: any) {
    console.error(`[shared tool] ${toolName} error:`, err);
    return { error: "An unexpected error occurred. Please try again." };
  }
}
