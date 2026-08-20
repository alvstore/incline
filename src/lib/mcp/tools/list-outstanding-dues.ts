import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_outstanding_dues",
  title: "List outstanding dues",
  description:
    "List invoices with money still to collect (unpaid, partially paid or overdue), newest first, with the pending amount per invoice.",
  inputSchema: {
    limit: z.number().int().min(1).max(100).optional().describe("Max invoices (default 25)."),
    branch_id: z.string().uuid().optional().describe("Restrict to one branch."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, branch_id }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("invoices")
      .select(
        "invoice_number, status, total_amount, amount_paid, due_date, payment_due_date, created_at, member_id, customer_name, customer_phone, branch_id",
      )
      .in("status", ["unpaid", "partial", "overdue", "pending"])
      .order("created_at", { ascending: false })
      .limit(limit ?? 25);
    if (branch_id) query = query.eq("branch_id", branch_id);

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const rows = (data ?? []).map((inv) => ({
      ...inv,
      pending_amount: Math.max(0, Number(inv.total_amount ?? 0) - Number(inv.amount_paid ?? 0)),
    }));
    const total = rows.reduce((sum, r) => sum + r.pending_amount, 0);
    const payload = { invoices: rows, total_pending: total };

    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
