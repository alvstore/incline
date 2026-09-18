// mipsDeviceCache v1.0.0
//
// WHY: GET /through/device/list is the heaviest MIPS endpoint (full roster +
// person/photo counts). Six workers polled it independently, sometimes within
// the same cron tick. This shared cache (settings key `mips_device_list_cache`,
// branch scoped, 120s TTL) collapses ~12 calls per tick into ~1.
//
// Read-only workers (watchdog, face-sweep, face-parity, reconcile) read the
// cache. `sync-to-mips` and `mips-import-devices` fetch live and refresh it.

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
export type MipsDeviceRow = Record<string, any>;

const CACHE_KEY = "mips_device_list_cache";
const TTL_MS = 120_000;

interface CacheRecord {
  rows: MipsDeviceRow[];
  fetched_at: string;
  base_url: string;
}

const memo = new Map<string, { rows: MipsDeviceRow[]; expiresAt: number }>();

const scopeKey = (branchId: string | null, baseUrl: string) => `${branchId ?? "global"}\u0000${baseUrl}`;

export async function fetchMipsDevices(baseUrl: string, token: string): Promise<MipsDeviceRow[]> {
  const res = await fetch(`${baseUrl}/through/device/list`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "TENANT-ID": "1",
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  // deno-lint-ignore no-explicit-any
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    j = {};
  }
  const rows = j?.rows || j?.data || [];
  return Array.isArray(rows) ? rows : [];
}

async function writeCache(supabase: Db, branchId: string | null, rec: CacheRecord) {
  await supabase.from("settings").upsert(
    {
      branch_id: branchId,
      key: CACHE_KEY,
      value: rec,
      description: "Shared MIPS device-list cache (120s TTL, auto-managed)",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "branch_id,key" },
  );
}

/** Store a freshly fetched roster so read-only workers stop polling MIPS. */
export async function refreshMipsDeviceCache(
  supabase: Db,
  branchId: string | null,
  baseUrl: string,
  rows: MipsDeviceRow[],
): Promise<void> {
  const url = String(baseUrl || "").replace(/\/+$/, "");
  memo.set(scopeKey(branchId, url), { rows, expiresAt: Date.now() + TTL_MS });
  try {
    await writeCache(supabase, branchId, { rows, fetched_at: new Date().toISOString(), base_url: url });
  } catch {
    // Non-fatal.
  }
}

/**
 * Returns the device roster, preferring a cache entry younger than 120s.
 * Pass `forceRefresh` from the writers (sync-to-mips, mips-import-devices).
 */
export async function getCachedMipsDevices(
  supabase: Db,
  branchId: string | null,
  baseUrl: string,
  token: string,
  options: { forceRefresh?: boolean } = {},
): Promise<MipsDeviceRow[]> {
  const url = String(baseUrl || "").replace(/\/+$/, "");
  const key = scopeKey(branchId, url);
  const now = Date.now();

  if (!options.forceRefresh) {
    const hit = memo.get(key);
    if (hit && now < hit.expiresAt) return hit.rows;

    try {
      const q = supabase.from("settings").select("value").eq("key", CACHE_KEY);
      const { data } = branchId
        ? await q.eq("branch_id", branchId).maybeSingle()
        : await q.is("branch_id", null).maybeSingle();
      const value = data?.value as Partial<CacheRecord> | undefined;
      if (
        value?.rows &&
        Array.isArray(value.rows) &&
        value.base_url === url &&
        value.fetched_at &&
        now - Date.parse(value.fetched_at) < TTL_MS
      ) {
        memo.set(key, { rows: value.rows, expiresAt: Date.parse(value.fetched_at) + TTL_MS });
        return value.rows;
      }
    } catch {
      // Fall through to a live fetch.
    }
  }

  const rows = await fetchMipsDevices(url, token);
  await refreshMipsDeviceCache(supabase, branchId, url, rows);
  return rows;
}
