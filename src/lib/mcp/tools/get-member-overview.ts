import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_member_overview",
  title: "Get member overview",
  description:
    "Full snapshot for one member by member code: profile, current membership dates and status, outstanding invoice dues and recent gym check-ins.",
  inputSchema: {
    member_code: z.string().trim().min(1).describe("Member code, e.g. INC-26-0042."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ member_code }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);

    const { data: found, error: searchError } = await supabase.rpc("search_members", {
      search_term: member_code,
      p_limit: 5,
    });
    if (searchError) return { content: [{ type: "text", text: searchError.message }], isError: true };

    const rows = (found ?? []) as Array<Record<string, unknown>>;
    const member =
      rows.find((r) => String(r.member_code ?? "").toLowerCase() === member_code.toLowerCase()) ?? rows[0];
    if (!member) {
      return { content: [{ type: "text", text: `No member found for "${member_code}".` }], isError: true };
    }
    const memberId = member.id as string;

    const [memberships, invoices, attendance] = await Promise.all([
      supabase
        .from("memberships")
        .select("id, status, start_date, end_date, price_paid, plan_id, membership_plans(name, duration_days)")
        .eq("member_id", memberId)
        .order("start_date", { ascending: false })
        .limit(5),
      supabase
        .from("invoices")
        .select("invoice_number, status, total_amount, amount_paid, due_date, created_at")
        .eq("member_id", memberId)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("member_attendance")
        .select("check_in, check_out, check_in_method")
        .eq("member_id", memberId)
        .order("check_in", { ascending: false })
        .limit(10),
    ]);

    const invoiceRows = (invoices.data ?? []) as Array<{ total_amount: number; amount_paid: number }>;
    const outstanding = invoiceRows.reduce(
      (sum, inv) => sum + Math.max(0, Number(inv.total_amount ?? 0) - Number(inv.amount_paid ?? 0)),
      0,
    );

    const payload = {
      member,
      memberships: memberships.data ?? [],
      invoices: invoices.data ?? [],
      outstanding_dues: outstanding,
      recent_attendance: attendance.data ?? [],
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
