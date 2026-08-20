import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

/** Start/end of an IST calendar day, expressed as UTC ISO timestamps. */
function istDayRange(day: string) {
  const start = new Date(`${day}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function istToday(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default defineTool({
  name: "attendance_summary",
  title: "Attendance summary",
  description:
    "Gym check-in activity for one calendar day (IST). Returns the check-in count and the individual check-in/check-out records.",
  inputSchema: {
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Day in YYYY-MM-DD (IST). Defaults to today."),
    branch_id: z.string().uuid().optional().describe("Restrict to one branch."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ date, branch_id }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const day = date ?? istToday();
    const { start, end } = istDayRange(day);
    const supabase = supabaseForUser(ctx);

    let query = supabase
      .from("member_attendance")
      .select("member_id, branch_id, check_in, check_out, check_in_method")
      .gte("check_in", start)
      .lt("check_in", end)
      .order("check_in", { ascending: false })
      .limit(500);
    if (branch_id) query = query.eq("branch_id", branch_id);

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const records = data ?? [];
    const payload = {
      date: day,
      check_in_count: records.length,
      unique_members: new Set(records.map((r) => r.member_id)).size,
      records,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
