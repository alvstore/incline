import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_tasks",
  title: "List staff tasks",
  description:
    "List operational staff tasks with title, priority, status, due date and assignee. Optionally filter by status or branch.",
  inputSchema: {
    status: z.string().trim().optional().describe("Task status filter, e.g. pending, in_progress, completed."),
    branch_id: z.string().uuid().optional().describe("Restrict to one branch."),
    limit: z.number().int().min(1).max(100).optional().describe("Max tasks (default 25)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, branch_id, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("tasks")
      .select("id, title, description, priority, status, due_date, due_time, assigned_to, branch_id, created_at")
      .order("created_at", { ascending: false })
      .limit(limit ?? 25);
    if (status) query = query.eq("status", status);
    if (branch_id) query = query.eq("branch_id", branch_id);

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { tasks: data ?? [] },
    };
  },
});
