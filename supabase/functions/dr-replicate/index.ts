// supabase/functions/dr-replicate/index.ts
// v1.4.0 — Full 1:1 mirror PRIMARY → DR with chunk-safe row sync.
//
// Passes (controlled via body.mode):
//   "all"      → schema-snapshot + auth + storage + rows  (default; nightly cron)
//   "auth"     → auth.users only
//   "storage"  → storage buckets + object bytes only (BFS, arbitrary depth)
//   "rows"     → public.* table rows only (uses public.dr_get_replication_tables())
//   "schema"   → real DDL dump via public.dr_dump_schema() → standby Storage
//   "verify"   → parity diff: per-table counts + per-bucket counts/bytes
//
// Auth: service-role JWT, owner user JWT, OR shared secret in x-dr-secret.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-dr-secret",
};

const DR_URL = "https://pmznpbsahetwmogezhff.supabase.co";

type Mode = "all" | "auth" | "storage" | "rows" | "schema" | "verify";

interface MirrorReport {
  ok: boolean;
  version: "1.4.0";
  mode: Mode;
  startedAt: string;
  finishedAt?: string;
  mirrored: {
    schema?: { dumpedBytes: number; uploadedPath: string | null };
    authUsers?: { listed: number; created: number; updated: number; failed: number };
    storage?: {
      buckets: { ensured: number; failed: number };
      objects: { copied: number; skipped: number; failed: number; bytes: number };
      perBucket: Array<{ bucket: string; objects: number; bytes: number; failed: number }>;
    };
    rows?: {
      tables: number;
      rowsUpserted: number;
      tablesFailed: number;
      perTable: Array<{ table: string; rows: number; failed: number; primaryCount?: number; standbyCount?: number; error?: string }>;
    };
    verify?: {
      tables: Array<{ table: string; primary: number; standby: number; delta: number }>;
      storage: Array<{
        bucket: string;
        primaryObjects: number;
        standbyObjects: number;
        primaryBytes: number;
        standbyBytes: number;
        deltaObjects: number;
        deltaBytes: number;
      }>;
      allInSync: boolean;
    };
  };
  errors: string[];
}

async function getOrCreateToken(primary: SupabaseClient): Promise<string> {
  const { data, error } = await primary.rpc("dr_get_or_create_token");
  if (error) throw new Error(`dr_get_or_create_token: ${error.message}`);
  if (!data || typeof data !== "string") throw new Error("dr_get_or_create_token returned no token");
  return data;
}

// ── Auth users ────────────────────────────────────────────────────────────────

async function syncAuthUsers(
  primary: SupabaseClient,
  dr: SupabaseClient,
  report: MirrorReport,
): Promise<void> {
  const stat = { listed: 0, created: 0, updated: 0, failed: 0 };
  let page = 1;
  const perPage = 1000;
  while (true) {
    const { data, error } = await primary.auth.admin.listUsers({ page, perPage });
    if (error) {
      report.errors.push(`auth.list p${page}: ${error.message}`);
      break;
    }
    const users = data?.users ?? [];
    if (users.length === 0) break;
    stat.listed += users.length;

    for (const u of users) {
      try {
        const { error: createErr } = await dr.auth.admin.createUser({
          id: u.id,
          email: u.email ?? undefined,
          phone: u.phone ?? undefined,
          email_confirm: !!u.email_confirmed_at,
          phone_confirm: !!u.phone_confirmed_at,
          user_metadata: u.user_metadata ?? {},
          app_metadata: u.app_metadata ?? {},
        });
        if (createErr) {
          const msg = createErr.message?.toLowerCase() ?? "";
          if (msg.includes("already") || msg.includes("duplicate") || msg.includes("exists")) {
            const { error: updErr } = await dr.auth.admin.updateUserById(u.id, {
              email: u.email ?? undefined,
              phone: u.phone ?? undefined,
              user_metadata: u.user_metadata ?? {},
              app_metadata: u.app_metadata ?? {},
            });
            if (updErr) { stat.failed++; report.errors.push(`user ${u.id}: ${updErr.message}`); }
            else stat.updated++;
          } else {
            stat.failed++;
            report.errors.push(`user ${u.id}: ${createErr.message}`);
          }
        } else {
          stat.created++;
        }
      } catch (e) {
        stat.failed++;
        report.errors.push(`user ${u.id}: ${(e as Error).message}`);
      }
    }
    if (users.length < perPage) break;
    page++;
  }
  report.mirrored.authUsers = stat;
}

// ── Storage: BFS walker of arbitrary depth ────────────────────────────────────

interface StorageItem {
  name: string;
  id: string | null;
  metadata: { size?: number; mimetype?: string } | null;
}

async function listPrefix(
  primaryUrl: string,
  serviceRoleKey: string,
  bucket: string,
  prefix: string,
): Promise<StorageItem[]> {
  // Paginate. Storage REST default returns up to 1000 items.
  const PAGE = 1000;
  let offset = 0;
  const out: StorageItem[] = [];
  while (true) {
    const r = await fetch(`${primaryUrl}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        limit: PAGE,
        offset,
        prefix,
        sortBy: { column: "name", order: "asc" },
      }),
    });
    if (!r.ok) break;
    const items = (await r.json()) as StorageItem[];
    out.push(...items);
    if (items.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

async function walkBucket(
  primaryUrl: string,
  serviceRoleKey: string,
  bucket: string,
): Promise<Array<{ path: string; size: number; mimetype?: string }>> {
  const files: Array<{ path: string; size: number; mimetype?: string }> = [];
  const queue: string[] = [""]; // BFS over prefixes
  const seenPrefix = new Set<string>([""]);

  while (queue.length > 0) {
    const prefix = queue.shift()!;
    const items = await listPrefix(primaryUrl, serviceRoleKey, bucket, prefix);
    for (const item of items) {
      // Folders: id is null AND metadata is null
      const isFolder = item.id === null && item.metadata === null;
      if (isFolder) {
        const childPrefix = prefix ? `${prefix}${item.name}/` : `${item.name}/`;
        if (!seenPrefix.has(childPrefix)) {
          seenPrefix.add(childPrefix);
          queue.push(childPrefix);
        }
      } else if (item.metadata?.size != null) {
        const fullPath = prefix ? `${prefix}${item.name}` : item.name;
        files.push({
          path: fullPath,
          size: item.metadata.size,
          mimetype: item.metadata.mimetype,
        });
      }
    }
  }
  return files;
}

async function syncStorage(
  primary: SupabaseClient,
  dr: SupabaseClient,
  primaryUrl: string,
  serviceRoleKey: string,
  report: MirrorReport,
): Promise<void> {
  const stat = {
    buckets: { ensured: 0, failed: 0 },
    objects: { copied: 0, skipped: 0, failed: 0, bytes: 0 },
    perBucket: [] as Array<{ bucket: string; objects: number; bytes: number; failed: number }>,
  };

  const { data: buckets, error: bErr } = await primary.storage.listBuckets();
  if (bErr) {
    report.errors.push(`list buckets: ${bErr.message}`);
    report.mirrored.storage = stat;
    return;
  }

  const { data: drBucketsAll } = await dr.storage.listBuckets();
  const drBucketNames = new Set((drBucketsAll ?? []).map((b) => b.name));

  for (const b of buckets ?? []) {
    if (!drBucketNames.has(b.name)) {
      const { error: cErr } = await dr.storage.createBucket(b.name, {
        public: b.public,
        fileSizeLimit: b.file_size_limit ?? undefined,
        allowedMimeTypes: b.allowed_mime_types ?? undefined,
      });
      if (cErr) {
        stat.buckets.failed++;
        report.errors.push(`bucket ${b.name}: ${cErr.message}`);
        continue;
      }
    }
    stat.buckets.ensured++;

    const files = await walkBucket(primaryUrl, serviceRoleKey, b.name);
    let bucketObjs = 0;
    let bucketBytes = 0;
    let bucketFailed = 0;

    for (const f of files) {
      try {
        const dl = await primary.storage.from(b.name).download(f.path);
        if (dl.error || !dl.data) {
          stat.objects.failed++;
          bucketFailed++;
          report.errors.push(`dl ${b.name}/${f.path}: ${dl.error?.message ?? "no body"}`);
          continue;
        }
        const up = await dr.storage.from(b.name).upload(f.path, dl.data, {
          upsert: true,
          contentType: f.mimetype ?? dl.data.type,
        });
        if (up.error) {
          stat.objects.failed++;
          bucketFailed++;
          report.errors.push(`up ${b.name}/${f.path}: ${up.error.message}`);
        } else {
          stat.objects.copied++;
          stat.objects.bytes += f.size;
          bucketObjs++;
          bucketBytes += f.size;
        }
      } catch (e) {
        stat.objects.failed++;
        bucketFailed++;
        report.errors.push(`${b.name}/${f.path}: ${(e as Error).message}`);
      }
    }
    stat.perBucket.push({ bucket: b.name, objects: bucketObjs, bytes: bucketBytes, failed: bucketFailed });
  }
  report.mirrored.storage = stat;
}

// ── Row mirror ────────────────────────────────────────────────────────────────

async function syncRows(
  primary: SupabaseClient,
  dr: SupabaseClient,
  report: MirrorReport,
): Promise<void> {
  const stat = {
    tables: 0,
    rowsUpserted: 0,
    tablesFailed: 0,
    perTable: [] as Array<{ table: string; rows: number; failed: number; primaryCount?: number; standbyCount?: number; error?: string }>,
  };

  const { data: tables, error: tErr } = await primary.rpc("dr_get_replication_tables");
  if (tErr || !Array.isArray(tables)) {
    report.errors.push(`dr_get_replication_tables: ${tErr?.message ?? "no data"}`);
    report.mirrored.rows = stat;
    return;
  }

  const PAGE = 500;

  const countRows = async (client: SupabaseClient, table: string): Promise<number> => {
    const { count, error } = await client.from(table).select("*", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    return count ?? 0;
  };

  const withRetry = async <T,>(label: string, work: () => Promise<T>): Promise<T> => {
    let last: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { return await work(); }
      catch (e) {
        last = e;
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }
    throw new Error(`${label}: ${(last as Error)?.message ?? String(last)}`);
  };

  for (let pass = 1; pass <= 2; pass++) {
    for (const row of tables as Array<{ table_name: string; has_id_pk: boolean }>) {
      const table = row.table_name;
      const hasId = row.has_id_pk;
      let perTableRows = 0;
      let perTableFailed = 0;
      let lastErr: string | undefined;

      try {
        const primaryCount = await countRows(primary, table);
        if (primaryCount === 0) {
          const standbyCount = await countRows(dr, table).catch(() => undefined);
          if (pass === 2) stat.perTable.push({ table, rows: 0, failed: 0, primaryCount, standbyCount });
          continue;
        }

        for (let offset = 0; offset < primaryCount; offset += PAGE) {
          const { data, error } = await withRetry(`read ${table} ${offset}`, () =>
            primary.from(table).select("*").order("id", { ascending: true }).range(offset, offset + PAGE - 1),
          );
          if (error) throw new Error(error.message);
          const rows = data ?? [];
          if (rows.length === 0) break;

          const upsertOpts = hasId
            ? { onConflict: "id" as const }
            : { ignoreDuplicates: true };
          const { error: upErr } = await withRetry(`upsert ${table} ${offset}`, () =>
            dr.from(table).upsert(rows, upsertOpts),
          );
          if (upErr) throw new Error(upErr.message);
          perTableRows += rows.length;
        }

        const standbyCount = await countRows(dr, table);
        if (primaryCount !== standbyCount) {
          throw new Error(`count mismatch primary=${primaryCount} standby=${standbyCount}`);
        }
      } catch (e) {
        lastErr = (e as Error).message;
        perTableFailed++;
      }

      if (pass === 2) {
        stat.tables++;
        stat.rowsUpserted += perTableRows;
        if (perTableFailed > 0) {
          stat.tablesFailed++;
          report.errors.push(`rows ${table}: ${lastErr}`);
        }
        stat.perTable.push({ table, rows: perTableRows, failed: perTableFailed, error: lastErr });
      }
    }
  }

  report.mirrored.rows = stat;
}

// ── Schema snapshot via real RPC ──────────────────────────────────────────────

async function syncSchemaSnapshot(
  primary: SupabaseClient,
  dr: SupabaseClient,
  report: MirrorReport,
): Promise<void> {
  const { data, error } = await primary.rpc("dr_dump_schema");
  if (error || typeof data !== "string") {
    report.errors.push(`dr_dump_schema: ${error?.message ?? "no data"}`);
    report.mirrored.schema = { dumpedBytes: 0, uploadedPath: null };
    return;
  }
  const dump = data;

  const bucketId = "dr-snapshots";
  const { data: bks } = await dr.storage.listBuckets();
  if (!(bks ?? []).some((b) => b.name === bucketId)) {
    const { error: cErr } = await dr.storage.createBucket(bucketId, { public: false });
    if (cErr) report.errors.push(`create bucket ${bucketId}: ${cErr.message}`);
  }

  const dateKey = new Date().toISOString().slice(0, 10);
  const objectPath = `${dateKey}.sql`;
  const blob = new Blob([dump], { type: "text/plain" });
  const { error: upErr } = await dr.storage.from(bucketId).upload(objectPath, blob, {
    upsert: true,
    contentType: "text/plain",
  });

  report.mirrored.schema = {
    dumpedBytes: dump.length,
    uploadedPath: upErr ? null : `${bucketId}/${objectPath}`,
  };
  if (upErr) report.errors.push(`schema upload: ${upErr.message}`);
}

// ── Verify: parity diff ───────────────────────────────────────────────────────

async function verifyParity(
  primary: SupabaseClient,
  dr: SupabaseClient,
  primaryUrl: string,
  serviceRoleKey: string,
  drServiceKey: string,
  report: MirrorReport,
): Promise<void> {
  const tables: Array<{ table: string; primary: number; standby: number; delta: number }> = [];
  const storage: Array<{
    bucket: string; primaryObjects: number; standbyObjects: number;
    primaryBytes: number; standbyBytes: number; deltaObjects: number; deltaBytes: number;
  }> = [];

  // Table counts
  const { data: pCounts, error: pErr } = await primary.rpc("dr_table_counts");
  const { data: sCounts, error: sErr } = await dr.rpc("dr_table_counts");
  if (pErr) report.errors.push(`primary dr_table_counts: ${pErr.message}`);
  if (sErr) report.errors.push(`standby dr_table_counts: ${sErr.message}`);

  const sMap = new Map<string, number>();
  for (const r of (sCounts ?? []) as Array<{ table_name: string; row_count: number }>) {
    sMap.set(r.table_name, Number(r.row_count));
  }
  for (const r of (pCounts ?? []) as Array<{ table_name: string; row_count: number }>) {
    const p = Number(r.row_count);
    const s = sMap.get(r.table_name) ?? 0;
    tables.push({ table: r.table_name, primary: p, standby: s, delta: p - s });
  }

  // Storage: walk both sides
  const { data: pBuckets } = await primary.storage.listBuckets();
  for (const b of pBuckets ?? []) {
    const pFiles = await walkBucket(primaryUrl, serviceRoleKey, b.name);
    const sFiles = await walkBucket(DR_URL, drServiceKey, b.name);
    const pBytes = pFiles.reduce((a, f) => a + f.size, 0);
    const sBytes = sFiles.reduce((a, f) => a + f.size, 0);
    storage.push({
      bucket: b.name,
      primaryObjects: pFiles.length,
      standbyObjects: sFiles.length,
      primaryBytes: pBytes,
      standbyBytes: sBytes,
      deltaObjects: pFiles.length - sFiles.length,
      deltaBytes: pBytes - sBytes,
    });
  }

  const allInSync =
    tables.every((t) => t.delta === 0) &&
    storage.every((s) => s.deltaObjects === 0 && s.deltaBytes === 0);

  report.mirrored.verify = { tables, storage, allInSync };
}

// ── HTTP handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const primaryUrl = Deno.env.get("SUPABASE_URL")!;
    const primary = createClient(primaryUrl, serviceRoleKey, { auth: { persistSession: false } });

    const auth = req.headers.get("authorization") ?? "";
    const sharedSecret = req.headers.get("x-dr-secret") ?? "";
    const isServiceJwt = auth === `Bearer ${serviceRoleKey}`;
    let isSharedSecret = false;
    if (sharedSecret.length > 0) {
      const expected = await getOrCreateToken(primary);
      isSharedSecret = sharedSecret === expected;
    }

    let isOwnerUser = false;
    if (!isServiceJwt && !isSharedSecret && auth.startsWith("Bearer ")) {
      const token = auth.replace("Bearer ", "");
      const userClient = createClient(primaryUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false },
      });
      const { data: userData } = await userClient.auth.getUser(token);
      const uid = userData?.user?.id;
      if (uid) {
        const { data: hasOwner } = await primary.rpc("has_role", {
          _user_id: uid, _role: "owner",
        });
        isOwnerUser = Boolean(hasOwner);
      }
    }

    if (!isServiceJwt && !isSharedSecret && !isOwnerUser) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const drServiceKey = Deno.env.get("DR_SERVICE_ROLE_KEY");
    if (!drServiceKey) throw new Error("DR_SERVICE_ROLE_KEY not configured");
    const dr = createClient(DR_URL, drServiceKey, { auth: { persistSession: false } });

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const mode: Mode = (body.mode as Mode) ?? "all";

    const report: MirrorReport = {
      ok: true,
      version: "1.3.0",
      mode,
      startedAt: new Date().toISOString(),
      mirrored: {},
      errors: [],
    };

    if (mode === "schema" || mode === "all") {
      await syncSchemaSnapshot(primary, dr, report);
    }
    if (mode === "auth" || mode === "all") {
      await syncAuthUsers(primary, dr, report);
    }
    if (mode === "rows" || mode === "all") {
      await syncRows(primary, dr, report);
    }
    if (mode === "storage" || mode === "all") {
      await syncStorage(primary, dr, primaryUrl, serviceRoleKey, report);
    }
    if (mode === "verify") {
      await verifyParity(primary, dr, primaryUrl, serviceRoleKey, drServiceKey, report);
    }

    report.finishedAt = new Date().toISOString();
    report.ok = report.errors.length === 0;

    return new Response(JSON.stringify(report, null, 2), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
