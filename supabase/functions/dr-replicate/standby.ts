// v2.0.0 — Standby access over HTTPS only (PostgREST RPC + Storage API).
//
// The standby's Postgres port has no TLS, so member data never travels over it:
// every read/write goes through https://<standby>/rest/v1/rpc/dr_mirror_* with the
// standby service key. The direct DB URL is used only by bootstrap() to (re)install
// those two helper functions (code only, no data).

export class StandbyError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

export interface ReplaceResult { deleted: number; written: number }

export const BOOTSTRAP_SQL = `
CREATE OR REPLACE FUNCTION public.dr_mirror_run(p_stmts text[], p_params text[] DEFAULT NULL, p_replica boolean DEFAULT false)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET "TimeZone" = 'UTC'
SET "DateStyle" = 'ISO, MDY'
SET "IntervalStyle" = 'postgres'
SET extra_float_digits = 1
SET bytea_output = 'hex'
SET check_function_bodies = off
AS $fn$
-- Incline DR helper (standby only): runs statements sent by the primary's dr-replicate
-- function in ONE transaction. service_role only. p_replica is accepted for API
-- compatibility; load mode instead drops FKs and toggles triggers per chunk.
DECLARE
  s text; v text; n bigint; results text[] := '{}';
BEGIN
  FOREACH s IN ARRAY p_stmts LOOP
    IF s ~* '^\\s*(select|with|values)\\M' THEN
      IF p_params IS NULL THEN EXECUTE s INTO v; ELSE EXECUTE s INTO v USING p_params; END IF;
      results := results || v;
    ELSE
      IF p_params IS NULL THEN EXECUTE s; ELSE EXECUTE s USING p_params; END IF;
      GET DIAGNOSTICS n = ROW_COUNT;
      results := results || n::text;
    END IF;
  END LOOP;
  RETURN array_to_json(results)::text;
END
$fn$;

DROP FUNCTION IF EXISTS public.dr_mirror_replace(text, text[], text[], text, text);
CREATE OR REPLACE FUNCTION public.dr_mirror_replace(p_table text, p_cols text[], p_pk text[], p_where text, p_rows text, p_delete boolean DEFAULT true)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET "TimeZone" = 'UTC'
SET "DateStyle" = 'ISO, MDY'
SET "IntervalStyle" = 'postgres'
SET extra_float_digits = 1
SET bytea_output = 'hex'
AS $fn$
-- Incline DR helper (standby only): makes one key range of a table identical to the
-- primary rows in p_rows (JSON array). User triggers are switched off for the write and
-- restored to their exact previous state before commit, so audit/notification/code
-- generation triggers never rewrite mirrored data. p_delete = false upserts only (storage
-- tables refuse direct deletes; their extras are removed through the Storage API).
-- service_role only.
DECLARE
  rel regclass := p_table::regclass;
  cols text := (SELECT string_agg(quote_ident(c), ', ') FROM unnest(p_cols) c);
  pk text := (SELECT string_agg(quote_ident(c), ', ') FROM unnest(p_pk) c);
  upd text := (SELECT string_agg(format('%1$I = EXCLUDED.%1$I', c), ', ') FROM unnest(p_cols) c WHERE NOT (c = ANY (p_pk)));
  can_toggle boolean := pg_has_role((SELECT relowner FROM pg_class WHERE oid = rel), 'USAGE');
  trg record; restore text[] := '{}'; e text; d bigint := 0; i bigint := 0;
BEGIN
  IF can_toggle THEN
    FOR trg IN SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = rel AND NOT tgisinternal AND tgenabled <> 'D' LOOP
      restore := restore || (trg.tgenabled::text || trg.tgname::text);
    END LOOP;
    IF cardinality(restore) > 0 THEN EXECUTE format('ALTER TABLE %s DISABLE TRIGGER USER', rel); END IF;
  END IF;
  IF cardinality(p_pk) = 0 THEN
    IF NOT p_delete THEN RAISE EXCEPTION 'upsert-only copy needs a primary key'; END IF;
    EXECUTE format('DELETE FROM %s WHERE %s', rel, p_where);
    GET DIAGNOSTICS d = ROW_COUNT;
    EXECUTE format('INSERT INTO %1$s (%2$s) OVERRIDING SYSTEM VALUE SELECT %2$s FROM json_populate_recordset(NULL::%1$s, $1::json)', rel, cols) USING p_rows;
    GET DIAGNOSTICS i = ROW_COUNT;
  ELSE
    IF p_delete THEN
      EXECUTE format('DELETE FROM %1$s WHERE (%2$s) AND (%3$s) NOT IN (SELECT %3$s FROM json_populate_recordset(NULL::%1$s, $1::json))', rel, p_where, pk) USING p_rows;
      GET DIAGNOSTICS d = ROW_COUNT;
    END IF;
    EXECUTE format('INSERT INTO %1$s (%2$s) OVERRIDING SYSTEM VALUE SELECT %2$s FROM json_populate_recordset(NULL::%1$s, $1::json) ON CONFLICT (%3$s) DO %4$s',
      rel, cols, pk, CASE WHEN upd IS NULL THEN 'NOTHING' ELSE 'UPDATE SET ' || upd END) USING p_rows;
    GET DIAGNOSTICS i = ROW_COUNT;
  END IF;
  FOREACH e IN ARRAY restore LOOP
    EXECUTE format('ALTER TABLE %s ENABLE %s TRIGGER %I', rel,
      CASE left(e, 1) WHEN 'A' THEN 'ALWAYS' WHEN 'R' THEN 'REPLICA' ELSE '' END, substr(e, 2));
  END LOOP;
  RETURN d || ',' || i;
END
$fn$;

REVOKE ALL ON FUNCTION public.dr_mirror_run(text[], text[], boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dr_mirror_replace(text, text[], text[], text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dr_mirror_run(text[], text[], boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.dr_mirror_replace(text, text[], text[], text, text, boolean) TO service_role;
ALTER ROLE service_role SET statement_timeout = '120s';
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
`;

/** Chunk size the standby's resumable (TUS) endpoint requires. */
export const TUS_CHUNK = 6 * 1024 * 1024;

export class Standby {
  readonly base: string;
  constructor(base: string, private key: string) {
    this.base = base.replace(/\/+$/, "");
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { apikey: this.key, Authorization: `Bearer ${this.key}`, ...extra };
  }

  async rpc<T>(fn: string, args: Record<string, unknown>, timeoutMs = 125_000): Promise<T> {
    const r = await fetch(`${this.base}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await r.text();
    if (!r.ok) {
      let msg = text.slice(0, 600);
      let code: string | undefined;
      try {
        const j = JSON.parse(text);
        msg = j.message ?? msg;
        code = j.code;
      } catch { /* keep raw */ }
      throw new StandbyError(msg, r.status, code);
    }
    return JSON.parse(text) as T;
  }

  /** Run statements in one standby transaction; returns one text result per statement. */
  async run(stmts: string[], params: string[] | null = null): Promise<(string | null)[]> {
    const out = await this.rpc<string>("dr_mirror_run", { p_stmts: stmts, p_params: params });
    return JSON.parse(out) as (string | null)[];
  }

  async one(stmt: string, params: string[] | null = null): Promise<string | null> {
    return (await this.run([stmt], params))[0];
  }

  async replace(table: string, cols: string[], pk: string[], where: string, rowsJson: string, allowDelete = true): Promise<ReplaceResult> {
    const out = await this.rpc<string>("dr_mirror_replace", {
      p_table: table, p_cols: cols, p_pk: pk, p_where: where, p_rows: rowsJson, p_delete: allowDelete,
    });
    const [d, w] = String(out).split(",").map(Number);
    return { deleted: d || 0, written: w || 0 };
  }

  /** True when both helper functions are reachable. */
  async helpersReady(): Promise<boolean> {
    try {
      await this.one("select 'ok'");
      return true;
    } catch (e) {
      if (e instanceof StandbyError && (e.status === 404 || e.code === "PGRST202")) return false;
      throw e;
    }
  }

  // ── Storage ────────────────────────────────────────────────────────────────

  objectUrl(bucket: string, path: string): string {
    return `${this.base}/storage/v1/object/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`;
  }

  async storageJson<T>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await fetch(`${this.base}/storage/v1/${path}`, {
      method,
      headers: this.headers(body === undefined ? {} : { "Content-Type": "application/json" }),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await r.text();
    if (!r.ok) throw new StandbyError(`storage ${method} ${path}: ${text.slice(0, 300)}`, r.status);
    return (text ? JSON.parse(text) : null) as T;
  }

  async upload(bucket: string, path: string, body: Uint8Array, contentType: string, cacheControl: string | null): Promise<void> {
    const h: Record<string, string> = { "x-upsert": "true", "Content-Type": contentType || "application/octet-stream" };
    if (cacheControl) h["cache-control"] = cacheControl;
    const r = await fetch(this.objectUrl(bucket, path), {
      method: "POST", headers: this.headers(h), body, signal: AbortSignal.timeout(110_000),
    });
    if (!r.ok) throw new StandbyError(`upload ${bucket}/${path}: ${(await r.text()).slice(0, 300)}`, r.status);
    await r.body?.cancel().catch(() => {});
  }

  async removeObjects(bucket: string, paths: string[]): Promise<void> {
    for (let i = 0; i < paths.length; i += 100) {
      await this.storageJson("DELETE", `object/${encodeURIComponent(bucket)}`, { prefixes: paths.slice(i, i + 100) });
    }
  }

  // Resumable (TUS) upload for large files: each PATCH is one 6 MB chunk, so a copy can
  // continue across worker runs from the offset the standby reports.
  async tusCreate(bucket: string, path: string, size: number, contentType: string, cacheControl: string | null): Promise<string> {
    const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
    const meta = [`bucketName ${b64(bucket)}`, `objectName ${b64(path)}`, `contentType ${b64(contentType || "application/octet-stream")}`];
    if (cacheControl) meta.push(`cacheControl ${b64(cacheControl.replace(/^max-age=/, ""))}`);
    const r = await fetch(`${this.base}/storage/v1/upload/resumable`, {
      method: "POST",
      headers: this.headers({ "Tus-Resumable": "1.0.0", "Upload-Length": String(size), "Upload-Metadata": meta.join(","), "x-upsert": "true" }),
      signal: AbortSignal.timeout(60_000),
    });
    if (r.status !== 201) throw new StandbyError(`tus create ${bucket}/${path}: ${r.status} ${(await r.text()).slice(0, 300)}`, r.status);
    await r.body?.cancel().catch(() => {});
    const loc = r.headers.get("location") ?? "";
    const id = loc.split("/upload/resumable/")[1];
    if (!id) throw new StandbyError(`tus create ${bucket}/${path}: no upload location`, 500);
    // The standby proxy may report an internal host; always talk to the public base.
    return `${this.base}/storage/v1/upload/resumable/${id}`;
  }

  async tusOffset(url: string): Promise<number | null> {
    const r = await fetch(url, { method: "HEAD", headers: this.headers({ "Tus-Resumable": "1.0.0" }), signal: AbortSignal.timeout(30_000) });
    if (!r.ok) return null;
    const off = r.headers.get("upload-offset");
    return off == null ? null : Number(off);
  }

  async tusPatch(url: string, offset: number, chunk: Uint8Array): Promise<number> {
    const r = await fetch(url, {
      method: "PATCH",
      headers: this.headers({ "Tus-Resumable": "1.0.0", "Upload-Offset": String(offset), "Content-Type": "application/offset+octet-stream" }),
      body: chunk,
      signal: AbortSignal.timeout(100_000),
    });
    if (r.status !== 204 && r.status !== 200) throw new StandbyError(`tus patch: ${r.status} ${(await r.text()).slice(0, 300)}`, r.status);
    await r.body?.cancel().catch(() => {});
    return Number(r.headers.get("upload-offset") ?? offset + chunk.length);
  }
}
