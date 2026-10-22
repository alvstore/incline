// v2.0.0 — Rules of the 1:1 standby copy.
import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { aclStatements, loadModeDrops, planSchema, type Snapshot } from "./catalog.ts";
import { planJobs } from "./jobs.ts";
import { chunkRowCount, rangeHashSql, type TableSpec } from "./rows.ts";
import { rangePredicate } from "./sqlText.ts";
import { metaFixSql, type Obj, planObjects } from "./storage.ts";

const empty = (): Snapshot => ({
  roles: ["anon", "authenticated", "service_role", "postgres", "sandbox_exec"],
  schemas: [{ name: "public", owner: "pg_database_owner", acl: [] }],
  enums: [], sequences: [], tables: [], constraints: [], indexes: [], functions: [], views: [],
  triggers: [], policies: [], publication: [],
});

const col = (name: string, type = "text", extra: Partial<Snapshot["tables"][0]["columns"][0]> = {}) => ({
  name, type, notnull: false, default: null, generated: null, identity: "", collation: null, comment: null, acl: [], ...extra,
});

const table = (name: string, columns = [col("id", "uuid", { notnull: true })]) => ({
  schema: "public", name, kind: "r", rls: true, force: false, owner: "postgres", comment: null, acl: [], columns,
});

Deno.test("key ranges cover the whole key space (first open below, last open above)", () => {
  const pk = [{ name: "id", type: "uuid", collatable: false }];
  assertEquals(rangePredicate(pk, null, null), "true");
  assertEquals(rangePredicate(pk, null, ["b"]), `("id") <= ('b'::uuid)`);
  assertEquals(rangePredicate(pk, ["a"], null), `("id") > ('a'::uuid)`);
  const text = [{ name: "code", type: "text", collatable: true }, { name: "n", type: "integer", collatable: false }];
  assertEquals(
    rangePredicate(text, ["x'y", "1"], ["z", "2"]),
    `("code" COLLATE "C", "n") > ('x''y'::text COLLATE "C", '1'::integer) AND ("code" COLLATE "C", "n") <= ('z'::text COLLATE "C", '2'::integer)`,
  );
});

Deno.test("chunk size stays between 20 and 5000 rows", () => {
  assertEquals(chunkRowCount(0, 0), 1000);
  assertEquals(chunkRowCount(131_000_000, 5658), 38);
  assertEquals(chunkRowCount(1_000, 10), 5000);
  assertEquals(chunkRowCount(500_000_000, 100), 20);
});

Deno.test("tables without a primary key are fingerprinted as a whole", () => {
  const spec: TableSpec = { schema: "public", name: "counters", cols: ["k", "v"], pk: [], bytes: 0, tuples: 0 };
  const q = rangeHashSql(spec, null, null);
  assert(q.includes("ORDER BY x.h"));
  assert(!q.includes("WHERE"));
});

Deno.test("missing standby table is created and standby-only table is dropped", () => {
  const p = empty();
  p.tables = [table("members")];
  const s = empty();
  s.tables = [table("old_scratch")];
  const keys = planSchema(p, s).map((x) => x.key);
  assert(keys.includes("table:public.members"));
  assert(keys.includes("drop-table:public.old_scratch"));
  assert(keys.includes("rls:public.members")); // security rules switched on for the new table
});

Deno.test("foreign keys are added NOT VALID and validated only in the final pass", () => {
  const p = empty();
  p.tables = [table("members"), table("memberships")];
  p.constraints = [{ schema: "public", table: "memberships", name: "memberships_member_id_fkey", type: "f", def: "FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE", validated: true }];
  const s = empty();
  s.tables = [table("members"), table("memberships")];
  const first = planSchema(p, s);
  const add = first.find((x) => x.key.startsWith("constraint:"))!;
  assert(add.sql[0].endsWith("ON DELETE CASCADE NOT VALID"));
  assertEquals(first.some((x) => x.key.startsWith("validate:")), false);
  const final = planSchema(p, s, { includeDeferred: true });
  assert(final.some((x) => x.key === "validate:public.memberships.memberships_member_id_fkey"));
  // Same FK already present but NOT VALID on the standby → only validation remains.
  s.constraints = [{ ...p.constraints[0], def: `${p.constraints[0].def} NOT VALID`, validated: false }];
  const again = planSchema(p, s, { includeDeferred: true }).map((x) => x.key);
  assertEquals(again, ["validate:public.memberships.memberships_member_id_fkey"]);
});

Deno.test("changed security rule is replaced; standby-only rule is dropped", () => {
  const p = empty();
  p.tables = [table("invoices")];
  const s = empty();
  s.tables = [table("invoices")];
  const base = { schema: "public", table: "invoices", permissive: true, cmd: "r", roles: ["authenticated"], check: null };
  p.policies = [{ ...base, name: "Staff read", qual: "public.is_staff(auth.uid())" }];
  s.policies = [{ ...base, name: "Staff read", qual: "true" }, { ...base, name: "Legacy open", qual: "true" }];
  const plan = planSchema(p, s);
  const rule = plan.find((x) => x.key === "policy:public.invoices.Staff read")!;
  assertEquals(rule.sql[0], `DROP POLICY IF EXISTS "Staff read" ON "public"."invoices"`);
  assert(rule.sql[1].includes("USING (public.is_staff(auth.uid()))"));
  assert(plan.some((x) => x.key === "drop-policy:public.invoices.Legacy open"));
});

Deno.test("grants are mirrored for app roles only (platform roles ignored)", () => {
  const roles = new Set(["anon", "authenticated", "service_role", "sandbox_exec"]);
  const out = aclStatements(
    `TABLE "public"."members"`,
    [{ grantee: "authenticated", priv: "SELECT", grantable: false }, { grantee: "sandbox_exec", priv: "SELECT", grantable: false }],
    [{ grantee: "anon", priv: "SELECT", grantable: false }],
    "postgres", "postgres", roles,
  );
  assertEquals(out, [
    `REVOKE SELECT ON TABLE "public"."members" FROM "anon"`,
    `GRANT SELECT ON TABLE "public"."members" TO "authenticated"`,
  ]);
});

Deno.test("views missing security_invoker on the standby are recreated with it", () => {
  const p = empty();
  const v = { schema: "public", name: "crm_messages", kind: "v", def: " SELECT 1 AS x;", owner: "postgres", comment: null, acl: [] };
  p.views = [{ ...v, options: ["security_invoker=true"] }];
  const s = empty();
  s.views = [{ ...v, options: null }];
  const step = planSchema(p, s).find((x) => x.key === "view:public.crm_messages")!;
  assertEquals(step.sql[0], `CREATE OR REPLACE VIEW "public"."crm_messages" WITH (security_invoker=true) AS SELECT 1 AS x`);
});

Deno.test("standby helper functions are never dropped; other standby-only functions are", () => {
  const s = empty();
  const f = { schema: "public", args: "", kind: "f", def: "x", owner: "postgres", comment: null, acl: [] };
  s.functions = [{ ...f, name: "dr_mirror_run" }, { ...f, name: "old_helper" }];
  const keys = planSchema(empty(), s).map((x) => x.key);
  assertEquals(keys.filter((k) => k.startsWith("drop-fn:")), ["drop-fn:public.old_helper()"]);
});

Deno.test("new enum values keep their position", () => {
  const p = empty();
  p.enums = [{ schema: "public", name: "app_role", labels: ["owner", "admin", "manager", "member"] }];
  const s = empty();
  s.enums = [{ schema: "public", name: "app_role", labels: ["owner", "admin", "member"] }];
  const step = planSchema(p, s)[0];
  assertEquals(step.sql[0], `ALTER TYPE "public"."app_role" ADD VALUE IF NOT EXISTS 'manager' AFTER 'admin'`);
  assert(step.solo);
});

Deno.test("load mode drops every FK and only NOT VALID checks", () => {
  const p = empty();
  p.constraints = [
    { schema: "public", table: "a", name: "a_fk", type: "f", def: "FOREIGN KEY (b) REFERENCES public.b(id)", validated: true },
    { schema: "public", table: "a", name: "a_legacy_check", type: "c", def: "CHECK (x > 0) NOT VALID", validated: false },
    { schema: "public", table: "a", name: "a_ok_check", type: "c", def: "CHECK (y > 0)", validated: true },
  ];
  const drops = loadModeDrops(p, p);
  assertEquals(drops.length, 2);
  assert(drops.every((d) => !d.includes("a_ok_check")));
});

const obj = (n: string, s: number, e: string | null, extra: Partial<Obj> = {}): Obj => ({
  b: "avatars", n, s, e, m: "image/jpeg", c: "max-age=3600", o: null, oi: null, um: null, ca: "2026-03-15T08:45:31.789357+00:00", ...extra,
});

Deno.test("files: copy missing/changed, delete standby-only, align owner metadata", () => {
  const p = [obj("a.jpg", 10, '"aa"'), obj("b.jpg", 20, '"bb"'), obj("c.jpg", 30, '"cc"', { o: "u1", oi: "u1" }), obj("big.sql", 99, '"x-3"')];
  const s = [obj("a.jpg", 10, '"aa"'), obj("b.jpg", 20, '"zz"'), obj("c.jpg", 30, '"cc"'), obj("big.sql", 99, '"y-2"'), obj("gone.jpg", 5, '"gg"')];
  const plan = planObjects(p, s);
  assertEquals(plan.copy.map((o) => o.n), ["b.jpg"]); // multipart eTags compare by size
  assertEquals(plan.remove.map((o) => o.n), ["gone.jpg"]);
  assertEquals(plan.fixMeta.map((o) => o.n), ["c.jpg"]);
  assertEquals(plan.same, 2);
  const missing = planObjects([obj("new.jpg", 1, null)], []);
  assertEquals(missing.copy.length, 1);
  assert(metaFixSql(p[2]).includes(`owner = 'u1'::uuid`));
});

Deno.test("scheduled jobs: mirror changed/missing definitions, remove standby-only ones", () => {
  const p = [
    { id: 1, name: "auto-close-attendance", schedule: "7-52/15 * * * *", command: "SELECT 1", active: true },
    { id: 2, name: "dr-sync-tick", schedule: "*/2 * * * *", command: "SELECT 2", active: true },
  ];
  const s = [
    { id: 9, name: "auto-close-attendance", schedule: "*/15 * * * *", command: "SELECT 1", active: false },
    { id: 10, name: "dr-replicate-rows", schedule: "20 21 * * *", command: "SELECT 3", active: true },
  ];
  const plan = planJobs(p, s);
  assertEquals(plan.schedule.length, 2);
  assertEquals(plan.unschedule, ["SELECT cron.unschedule(10)::text"]);
});
