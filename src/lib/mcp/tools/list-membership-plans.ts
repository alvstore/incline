import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_membership_plans",
  title: "List membership plans",
  description:
    "List membership plans with duration, price, discounted price and GST settings for a branch.",
  inputSchema: {
    branch_id: z.string().uuid().optional().describe("Restrict to one branch."),
    active_only: z.boolean().optional().describe("Only active plans (default true)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ branch_id, active_only }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("membership_plans")
      .select("id, name, description, duration_days, price, discounted_price, admission_fee, gst_rate, is_gst_inclusive, is_active, branch_id")
      .order("display_order", { ascending: true });
    if (branch_id) query = query.eq("branch_id", branch_id);
    if (active_only !== false) query = query.eq("is_active", true);

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { plans: data ?? [] },
    };
  },
});
