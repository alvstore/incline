// CI guard: every SECURITY DEFINER function added or changed in a migration must be
// closed by default — either it carries an in-body authorization check, or the same
// migration revokes EXECUTE from signed-in users (background-only function).
//
// Why: SECURITY DEFINER functions bypass RLS. Default privileges in `public` are
// revoked for anon/authenticated (migration 0018), so a function only becomes
// reachable when a migration explicitly GRANTs it — this script makes sure such a
// grant never ships without a visible permission check inside the function.
//
// Usage:  bunx tsx scripts/check-definer-guards.ts [--since=<migration prefix>]
// Exit 1 on any violation. Checked folders: drizzle/migrations, supabase/migrations.
//
// Escape hatch (must include a reason):  -- guard-exempt: <why this is safe>
// placed anywhere inside the CREATE FUNCTION statement.

import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

const FOLDERS = ["drizzle/migrations", "supabase/migrations"];
// Migrations before this prefix predate the guard framework and were audited by hand
// (phases 1–3 locked or guarded them in the live database via migrations 0010–0016).
const DEFAULT_SINCE = "0011";
// Legacy timestamped folder is frozen at this file; anything newer is checked.
const LEGACY_BASELINE = "20261007145921";

const GUARD_MARKERS = [
  /rpc_guard_applies\s*\(/i,
  /assert_branch_staff\s*\(/i,
  /is_branch_staff\s*\(/i,
  /has_role\s*\(/i,
  /has_any_role\s*\(/i,
  /has_capability\s*\(/i,
  /is_own_member\s*\(/i,
  /can_manage_\w+\s*\(/i,
  /trainer_can_view_member\s*\(/i,
  /manages_branch\s*\(/i,
  /is_staff_or_system\s*\(/i,
  /user_visible_branch_ids\s*\(/i,
  /auth\.uid\s*\(\s*\)/i,
  /public\.forbid\s*\(/i,
  /guard-exempt:\s*\S+/i,
];

interface DefinerFn {
  name: string;
  body: string;
  returnsTrigger: boolean;
}

function sinceArg(): string {
  const arg = process.argv.find((a) => a.startsWith("--since="));
  return arg ? arg.split("=")[1] : DEFAULT_SINCE;
}

function listSqlFiles(folder: string): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join(folder, f));
}

/** Extract every CREATE [OR REPLACE] FUNCTION statement (dollar-quoted bodies). */
function extractFunctions(sql: string): DefinerFn[] {
  const out: DefinerFn[] = [];
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?("?[\w]+"?)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const start = m.index;
    // Find the dollar-quote tag that opens the body after AS
    const asMatch = /\bas\s+(\$[\w]*\$)/i.exec(sql.slice(start));
    if (!asMatch) continue;
    const tag = asMatch[1];
    const bodyStart = start + asMatch.index + asMatch[0].length;
    const bodyEnd = sql.indexOf(tag, bodyStart);
    if (bodyEnd < 0) continue;
    const header = sql.slice(start, bodyStart);
    const body = sql.slice(bodyStart, bodyEnd);
    const stmt = header + body;
    if (!/security\s+definer/i.test(header)) continue;
    out.push({
      name: m[1].replace(/"/g, ""),
      body: stmt,
      returnsTrigger: /returns\s+trigger/i.test(header),
    });
    re.lastIndex = bodyEnd + tag.length;
  }
  return out;
}

function revokedFromUsers(sql: string, name: string): boolean {
  // REVOKE ALL|EXECUTE ON FUNCTION public.<name>(...) FROM ... authenticated|PUBLIC
  const re = new RegExp(
    `revoke\\s+(?:all|execute)[^;]*?on\\s+function\\s+(?:public\\.)?${name}\\s*\\([^;]*?from[^;]*?\\b(authenticated|public)\\b`,
    "i",
  );
  if (re.test(sql)) return true;
  // DO-block style: name listed inside an IN (...) that is followed by a REVOKE ... authenticated
  const listed = new RegExp(`'${name}'`, "i").test(sql);
  const doRevoke = /revoke\s+(?:all|execute)\s+on\s+function\s+%s\s+from[^']*authenticated/i.test(sql);
  return listed && doRevoke;
}

function grantedToAnon(sql: string, name: string): boolean {
  const re = new RegExp(
    `grant\\s+(?:all|execute)[^;]*?on\\s+function\\s+(?:public\\.)?${name}\\s*\\([^;]*?to[^;]*?\\banon\\b`,
    "i",
  );
  return re.test(sql);
}

function main(): void {
  const since = sinceArg();
  const problems: string[] = [];
  let checked = 0;

  for (const folder of FOLDERS) {
    for (const file of listSqlFiles(folder)) {
      const base = file.split("/").pop() ?? file;
      if (folder.startsWith("drizzle") && base.slice(0, 4) < since) continue;
      const sql = readFileSync(file, "utf8");
      for (const fn of extractFunctions(sql)) {
        if (fn.returnsTrigger) continue; // trigger functions are never called by users
        checked += 1;
        const hasGuard = GUARD_MARKERS.some((rx) => rx.test(fn.body));
        const locked = revokedFromUsers(sql, fn.name);
        if (!hasGuard && !locked) {
          problems.push(
            `${file}: SECURITY DEFINER function "${fn.name}" has no permission check and is not revoked from signed-in users. ` +
              `Add rpc_guard_applies()/assert_branch_staff() (or another has_role/branch check), or REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated, ` +
              `or document why it is safe with "-- guard-exempt: <reason>".`,
          );
        }
        if (grantedToAnon(sql, fn.name) && !/public-ok:\s*\S+/i.test(fn.body)) {
          problems.push(
            `${file}: SECURITY DEFINER function "${fn.name}" is granted to anon (visitors). ` +
              `Only genuinely public lookups may be anon-callable; add "-- public-ok: <reason>" inside the function if intended.`,
          );
        }
      }
    }
  }

  if (problems.length) {
    for (const p of problems) console.error(`::error::${p}`);
    console.error(`\nDefiner guard check failed: ${problems.length} problem(s) in ${checked} function(s).`);
    process.exit(1);
  }
  console.log(`Definer guard check passed (${checked} SECURITY DEFINER function(s) since ${since}).`);
}

main();
