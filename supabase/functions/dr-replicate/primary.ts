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

/** Read from the primary inside a READ ONLY transaction (the mirror never writes data here). */
export async function readOne(sql: Sql, text: string, params: unknown[] = []): Promise<string | null> {
  const rows = await sql.begin("read only", async (tx) => {
    await tx.unsafe(SESSION);
    return await tx.unsafe(text, params as never[]);
  });
  const first = rows[0] as Record<string, unknown> | undefined;
  if (!first) return null;
  const v = Object.values(first)[0];
  return v == null ? null : String(v);
}

export async function readJson<T>(sql: Sql, text: string, params: unknown[] = []): Promise<T> {
  const out = await readOne(sql, text, params);
  return JSON.parse(out ?? "null") as T;
}
