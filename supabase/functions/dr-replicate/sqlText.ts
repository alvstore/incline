// v2.0.0 — SQL text helpers shared by the DR mirror (pure, unit-tested).

/** Quote an identifier. */
export const qi = (s: string): string => `"${s.replace(/"/g, '""')}"`;

/** Quote a schema-qualified relation/function name. */
export const qn = (schema: string, name: string): string => `${qi(schema)}.${qi(name)}`;

/** Quote a string literal (standard_conforming_strings = on on both sides). */
export const lit = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/** text[] literal for embedding constant lists (schema names etc.). */
export const textArray = (items: string[]): string =>
  items.length ? `ARRAY[${items.map(lit).join(", ")}]::text[]` : `ARRAY[]::text[]`;

export interface PkCol {
  name: string;
  /** format_type() output resolved with search_path = pg_catalog (schema-qualified). */
  type: string;
  /** Text-like keys compare with COLLATE "C" on both sides so ranges are identical. */
  collatable: boolean;
}

const keyCol = (c: PkCol) => (c.collatable ? `${qi(c.name)} COLLATE "C"` : qi(c.name));
const keyVal = (c: PkCol, v: string) => `${lit(v)}::${c.type}${c.collatable ? ' COLLATE "C"' : ""}`;

/** ORDER BY list for a primary key. */
export const pkOrder = (pk: PkCol[]): string => pk.map(keyCol).join(", ");

/**
 * Half-open key range (lo, hi] as a SQL predicate. `null` = unbounded on that side,
 * so consecutive chunks always cover the whole key space (rows that exist only on the
 * standby fall into some range and get deleted).
 */
export function rangePredicate(pk: PkCol[], lo: string[] | null, hi: string[] | null): string {
  if (!pk.length) return "true";
  const cols = pk.map(keyCol).join(", ");
  const parts: string[] = [];
  if (lo) parts.push(`(${cols}) > (${pk.map((c, i) => keyVal(c, lo[i])).join(", ")})`);
  if (hi) parts.push(`(${cols}) <= (${pk.map((c, i) => keyVal(c, hi[i])).join(", ")})`);
  return parts.length ? parts.join(" AND ") : "true";
}

/** md5 of one row over an explicit column list (same list + order on both sides). */
export const rowHashExpr = (cols: string[], alias = "t"): string =>
  `md5(row(${cols.map((c) => `${alias}.${qi(c)}`).join(", ")})::text)`;
