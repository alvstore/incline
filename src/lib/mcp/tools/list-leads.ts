import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_leads",
  title: "List leads",
  description:
    "List CRM leads, newest first, optionally filtered by status or branch. Returns name, contact, source, status and next action.",
  inputSchema: {
    status: z.string().trim().optional().describe("Lead status filter, e.g. new, contacted, won, lost."),
    branch_id: z.string().uuid().optional().describe("Restrict to one branch."),
    limit: z.number().int().min(1).max(100).optional().describe("Max leads (default 25)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, branch_id, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("leads")
      .select(
        "id, full_name, phone, email, status, source, temperature, plan_interest, next_action_at, last_contacted_at, branch_id, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(limit ?? 25);
    if (status) query = query.eq("status", status);
    if (branch_id) query = query.eq("branch_id", branch_id);

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { leads: data ?? [] },
    };
  },
});
