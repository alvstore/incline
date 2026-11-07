// v2.0.0 — Primary database access for the DR mirror (direct connection, read-only data).
import postgres from "npm:postgres@3.4.4";

export type Sql = ReturnType<typeof postgres>;

/** Same deparse/output settings the standby helpers pin, so hashes and DDL text match. */
const SESSION =
  "SELECT set_config('search_path', 'pg_catalog, pg_temp', true), set_config('TimeZone', 'UTC', true), " +
  "set_config('DateStyle', 'ISO, MDY', true), set_config('IntervalStyle', 'postgres', true), " +
  "set_config('extra_float_digits', '1', true), set_config('bytea_output', 'hex', true), " +
  "set_config('statement_timeout', '110s', true)";

export function connectPrimary(): Sql {
  const url = Deno.env.get("SUPABASE_DB_URL");
  if (!url) throw new Error("SUPABASE_DB_URL not available");
  return postgres(url, { max: 2, prepare: false, idle_timeout: 20, connect_timeout: 15 });
}

/**
 * Run a read-only query against the primary with the pinned session settings,
 * returning the first column of the first row as text (null when no row/value).
 * Multi-statement via simple protocol so SESSION applies to the same connection.
 */
export async function readOne(sql: Sql, query: string): Promise<string | null> {
  const results = await sql.unsafe(SESSION + "; " + query, [], { prepare: false }).simple();
  const last = Array.isArray(results) ? results[results.length - 1] : results;
  const row = Array.isArray(last) ? last[0] : last;
  if (!row || typeof row !== "object") return null;
  const value = Object.values(row as Record<string, unknown>)[0];
  return value == null ? null : String(value);
}

/** readOne + JSON.parse — for queries that return a single json/jsonb text payload. */
export async function readJson<T>(sql: Sql, query: string): Promise<T> {
  const text = await readOne(sql, query);
  return (text ? JSON.parse(text) : null) as T;
}

