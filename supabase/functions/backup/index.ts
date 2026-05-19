// v1.0.0 — Unified backup endpoint (export + import).
// Replaces former `backup-export` and `backup-import` edge functions.
// Dispatch by body { action: "export" | "import", ... }.
//
// export → returns JSON file with Content-Disposition: attachment.
// import → accepts { data, dry_run?, conflict_strategy? } → returns { success, dry_run, summary }.
//
// Owner/admin only. Auth is validated in-code (verify_jwt also enabled via config.toml).
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Tables included in a full export (all CRM tables, skip auth.* / storage.*).
const EXPORT_TABLES = [
  "branches", "branch_settings", "branch_managers", "staff_branches",
  "profiles", "user_roles",
  "members", "memberships", "membership_plans", "plan_benefits",
  "benefit_types", "benefit_packages", "benefit_settings", "benefit_slots",
  "benefit_bookings", "benefit_usage",
  "employees", "trainers", "trainer_availability", "trainer_commissions",
  "contracts", "contract_templates",
  "leads", "follow_ups",
  "classes", "class_bookings", "class_waitlist",
  "pt_packages", "member_pt_packages", "pt_sessions",
  "diet_plans",
  "invoices", "invoice_items", "payments", "wallets", "wallet_transactions",
  "expenses", "expense_categories", "income_categories",
  "discount_codes",
  "products", "product_categories",
  "ecommerce_orders",
  "lockers",
  "equipment", "equipment_maintenance",
  "facilities",
  "announcements", "ad_banners",
  "feedback",
  "tasks",
  "communication_logs", "templates", "whatsapp_triggers",
  "notifications",
  "referrals",
  "rewards_ledger",
  "approval_requests",
  "ai_tool_logs",
  "audit_logs",
];

// Restore order: parents before children to satisfy FKs.
const RESTORE_ORDER = [
  "branches", "branch_settings", "branch_managers", "staff_branches",
  "profiles", "user_roles",
  "membership_plans", "plan_benefits",
  "benefit_types", "benefit_packages", "benefit_settings",
  "members", "memberships",
  "employees", "trainers", "trainer_availability",
  "contract_templates", "contracts",
  "leads", "follow_ups",
  "classes",
  "pt_packages", "member_pt_packages", "pt_sessions", "trainer_commissions",
  "diet_plans",
  "income_categories", "expense_categories",
  "discount_codes",
  "invoices", "invoice_items", "wallets", "wallet_transactions", "payments", "expenses",
  "product_categories", "products", "ecommerce_orders",
  "lockers",
  "equipment", "equipment_maintenance",
  "facilities", "benefit_slots", "benefit_bookings", "benefit_usage",
  "class_bookings", "class_waitlist",
  "announcements", "ad_banners",
  "feedback", "tasks",
  "templates", "whatsapp_triggers", "communication_logs",
  "notifications",
  "referrals",
  "rewards_ledger",
  "approval_requests",
  "ai_tool_logs",
  "audit_logs",
];

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}

type AdminCtx = { user: { id: string }; service: SupabaseClient };

async function requireOwnerOrAdmin(authHeader: string | null): Promise<AdminCtx | Response> {
  if (!authHeader) return jsonResponse({ error: "Missing auth" }, 401);

  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);

  const { data: roles } = await service
    .from("user_roles").select("role").eq("user_id", user.id);
  const isAdmin = (roles || []).some((r: any) => r.role === "owner" || r.role === "admin");
  if (!isAdmin) return jsonResponse({ error: "Owner/admin only" }, 403);

  return { user, service };
}

async function handleExport(ctx: AdminCtx): Promise<Response> {
  const backup: Record<string, any> = {
    meta: {
      version: 1,
      generated_at: new Date().toISOString(),
      generated_by: ctx.user.id,
      tables: EXPORT_TABLES,
    },
    data: {} as Record<string, unknown>,
  };

  for (const table of EXPORT_TABLES) {
    try {
      const { data, error } = await ctx.service.from(table).select("*");
      if (error) {
        console.warn(`Skipped ${table}: ${error.message}`);
        backup.data[table] = { error: error.message, rows: [] };
      } else {
        backup.data[table] = { rows: data || [] };
      }
    } catch (e: any) {
      console.warn(`Failed ${table}: ${e.message}`);
      backup.data[table] = { error: e.message, rows: [] };
    }
  }

  const filename = `incline-backup-${new Date().toISOString().slice(0, 10)}.json`;
  return new Response(JSON.stringify(backup, null, 2), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

async function handleImport(ctx: AdminCtx, payload: any): Promise<Response> {
  if (!payload?.data || typeof payload.data !== "object") {
    return jsonResponse({ error: "Invalid backup file (missing 'data' object)" }, 400);
  }

  const dryRun = payload.dry_run === true;
  const conflictStrategy: "skip" | "overwrite" = payload.conflict_strategy === "overwrite" ? "overwrite" : "skip";
  const summary: Record<string, { inserted: number; updated: number; skipped: number; errors: string[] }> = {};

  for (const table of RESTORE_ORDER) {
    const entry = payload.data[table];
    if (!entry?.rows || !Array.isArray(entry.rows)) continue;
    const rows = entry.rows;
    const stat = { inserted: 0, updated: 0, skipped: 0, errors: [] as string[] };

    if (dryRun) {
      stat.skipped = rows.length;
      summary[table] = stat;
      continue;
    }

    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      try {
        if (conflictStrategy === "overwrite") {
          const { error } = await ctx.service.from(table).upsert(chunk, { onConflict: "id" });
          if (error) stat.errors.push(error.message);
          else stat.updated += chunk.length;
        } else {
          const { data, error } = await ctx.service
            .from(table)
            .upsert(chunk, { onConflict: "id", ignoreDuplicates: true })
            .select("id");
          if (error) stat.errors.push(error.message);
          else stat.inserted += (data?.length ?? 0);
        }
      } catch (e: any) {
        stat.errors.push(e.message);
      }
    }
    summary[table] = stat;
  }

  return jsonResponse({ success: true, dry_run: dryRun, summary });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const ctxOrResp = await requireOwnerOrAdmin(req.headers.get("Authorization"));
    if (ctxOrResp instanceof Response) return ctxOrResp;
    const ctx = ctxOrResp;

    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    switch (action) {
      case "export":
        return await handleExport(ctx);
      case "import":
        return await handleImport(ctx, body);
      default:
        return jsonResponse({ error: "Unknown action. Use { action: 'export' | 'import' }." }, 400);
    }
  } catch (e: any) {
    console.error("backup error:", e);
    return jsonResponse({ error: e?.message || "Internal error" }, 500);
  }
});
