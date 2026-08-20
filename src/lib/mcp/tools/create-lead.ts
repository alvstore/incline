import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "create_lead",
  title: "Create lead",
  description:
    "Add a new enquiry/lead to the CRM with name, phone and optional email, branch, source and notes.",
  inputSchema: {
    full_name: z.string().trim().min(1).describe("Lead's full name."),
    phone: z.string().trim().min(6).describe("Contact number, ideally in +91XXXXXXXXXX form."),
    email: z.string().trim().email().optional().describe("Email address."),
    branch_id: z.string().uuid().optional().describe("Branch the lead belongs to."),
    source: z.string().trim().optional().describe("Where the lead came from, e.g. walk_in, instagram, referral."),
    notes: z.string().trim().optional().describe("Free-text context about the enquiry."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ full_name, phone, email, branch_id, source, notes }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("leads")
      .insert({
        full_name,
        phone,
        email: email ?? null,
        branch_id: branch_id ?? null,
        source: source ?? "mcp",
        notes: notes ?? null,
      })
      .select("id, full_name, phone, email, status, source, branch_id, created_at");

    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data?.[0] ?? null) }],
      structuredContent: { lead: data?.[0] ?? null },
    };
  },
});
