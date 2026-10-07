// v1.0.0 — Shared caller authorization for edge functions.
// Accepts, in order:
//   1. Internal calls: `x-internal-token` header matching private.internal_fn_config
//      (used by pg_cron jobs and DB triggers), or a Bearer equal to the service-role key
//      (edge-to-edge calls).
//   2. Signed-in users whose roles (public.user_roles) intersect `roles`.
// Everything else is rejected with 401/403.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type AppRole = "owner" | "admin" | "manager" | "trainer" | "staff" | "member";
export const STAFF_ROLES: AppRole[] = ["owner", "admin", "manager", "staff"];
export const MANAGER_ROLES: AppRole[] = ["owner", "admin", "manager"];

export interface CallerResult {
  ok: true;
  internal: boolean;
  userId: string | null;
  roles: AppRole[];
  admin: SupabaseClient;
}
export interface CallerDenied { ok: false; response: Response }

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

let _admin: SupabaseClient | null = null;
function adminClient(): SupabaseClient {
  if (!_admin) _admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  return _admin;
}

export async function isInternalCall(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (bearer && SERVICE_KEY && bearer === SERVICE_KEY) return true;
  const tok = req.headers.get("x-internal-token");
  if (tok && tok.length >= 32) {
    const { data, error } = await adminClient().rpc("verify_internal_fn_token", { p_token: tok });
    if (!error && data === true) return true;
  }
  return false;
}

function deny(status: number, msg: string, cors: Record<string, string>): CallerDenied {
  return {
    ok: false,
    response: new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    }),
  };
}

export async function requireCaller(
  req: Request,
  cors: Record<string, string>,
  opts: { roles?: AppRole[]; allowInternal?: boolean } = {},
): Promise<CallerResult | CallerDenied> {
  const admin = adminClient();
  const allowInternal = opts.allowInternal ?? true;
  if (allowInternal && (await isInternalCall(req))) {
    return { ok: true, internal: true, userId: null, roles: [], admin };
  }
  const roles = opts.roles;
  if (!roles || roles.length === 0) return deny(401, "Unauthorized", cors);

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return deny(401, "Unauthorized", cors);
  const jwt = auth.slice(7).trim();
  const { data: u, error } = await admin.auth.getUser(jwt);
  if (error || !u?.user) return deny(401, "Unauthorized", cors);

  const { data: rows } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  const userRoles = (rows ?? []).map((r: { role: AppRole }) => r.role);
  if (!userRoles.some((r) => roles.includes(r))) return deny(403, "Forbidden", cors);
  return { ok: true, internal: false, userId: u.user.id, roles: userRoles, admin };
}

/** Branches a signed-in caller may act on. Owners/admins: all (null). */
export async function callerBranchIds(c: CallerResult): Promise<string[] | null> {
  if (c.internal || c.roles.includes("owner") || c.roles.includes("admin")) return null;
  const ids = new Set<string>();
  const { data: bm } = await c.admin.from("branch_managers").select("branch_id").eq("user_id", c.userId!);
  (bm ?? []).forEach((r: { branch_id: string }) => ids.add(r.branch_id));
  const { data: sb } = await c.admin.from("staff_branches").select("branch_id").eq("user_id", c.userId!);
  (sb ?? []).forEach((r: { branch_id: string }) => ids.add(r.branch_id));
  return [...ids];
}

export async function canActOnBranch(c: CallerResult, branchId: string | null | undefined): Promise<boolean> {
  const ids = await callerBranchIds(c);
  if (ids === null) return true;
  return !!branchId && ids.includes(branchId);
}

/** Mask a phone number for logs: keep last 4 digits. */
export function maskPhone(p: unknown): string {
  const s = String(p ?? "");
  return s.length <= 4 ? "****" : `***${s.slice(-4)}`;
}
