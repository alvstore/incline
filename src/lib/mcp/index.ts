import { auth, defineMcp } from "@lovable.dev/mcp-js";
import searchMembersTool from "./tools/search-members";
import getMemberOverviewTool from "./tools/get-member-overview";
import listOutstandingDuesTool from "./tools/list-outstanding-dues";
import attendanceSummaryTool from "./tools/attendance-summary";
import listLeadsTool from "./tools/list-leads";
import createLeadTool from "./tools/create-lead";
import listTasksTool from "./tools/list-tasks";
import listBranchesTool from "./tools/list-branches";
import listMembershipPlansTool from "./tools/list-membership-plans";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "incline-rise-reflect-repeat",
  title: "Incline - Rise. Reflect.Repeat.",
  version: "0.1.0",
  instructions:
    "Tools for the Incline gym management platform. Look up members and their memberships, dues and check-ins; review outstanding invoice dues; check daily attendance; browse and create CRM leads; review staff tasks, branches and membership plans. Every call runs as the signed-in Incline user, so results respect that user's branch and role permissions.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    searchMembersTool,
    getMemberOverviewTool,
    listOutstandingDuesTool,
    attendanceSummaryTool,
    listLeadsTool,
    createLeadTool,
    listTasksTool,
    listBranchesTool,
    listMembershipPlansTool,
  ],
});
