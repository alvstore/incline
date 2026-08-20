import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_branches",
  title: "List branches",
  description:
    "List gym branches the signed-in user can see, with id, name, code, city and opening hours. Use the id to scope other tools.",
  inputSchema: {
    active_only: z.boolean().optional().describe("Only active branches (default true)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ active_only }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("branches")
      .select("id, name, code, city, state, phone, opening_time, closing_time, is_active")
      .order("name");
    if (active_only !== false) query = query.eq("is_active", true);

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { branches: data ?? [] },
    };
  },
});
