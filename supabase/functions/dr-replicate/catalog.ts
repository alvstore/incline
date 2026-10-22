// v2.0.0 — Catalog snapshot + 1:1 structure planner for the DR standby.
//
// The SAME snapshot query runs on the primary and on the standby (both PostgreSQL 17,
// deparsed with search_path = pg_catalog so every name is schema-qualified), and
// planSchema() turns the difference into ordered DDL that makes the standby identical:
// schemas, enums, sequences, functions, tables/columns, constraints, indexes, views,
// triggers, RLS flags, policies, grants (table/column/function/schema), realtime
// publication membership and comments. Objects that exist only on the standby are
// dropped. Pure module — no I/O — so the rules are unit-tested.

import { lit, qi, qn, textArray } from "./sqlText.ts";

export interface Acl { grantee: string; priv: string; grantable: boolean }
export interface Column {
  name: string; type: string; notnull: boolean; default: string | null; generated: string | null;
  identity: string; collation: string | null; comment: string | null; acl: Acl[];
}
export interface Table {
  schema: string; name: string; kind: string; rls: boolean; force: boolean; owner: string;
  comment: string | null; acl: Acl[]; columns: Column[];
}
export interface EnumType { schema: string; name: string; labels: string[] }
export interface Sequence {
  schema: string; name: string; type: string; start: string; inc: string; min: string; max: string;
  cache: string; cycle: boolean; identity: boolean; ownedBy: [string, string] | null; owner: string; acl: Acl[];
}
export interface Constraint { schema: string; table: string; name: string; type: string; def: string; validated: boolean }
export interface Index { schema: string; table: string; name: string; def: string }
export interface Func {
  schema: string; name: string; args: string; kind: string; def: string; owner: string;
  comment: string | null; acl: Acl[];
}
export interface View {
  schema: string; name: string; kind: string; def: string; options: string[] | null; owner: string;
  comment: string | null; acl: Acl[];
}
export interface Trigger { schema: string; table: string; name: string; def: string; enabled: string }
export interface Policy {
  schema: string; table: string; name: string; permissive: boolean; cmd: string; roles: string[];
  qual: string | null; check: string | null;
}
export interface SchemaInfo { name: string; owner: string; acl: Acl[] }
export interface Snapshot {
  roles: string[];
  schemas: SchemaInfo[];
  enums: EnumType[];
  sequences: Sequence[];
  tables: Table[];
  constraints: Constraint[];
  indexes: Index[];
  functions: Func[];
  views: View[];
  triggers: Trigger[];
  policies: Policy[];
  publication: string[];
}

/** App schemas mirrored object-for-object. */
export const MIRROR_SCHEMAS = ["public", "private"];
/** Platform schemas where only app-owned policies and triggers are mirrored. */
export const POLICY_SCHEMAS = ["storage", "realtime", "auth"];
/** Standby-only helper functions (installed by bootstrap, never mirrored or dropped). */
export const STANDBY_HELPER_PREFIX = "dr_mirror_";

const aclJson = (expr: string) =>
  `(SELECT coalesce(json_agg(json_build_object('grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, 'priv', a.privilege_type, 'grantable', a.is_grantable) ORDER BY a.grantee, a.privilege_type, a.is_grantable), '[]'::json) FROM aclexplode(${expr}) a)`;

/** Snapshot query. Must run with search_path = pg_catalog on both sides. */
export function snapshotSql(schemas = MIRROR_SCHEMAS, policySchemas = POLICY_SCHEMAS): string {
  const sch = textArray(schemas);
  const pol = textArray([...schemas, ...policySchemas]);
  return `
WITH sch AS (SELECT oid, nspname FROM pg_namespace WHERE nspname = ANY(${sch})),
polsch AS (SELECT oid, nspname FROM pg_namespace WHERE nspname = ANY(${pol})),
ext AS (SELECT objid FROM pg_depend WHERE deptype = 'e'),
rels AS (
  SELECT c.oid, n.nspname, c.relname, c.relkind, c.relowner, c.relacl, c.relrowsecurity, c.relforcerowsecurity, c.reloptions
  FROM pg_class c JOIN sch n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r','p','v','m','S') AND c.oid NOT IN (SELECT objid FROM ext)
)
SELECT json_build_object(
  'roles', (SELECT json_agg(rolname ORDER BY rolname) FROM pg_roles),
  'schemas', (SELECT coalesce(json_agg(json_build_object('name', n.nspname, 'owner', pg_get_userbyid(n.nspowner),
      'acl', ${aclJson("coalesce(n.nspacl, acldefault('n', n.nspowner))")}) ORDER BY n.nspname), '[]'::json)
    FROM pg_namespace n WHERE n.oid IN (SELECT oid FROM sch)),
  'enums', (SELECT coalesce(json_agg(json_build_object('schema', n.nspname, 'name', t.typname,
      'labels', (SELECT json_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = t.oid))
      ORDER BY n.nspname, t.typname), '[]'::json)
    FROM pg_type t JOIN sch n ON n.oid = t.typnamespace WHERE t.typtype = 'e' AND t.oid NOT IN (SELECT objid FROM ext)),
  'sequences', (SELECT coalesce(json_agg(json_build_object('schema', r.nspname, 'name', r.relname,
      'type', format_type(s.seqtypid, NULL), 'start', s.seqstart::text, 'inc', s.seqincrement::text,
      'min', s.seqmin::text, 'max', s.seqmax::text, 'cache', s.seqcache::text, 'cycle', s.seqcycle,
      'identity', EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = r.oid AND d.deptype = 'i'),
      'ownedBy', (SELECT json_build_array(tc.relname, a.attname) FROM pg_depend d
                   JOIN pg_class tc ON tc.oid = d.refobjid
                   JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
                  WHERE d.classid = 'pg_class'::regclass AND d.objid = r.oid AND d.refclassid = 'pg_class'::regclass AND d.deptype = 'a' LIMIT 1),
      'owner', pg_get_userbyid(r.relowner),
      'acl', ${aclJson("coalesce(r.relacl, acldefault('s', r.relowner))")}) ORDER BY r.nspname, r.relname), '[]'::json)
    FROM rels r JOIN pg_sequence s ON s.seqrelid = r.oid WHERE r.relkind = 'S'),
  'tables', (SELECT coalesce(json_agg(json_build_object('schema', r.nspname, 'name', r.relname, 'kind', r.relkind::text,
      'rls', r.relrowsecurity, 'force', r.relforcerowsecurity, 'owner', pg_get_userbyid(r.relowner),
      'comment', obj_description(r.oid, 'pg_class'),
      'acl', ${aclJson("coalesce(r.relacl, acldefault('r', r.relowner))")},
      'columns', (SELECT coalesce(json_agg(json_build_object(
          'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'notnull', a.attnotnull,
          'default', CASE WHEN a.attgenerated = '' THEN pg_get_expr(ad.adbin, ad.adrelid) END,
          'generated', CASE WHEN a.attgenerated <> '' THEN pg_get_expr(ad.adbin, ad.adrelid) END,
          'identity', a.attidentity::text,
          'collation', CASE WHEN a.attcollation <> 0 AND a.attcollation <> t.typcollation THEN quote_ident(cn.nspname) || '.' || quote_ident(co.collname) END,
          'comment', col_description(r.oid, a.attnum),
          'acl', CASE WHEN a.attacl IS NULL THEN '[]'::json ELSE ${aclJson("a.attacl")} END
        ) ORDER BY a.attnum), '[]'::json)
        FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
        LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
        LEFT JOIN pg_collation co ON co.oid = a.attcollation
        LEFT JOIN pg_namespace cn ON cn.oid = co.collnamespace
        WHERE a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped)
    ) ORDER BY r.nspname, r.relname), '[]'::json) FROM rels r WHERE r.relkind IN ('r','p')),
  'constraints', (SELECT coalesce(json_agg(json_build_object('schema', r.nspname, 'table', r.relname, 'name', k.conname,
      'type', k.contype::text, 'def', pg_get_constraintdef(k.oid), 'validated', k.convalidated)
      ORDER BY r.nspname, r.relname, k.conname), '[]'::json)
    FROM pg_constraint k JOIN rels r ON r.oid = k.conrelid WHERE k.contype IN ('p','u','f','c','x')),
  'indexes', (SELECT coalesce(json_agg(json_build_object('schema', r.nspname, 'table', r.relname, 'name', ic.relname,
      'def', pg_get_indexdef(i.indexrelid)) ORDER BY r.nspname, ic.relname), '[]'::json)
    FROM pg_index i JOIN rels r ON r.oid = i.indrelid JOIN pg_class ic ON ic.oid = i.indexrelid
    WHERE NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.indexrelid AND k.conrelid = i.indrelid AND k.contype IN ('p','u','x'))),
  'functions', (SELECT coalesce(json_agg(json_build_object('schema', n.nspname, 'name', p.proname,
      'args', pg_get_function_identity_arguments(p.oid), 'kind', p.prokind::text, 'def', pg_get_functiondef(p.oid),
      'owner', pg_get_userbyid(p.proowner), 'comment', obj_description(p.oid, 'pg_proc'),
      'acl', ${aclJson("coalesce(p.proacl, acldefault('f', p.proowner))")})
      ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::json)
    FROM pg_proc p JOIN sch n ON n.oid = p.pronamespace
    WHERE p.prokind IN ('f','p') AND p.oid NOT IN (SELECT objid FROM ext)),
  'views', (SELECT coalesce(json_agg(json_build_object('schema', r.nspname, 'name', r.relname, 'kind', r.relkind::text,
      'def', pg_get_viewdef(r.oid), 'options', r.reloptions, 'owner', pg_get_userbyid(r.relowner),
      'comment', obj_description(r.oid, 'pg_class'),
      'acl', ${aclJson("coalesce(r.relacl, acldefault('r', r.relowner))")}) ORDER BY r.nspname, r.relname), '[]'::json)
    FROM rels r WHERE r.relkind IN ('v','m')),
  'triggers', (SELECT coalesce(json_agg(json_build_object('schema', n.nspname, 'table', c.relname, 'name', tg.tgname,
      'def', pg_get_triggerdef(tg.oid), 'enabled', tg.tgenabled::text) ORDER BY n.nspname, c.relname, tg.tgname), '[]'::json)
    FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid JOIN polsch n ON n.oid = c.relnamespace
    WHERE NOT tg.tgisinternal AND tg.oid NOT IN (SELECT objid FROM ext)
      AND (n.nspname = ANY(${sch}) OR EXISTS (SELECT 1 FROM pg_proc fp JOIN pg_namespace fn ON fn.oid = fp.pronamespace
            WHERE fp.oid = tg.tgfoid AND fn.nspname = ANY(${sch})))),
  'policies', (SELECT coalesce(json_agg(json_build_object('schema', n.nspname, 'table', c.relname, 'name', pol.polname,
      'permissive', pol.polpermissive, 'cmd', pol.polcmd::text,
      'roles', (SELECT coalesce(json_agg(x.rn ORDER BY x.rn), '[]'::json) FROM (SELECT CASE WHEN ro = 0 THEN 'public' ELSE pg_get_userbyid(ro) END AS rn FROM unnest(pol.polroles) ro) x),
      'qual', pg_get_expr(pol.polqual, pol.polrelid), 'check', pg_get_expr(pol.polwithcheck, pol.polrelid))
      ORDER BY n.nspname, c.relname, pol.polname), '[]'::json)
    FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid JOIN polsch n ON n.oid = c.relnamespace),
  'publication', (SELECT coalesce(json_agg(pt.schemaname || '.' || pt.tablename ORDER BY pt.schemaname, pt.tablename), '[]'::json)
    FROM pg_publication_tables pt WHERE pt.pubname = 'supabase_realtime' AND pt.schemaname = ANY(${sch}))
)::text`;
}

// ── Planner ──────────────────────────────────────────────────────────────────

export interface PlanStep {
  phase: number;
  /** Stable identity used in reports and progress detection. */
  key: string;
  /** Statements executed together in one transaction. */
  sql: string[];
  /** Tried when `sql` fails (e.g. function return type changed → drop + create). */
  fallback?: string[];
  /** Must run alone (enum value additions cannot share a transaction with users of the value). */
  solo?: boolean;
  /** Only applied in the final pass, after rows are loaded (FK validation). */
  deferred?: boolean;
}

/**
 * Grants are compared for the application roles only. Platform roles (supabase_*,
 * pg_*, dashboard/sandbox/pooler roles) differ per installation and carry no app access.
 */
export const APP_GRANTEES = new Set(["PUBLIC", "anon", "authenticated", "service_role"]);

const stripSemi = (s: string) => s.trim().replace(/;+\s*$/, "");
const fkNorm = (def: string) => def.replace(/\s+NOT VALID$/, "");
const tableKey = (s: string, n: string) => `${s}.${n}`;
const fnObj = (f: { schema: string; name: string; args: string; kind: string }) =>
  `${f.kind === "p" ? "PROCEDURE" : "FUNCTION"} ${qn(f.schema, f.name)}(${f.args})`;
const roleRef = (r: string) => (r === "PUBLIC" || r === "public" ? "PUBLIC" : qi(r));

export function columnDef(c: Column): string {
  let s = `${qi(c.name)} ${c.type}`;
  if (c.collation) s += ` COLLATE ${c.collation}`;
  if (c.generated) s += ` GENERATED ALWAYS AS (${c.generated}) STORED`;
  else if (c.default != null) s += ` DEFAULT ${c.default}`;
  if (c.identity === "a") s += " GENERATED ALWAYS AS IDENTITY";
  else if (c.identity === "d") s += " GENERATED BY DEFAULT AS IDENTITY";
  if (c.notnull) s += " NOT NULL";
  return s;
}

/** GRANT/REVOKE statements turning standby ACL into primary ACL for one object. */
export function aclStatements(
  objSql: string,
  primaryAcl: Acl[],
  standbyAcl: Acl[],
  primaryOwner: string,
  standbyOwner: string,
  roles: Set<string>,
  column?: string,
): string[] {
  const keep = (owner: string) => (a: Acl) =>
    a.grantee !== owner && APP_GRANTEES.has(a.grantee) && (a.grantee === "PUBLIC" || roles.has(a.grantee));
  const key = (a: Acl) => `${a.grantee}|${a.priv}|${a.grantable ? 1 : 0}`;
  const p = new Map(primaryAcl.filter(keep(primaryOwner)).map((a) => [key(a), a]));
  const s = new Map(standbyAcl.filter(keep(standbyOwner)).map((a) => [key(a), a]));
  const col = column ? ` (${qi(column)})` : "";
  const out: string[] = [];
  for (const [k, a] of s) if (!p.has(k)) out.push(`REVOKE ${a.priv}${col} ON ${objSql} FROM ${roleRef(a.grantee)}`);
  for (const [k, a] of p) {
    if (!s.has(k)) out.push(`GRANT ${a.priv}${col} ON ${objSql} TO ${roleRef(a.grantee)}${a.grantable ? " WITH GRANT OPTION" : ""}`);
  }
  return out;
}

export function policySql(p: Policy, roles: Set<string>): string | null {
  const targets = p.roles.filter((r) => r === "public" || roles.has(r));
  if (!targets.length) return null;
  const cmd = ({ r: "SELECT", a: "INSERT", w: "UPDATE", d: "DELETE", "*": "ALL" } as Record<string, string>)[p.cmd] ?? "ALL";
  let s = `CREATE POLICY ${qi(p.name)} ON ${qn(p.schema, p.table)} AS ${p.permissive ? "PERMISSIVE" : "RESTRICTIVE"} FOR ${cmd} TO ${targets.map((r) => (r === "public" ? "public" : qi(r))).join(", ")}`;
  if (p.qual != null) s += ` USING (${p.qual})`;
  if (p.check != null) s += ` WITH CHECK (${p.check})`;
  return s;
}

const policyCanon = (p: Policy) => JSON.stringify([p.permissive, p.cmd, [...p.roles].sort(), p.qual, p.check]);
const commentSql = (obj: string, text: string | null) => `COMMENT ON ${obj} IS ${text == null ? "NULL" : lit(text)}`;

function viewCreate(v: View, replace: boolean): string {
  const opts = v.options?.length ? ` WITH (${v.options.join(", ")})` : "";
  if (v.kind === "m") return `CREATE MATERIALIZED VIEW ${qn(v.schema, v.name)}${opts} AS ${stripSemi(v.def)} WITH NO DATA`;
  return `CREATE ${replace ? "OR REPLACE " : ""}VIEW ${qn(v.schema, v.name)}${opts} AS ${stripSemi(v.def)}`;
}

function sequenceCreate(s: Sequence): string {
  return `CREATE SEQUENCE IF NOT EXISTS ${qn(s.schema, s.name)} AS ${s.type} INCREMENT BY ${s.inc} MINVALUE ${s.min} MAXVALUE ${s.max} START WITH ${s.start} CACHE ${s.cache}${s.cycle ? " CYCLE" : " NO CYCLE"}`;
}

export interface PlanOptions {
  /** Include deferred steps (FK validation) — final pass only. */
  includeDeferred?: boolean;
}

export function planSchema(p: Snapshot, s: Snapshot, opts: PlanOptions = {}): PlanStep[] {
  const steps: PlanStep[] = [];
  const add = (st: PlanStep) => {
    if (st.deferred && !opts.includeDeferred) return;
    steps.push(st);
  };
  const roles = new Set(p.roles.filter((r) => s.roles.includes(r)));

  // 10 — schemas (+ schema grants at phase 95)
  const sSchemas = new Map(s.schemas.map((x) => [x.name, x]));
  for (const sc of p.schemas) {
    const cur = sSchemas.get(sc.name);
    if (!cur) add({ phase: 10, key: `schema:${sc.name}`, sql: [`CREATE SCHEMA IF NOT EXISTS ${qi(sc.name)}`] });
    const acl = aclStatements(`SCHEMA ${qi(sc.name)}`, sc.acl, cur?.acl ?? [], sc.owner, cur?.owner ?? "postgres", roles);
    if (acl.length) add({ phase: 95, key: `acl:schema:${sc.name}`, sql: acl });
  }

  // 20 — enums
  const sEnums = new Map(s.enums.map((e) => [tableKey(e.schema, e.name), e]));
  for (const e of p.enums) {
    const cur = sEnums.get(tableKey(e.schema, e.name));
    if (!cur) {
      add({ phase: 20, key: `enum:${e.schema}.${e.name}`, sql: [`CREATE TYPE ${qn(e.schema, e.name)} AS ENUM (${e.labels.map(lit).join(", ")})`] });
      continue;
    }
    const have = new Set(cur.labels);
    e.labels.forEach((label, i) => {
      if (have.has(label)) return;
      const pos = i > 0 ? ` AFTER ${lit(e.labels[i - 1])}` : cur.labels.length ? ` BEFORE ${lit(cur.labels[0])}` : "";
      add({ phase: 20, solo: true, key: `enum:${e.schema}.${e.name}:${label}`, sql: [`ALTER TYPE ${qn(e.schema, e.name)} ADD VALUE IF NOT EXISTS ${lit(label)}${pos}`] });
      have.add(label);
    });
  }
  const pEnumKeys = new Set(p.enums.map((e) => tableKey(e.schema, e.name)));
  for (const e of s.enums) {
    if (!pEnumKeys.has(tableKey(e.schema, e.name))) add({ phase: 99, key: `drop-enum:${e.schema}.${e.name}`, sql: [`DROP TYPE IF EXISTS ${qn(e.schema, e.name)} CASCADE`] });
  }

  // 30 — sequences (identity sequences come with their column)
  const sSeq = new Map(s.sequences.map((q) => [tableKey(q.schema, q.name), q]));
  for (const q of p.sequences) {
    const cur = sSeq.get(tableKey(q.schema, q.name));
    if (!q.identity) {
      if (!cur) add({ phase: 30, key: `seq:${q.schema}.${q.name}`, sql: [sequenceCreate(q)] });
      else if (cur.type !== q.type || cur.inc !== q.inc || cur.min !== q.min || cur.max !== q.max || cur.cache !== q.cache || cur.cycle !== q.cycle) {
        add({ phase: 30, key: `seq:${q.schema}.${q.name}:params`, sql: [`ALTER SEQUENCE ${qn(q.schema, q.name)} AS ${q.type} INCREMENT BY ${q.inc} MINVALUE ${q.min} MAXVALUE ${q.max} CACHE ${q.cache}${q.cycle ? " CYCLE" : " NO CYCLE"}`] });
      }
      const ownedCur = cur?.ownedBy ? cur.ownedBy.join(".") : null;
      const ownedP = q.ownedBy ? q.ownedBy.join(".") : null;
      if (ownedP !== ownedCur) {
        add({ phase: 56, key: `seq-owner:${q.schema}.${q.name}`, sql: [`ALTER SEQUENCE ${qn(q.schema, q.name)} OWNED BY ${q.ownedBy ? `${qn(q.schema, q.ownedBy[0])}.${qi(q.ownedBy[1])}` : "NONE"}`] });
      }
    }
    const acl = aclStatements(`SEQUENCE ${qn(q.schema, q.name)}`, q.acl, cur?.acl ?? [], q.owner, cur?.owner ?? "postgres", roles);
    if (acl.length) add({ phase: 95, key: `acl:seq:${q.schema}.${q.name}`, sql: acl });
  }
  const pSeqKeys = new Set(p.sequences.map((q) => tableKey(q.schema, q.name)));
  for (const q of s.sequences) {
    if (!q.identity && !pSeqKeys.has(tableKey(q.schema, q.name))) add({ phase: 99, key: `drop-seq:${q.schema}.${q.name}`, sql: [`DROP SEQUENCE IF EXISTS ${qn(q.schema, q.name)} CASCADE`] });
  }

  // 40 — functions (bodies not validated: check_function_bodies = off on the standby)
  const fnKey = (f: Func) => `${f.schema}.${f.name}(${f.args})`;
  const sFn = new Map(s.functions.map((f) => [fnKey(f), f]));
  for (const f of p.functions) {
    const cur = sFn.get(fnKey(f));
    if (!cur || cur.def !== f.def) {
      add({ phase: 40, key: `fn:${fnKey(f)}`, sql: [f.def], fallback: [`DROP ${fnObj(f)} CASCADE`, f.def] });
    }
    const acl = aclStatements(fnObj(f), f.acl, cur?.acl ?? defaultFnAcl(cur?.owner ?? "postgres"), f.owner, cur?.owner ?? "postgres", roles);
    if (acl.length) add({ phase: 95, key: `acl:fn:${fnKey(f)}`, sql: acl });
    if ((cur?.comment ?? null) !== f.comment) add({ phase: 98, key: `comment:fn:${fnKey(f)}`, sql: [commentSql(fnObj(f), f.comment)] });
  }
  const pFnKeys = new Set(p.functions.map(fnKey));
  for (const f of s.functions) {
    if (f.name.startsWith(STANDBY_HELPER_PREFIX)) continue;
    if (!pFnKeys.has(fnKey(f))) add({ phase: 99, key: `drop-fn:${fnKey(f)}`, sql: [`DROP ${fnObj(f)} CASCADE`] });
  }

  // 50/55/57/58 — tables & columns
  const sTables = new Map(s.tables.map((t) => [tableKey(t.schema, t.name), t]));
  for (const t of p.tables) {
    const tk = tableKey(t.schema, t.name);
    const rel = qn(t.schema, t.name);
    const cur = sTables.get(tk);
    if (!cur) {
      add({ phase: 50, key: `table:${tk}`, sql: [`CREATE TABLE IF NOT EXISTS ${rel} (${t.columns.map(columnDef).join(", ")})`] });
    } else {
      const sCols = new Map(cur.columns.map((c) => [c.name, c]));
      for (const c of t.columns) {
        const sc = sCols.get(c.name);
        const ck = `${tk}.${c.name}`;
        if (!sc) {
          // Add nullable first when there is no default so existing rows don't block it;
          // NOT NULL is applied right after (and retried after rows load if needed).
          const safe = c.notnull && c.default == null && !c.generated && c.identity === "" ? { ...c, notnull: false } : c;
          add({ phase: 55, key: `column:${ck}`, sql: [`ALTER TABLE ${rel} ADD COLUMN ${columnDef(safe)}`] });
          if (safe !== c) add({ phase: 56, key: `notnull:${ck}`, sql: [`ALTER TABLE ${rel} ALTER COLUMN ${qi(c.name)} SET NOT NULL`] });
          continue;
        }
        if ((sc.generated ?? null) !== (c.generated ?? null) || sc.identity !== c.identity) {
          add({ phase: 55, key: `column-rebuild:${ck}`, sql: [`ALTER TABLE ${rel} DROP COLUMN ${qi(c.name)} CASCADE`, `ALTER TABLE ${rel} ADD COLUMN ${columnDef(c)}`] });
          continue;
        }
        if (sc.type !== c.type || (sc.collation ?? null) !== (c.collation ?? null)) {
          const parts = [`ALTER COLUMN ${qi(c.name)} DROP DEFAULT`,
            `ALTER COLUMN ${qi(c.name)} TYPE ${c.type}${c.collation ? ` COLLATE ${c.collation}` : ""} USING ${qi(c.name)}::${c.type}`];
          if (c.default != null) parts.push(`ALTER COLUMN ${qi(c.name)} SET DEFAULT ${c.default}`);
          add({ phase: 55, key: `column-type:${ck}`, sql: [`ALTER TABLE ${rel} ${parts.join(", ")}`] });
        } else if ((sc.default ?? null) !== (c.default ?? null)) {
          add({ phase: 55, key: `default:${ck}`, sql: [`ALTER TABLE ${rel} ALTER COLUMN ${qi(c.name)} ${c.default == null ? "DROP DEFAULT" : `SET DEFAULT ${c.default}`}`] });
        }
        if (sc.notnull !== c.notnull) {
          add({ phase: 56, key: `notnull:${ck}`, sql: [`ALTER TABLE ${rel} ALTER COLUMN ${qi(c.name)} ${c.notnull ? "SET" : "DROP"} NOT NULL`] });
        }
      }
      const pColNames = new Set(t.columns.map((c) => c.name));
      for (const sc of cur.columns) {
        if (!pColNames.has(sc.name)) add({ phase: 57, key: `drop-column:${tk}.${sc.name}`, sql: [`ALTER TABLE ${rel} DROP COLUMN IF EXISTS ${qi(sc.name)} CASCADE`] });
      }
    }
    // RLS flags
    if (t.rls !== (cur?.rls ?? false)) add({ phase: 90, key: `rls:${tk}`, sql: [`ALTER TABLE ${rel} ${t.rls ? "ENABLE" : "DISABLE"} ROW LEVEL SECURITY`] });
    if (t.force !== (cur?.force ?? false)) add({ phase: 90, key: `force-rls:${tk}`, sql: [`ALTER TABLE ${rel} ${t.force ? "FORCE" : "NO FORCE"} ROW LEVEL SECURITY`] });
    // Grants (table + column level)
    const acl = aclStatements(`TABLE ${rel}`, t.acl, cur?.acl ?? [], t.owner, cur?.owner ?? "postgres", roles);
    const sColAcl = new Map((cur?.columns ?? []).map((c) => [c.name, c.acl]));
    for (const c of t.columns) {
      acl.push(...aclStatements(`TABLE ${rel}`, c.acl, sColAcl.get(c.name) ?? [], t.owner, cur?.owner ?? "postgres", roles, c.name));
    }
    if (acl.length) add({ phase: 95, key: `acl:table:${tk}`, sql: acl });
    // Comments
    if ((cur?.comment ?? null) !== t.comment) add({ phase: 98, key: `comment:table:${tk}`, sql: [commentSql(`TABLE ${rel}`, t.comment)] });
    const sColComments = new Map((cur?.columns ?? []).map((c) => [c.name, c.comment]));
    for (const c of t.columns) {
      if ((sColComments.get(c.name) ?? null) !== c.comment) {
        add({ phase: 98, key: `comment:column:${tk}.${c.name}`, sql: [commentSql(`COLUMN ${rel}.${qi(c.name)}`, c.comment)] });
      }
    }
  }
  const pTableKeys = new Set(p.tables.map((t) => tableKey(t.schema, t.name)));
  for (const t of s.tables) {
    if (!pTableKeys.has(tableKey(t.schema, t.name))) add({ phase: 58, key: `drop-table:${t.schema}.${t.name}`, sql: [`DROP TABLE IF EXISTS ${qn(t.schema, t.name)} CASCADE`] });
  }

  // 60/65/66 — constraints (FKs added NOT VALID, validated in the final pass)
  const conKey = (c: Constraint) => `${c.schema}.${c.table}.${c.name}`;
  const sCon = new Map(s.constraints.map((c) => [conKey(c), c]));
  for (const c of p.constraints) {
    const cur = sCon.get(conKey(c));
    const rel = qn(c.schema, c.table);
    const isFk = c.type === "f";
    const same = cur && cur.type === c.type && (isFk ? fkNorm(cur.def) === fkNorm(c.def) : cur.def === c.def);
    if (!same) {
      const def = isFk && !/NOT VALID$/.test(c.def) ? `${c.def} NOT VALID` : c.def;
      const sql = [`ALTER TABLE ${rel} ADD CONSTRAINT ${qi(c.name)} ${def}`];
      if (cur) sql.unshift(`ALTER TABLE ${rel} DROP CONSTRAINT IF EXISTS ${qi(c.name)} CASCADE`);
      add({ phase: isFk ? 65 : 60, key: `constraint:${conKey(c)}`, sql });
      if (isFk && c.validated) add({ phase: 66, deferred: true, key: `validate:${conKey(c)}`, sql: [`ALTER TABLE ${rel} VALIDATE CONSTRAINT ${qi(c.name)}`] });
    } else if (isFk && c.validated && !cur!.validated) {
      add({ phase: 66, deferred: true, key: `validate:${conKey(c)}`, sql: [`ALTER TABLE ${rel} VALIDATE CONSTRAINT ${qi(c.name)}`] });
    }
  }
  const pConKeys = new Set(p.constraints.map(conKey));
  for (const c of s.constraints) {
    if (!pConKeys.has(conKey(c)) && pTableKeys.has(tableKey(c.schema, c.table))) {
      add({ phase: 59, key: `drop-constraint:${conKey(c)}`, sql: [`ALTER TABLE ${qn(c.schema, c.table)} DROP CONSTRAINT IF EXISTS ${qi(c.name)} CASCADE`] });
    }
  }

  // 70 — indexes
  const idxKey = (i: Index) => `${i.schema}.${i.name}`;
  const sIdx = new Map(s.indexes.map((i) => [idxKey(i), i]));
  for (const i of p.indexes) {
    const cur = sIdx.get(idxKey(i));
    if (!cur) add({ phase: 70, key: `index:${idxKey(i)}`, sql: [i.def] });
    else if (cur.def !== i.def) add({ phase: 70, key: `index:${idxKey(i)}`, sql: [`DROP INDEX IF EXISTS ${qn(i.schema, i.name)}`, i.def] });
  }
  const pIdxKeys = new Set(p.indexes.map(idxKey));
  for (const i of s.indexes) {
    if (!pIdxKeys.has(idxKey(i)) && pTableKeys.has(tableKey(i.schema, i.table))) add({ phase: 69, key: `drop-index:${idxKey(i)}`, sql: [`DROP INDEX IF EXISTS ${qn(i.schema, i.name)}`] });
  }

  // 80 — views
  const sViews = new Map(s.views.map((v) => [tableKey(v.schema, v.name), v]));
  for (const v of p.views) {
    const vk = tableKey(v.schema, v.name);
    const cur = sViews.get(vk);
    const relObj = `${v.kind === "m" ? "MATERIALIZED VIEW" : "VIEW"} ${qn(v.schema, v.name)}`;
    const sameOpts = JSON.stringify(cur?.options ?? null) === JSON.stringify(v.options ?? null);
    if (!cur || cur.def !== v.def || !sameOpts || cur.kind !== v.kind) {
      const drop = `DROP ${cur?.kind === "m" ? "MATERIALIZED VIEW" : "VIEW"} IF EXISTS ${qn(v.schema, v.name)} CASCADE`;
      if (v.kind === "m" || (cur && cur.kind !== v.kind)) add({ phase: 80, key: `view:${vk}`, sql: [drop, viewCreate(v, false)] });
      else add({ phase: 80, key: `view:${vk}`, sql: [viewCreate(v, true)], fallback: [drop, viewCreate(v, false)] });
    }
    const acl = aclStatements(`TABLE ${qn(v.schema, v.name)}`, v.acl, cur?.acl ?? [], v.owner, cur?.owner ?? "postgres", roles);
    if (acl.length) add({ phase: 95, key: `acl:view:${vk}`, sql: acl });
    if ((cur?.comment ?? null) !== v.comment) add({ phase: 98, key: `comment:view:${vk}`, sql: [commentSql(relObj, v.comment)] });
  }
  const pViewKeys = new Set(p.views.map((v) => tableKey(v.schema, v.name)));
  for (const v of s.views) {
    if (!pViewKeys.has(tableKey(v.schema, v.name))) add({ phase: 79, key: `drop-view:${v.schema}.${v.name}`, sql: [`DROP ${v.kind === "m" ? "MATERIALIZED VIEW" : "VIEW"} IF EXISTS ${qn(v.schema, v.name)} CASCADE`] });
  }

  // 85 — triggers (definition + enabled state)
  const trgKey = (t: Trigger) => `${t.schema}.${t.table}.${t.name}`;
  const sTrg = new Map(s.triggers.map((t) => [trgKey(t), t]));
  const enableSql = (t: Trigger) => {
    const verb = ({ D: "DISABLE", A: "ENABLE ALWAYS", R: "ENABLE REPLICA", O: "ENABLE" } as Record<string, string>)[t.enabled] ?? "ENABLE";
    return `ALTER TABLE ${qn(t.schema, t.table)} ${verb} TRIGGER ${qi(t.name)}`;
  };
  for (const t of p.triggers) {
    const cur = sTrg.get(trgKey(t));
    const rel = qn(t.schema, t.table);
    if (!cur || cur.def !== t.def) {
      const sql = [`DROP TRIGGER IF EXISTS ${qi(t.name)} ON ${rel}`, t.def];
      if (t.enabled !== "O") sql.push(enableSql(t));
      add({ phase: 85, key: `trigger:${trgKey(t)}`, sql });
    } else if (cur.enabled !== t.enabled) {
      add({ phase: 85, key: `trigger-state:${trgKey(t)}`, sql: [enableSql(t)] });
    }
  }
  const pTrgKeys = new Set(p.triggers.map(trgKey));
  for (const t of s.triggers) {
    if (!pTrgKeys.has(trgKey(t))) add({ phase: 84, key: `drop-trigger:${trgKey(t)}`, sql: [`DROP TRIGGER IF EXISTS ${qi(t.name)} ON ${qn(t.schema, t.table)}`] });
  }

  // 92 — policies
  const polKey = (x: Policy) => `${x.schema}.${x.table}.${x.name}`;
  const sPol = new Map(s.policies.map((x) => [polKey(x), x]));
  for (const x of p.policies) {
    const cur = sPol.get(polKey(x));
    if (cur && policyCanon(cur) === policyCanon(x)) continue;
    const create = policySql(x, roles);
    if (!create) continue;
    const sql = [create];
    if (cur) sql.unshift(`DROP POLICY IF EXISTS ${qi(x.name)} ON ${qn(x.schema, x.table)}`);
    add({ phase: 92, key: `policy:${polKey(x)}`, sql });
  }
  const pPolKeys = new Set(p.policies.map(polKey));
  for (const x of s.policies) {
    if (!pPolKeys.has(polKey(x))) add({ phase: 91, key: `drop-policy:${polKey(x)}`, sql: [`DROP POLICY IF EXISTS ${qi(x.name)} ON ${qn(x.schema, x.table)}`] });
  }

  // 97 — realtime publication membership
  const sPub = new Set(s.publication);
  const pPub = new Set(p.publication);
  const relOf = (k: string) => { const [a, ...b] = k.split("."); return qn(a, b.join(".")); };
  for (const k of pPub) if (!sPub.has(k)) add({ phase: 97, key: `publication:add:${k}`, sql: [`ALTER PUBLICATION supabase_realtime ADD TABLE ${relOf(k)}`] });
  for (const k of sPub) if (!pPub.has(k)) add({ phase: 97, key: `publication:drop:${k}`, sql: [`ALTER PUBLICATION supabase_realtime DROP TABLE ${relOf(k)}`] });

  return steps.sort((a, b) => a.phase - b.phase);
}

/** Default function ACL when the function does not exist yet on the standby. */
function defaultFnAcl(_owner: string): Acl[] {
  // A newly created function gets the database default (EXECUTE to PUBLIC unless
  // default privileges revoke it). Treat "missing" as no grants; the next pass
  // re-reads the real ACL and corrects any leftover PUBLIC grant.
  return [];
}

/** Statements that drop FKs and NOT VALID checks before rows load (re-added by the final pass). */
export function loadModeDrops(p: Snapshot, s: Snapshot): string[] {
  const notValidChecks = new Set(
    p.constraints.filter((c) => c.type === "c" && !c.validated).map((c) => `${c.schema}.${c.table}.${c.name}`),
  );
  return s.constraints
    .filter((c) => c.type === "f" || notValidChecks.has(`${c.schema}.${c.table}.${c.name}`))
    .map((c) => `ALTER TABLE ${qn(c.schema, c.table)} DROP CONSTRAINT IF EXISTS ${qi(c.name)}`);
}

/** Human-friendly summary of remaining differences, grouped by kind. */
export function summarizePlan(steps: PlanStep[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const st of steps) {
    const kind = st.key.split(":")[0];
    out[kind] = (out[kind] ?? 0) + 1;
  }
  return out;
}
