// mipsTokenCache v1.0.0
//
// WHY: every MIPS-touching worker used to call POST /login on each invocation.
// With 6+ cron workers that is ~60 logins/hour against a 2 GB Tomcat that also
// hosts the Netty gateway the turnstiles are connected to. Session churn +
// thread-pool pressure was dropping the gateway TCP link, and the Android
// terminals reboot when that link stays dead for ~60s.
//
// This module keeps ONE token in `settings` (key `mips_auth_token`, branch
// scoped) with a 22h TTL (token lives 23h — refresh 1h early). Login traffic
// drops from ~60/hour to ~1/day.

// deno-lint-ignore no-explicit-any
type Db = any;

const TOKEN_KEY = "mips_auth_token";
const TTL_MS = 22 * 60 * 60 * 1000;

interface TokenRecord {
  token: string;
  expires_at: string;
  base_url: string;
  username: string;
}

/** Per-isolate memo so repeat calls inside one invocation cost nothing. */
const memo = new Map<string, { token: string; expiresAt: number }>();

function scopeKey(branchId: string | null, baseUrl: string, username: string) {
  return `${branchId ?? "global"}\u0000${baseUrl}\u0000${username}`;
}

async function readRow(supabase: Db, branchId: string | null): Promise<TokenRecord | null> {
  const q = supabase.from("settings").select("value").eq("key", TOKEN_KEY);
  const { data } = branchId
    ? await q.eq("branch_id", branchId).maybeSingle()
    : await q.is("branch_id", null).maybeSingle();
  const value = data?.value as Partial<TokenRecord> | undefined;
  if (!value?.token || !value.expires_at) return null;
  return value as TokenRecord;
}

async function writeRow(supabase: Db, branchId: string | null, rec: TokenRecord) {
  await supabase.from("settings").upsert(
    {
      branch_id: branchId,
      key: TOKEN_KEY,
      value: rec,
      description: "Shared MIPS auth token (auto-managed; avoids per-worker logins)",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "branch_id,key" },
  );
}

async function performLogin(baseUrl: string, username: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "TENANT-ID": "1" },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(12_000),
  });
  const text = await res.text();
  // deno-lint-ignore no-explicit-any
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`MIPS login non-JSON: ${text.slice(0, 240)}`);
  }
  if (j.code !== undefined && Number(j.code) !== 200 && Number(j.code) !== 0) {
    throw new Error(`MIPS login failed: ${j.msg || text.slice(0, 240)}`);
  }
  const token = j.token || j.data?.token;
  if (!token) throw new Error(`MIPS login returned no token: ${text.slice(0, 240)}`);
  return String(token);
}

export interface MipsCredentials {
  baseUrl: string;
  username: string;
  password: string;
}

/**
 * Returns a valid MIPS token, logging in only when the shared cache is empty,
 * expired, or was issued for different credentials / server.
 */
export async function getCachedMipsToken(
  supabase: Db,
  branchId: string | null,
  creds: MipsCredentials,
): Promise<string> {
  const baseUrl = String(creds.baseUrl || "").replace(/\/+$/, "");
  const username = String(creds.username || "");
  const key = scopeKey(branchId, baseUrl, username);
  const now = Date.now();

  const hit = memo.get(key);
  if (hit && now < hit.expiresAt) return hit.token;

  try {
    const row = await readRow(supabase, branchId);
    if (
      row &&
      row.base_url === baseUrl &&
      row.username === username &&
      Date.parse(row.expires_at) > now
    ) {
      memo.set(key, { token: row.token, expiresAt: Date.parse(row.expires_at) });
      return row.token;
    }
  } catch {
    // Cache read failures must never block a worker — fall through to login.
  }

  const token = await performLogin(baseUrl, username, creds.password);
  const expiresAt = now + TTL_MS;
  memo.set(key, { token, expiresAt });
  try {
    await writeRow(supabase, branchId, {
      token,
      expires_at: new Date(expiresAt).toISOString(),
      base_url: baseUrl,
      username,
    });
  } catch {
    // Non-fatal: the token is still usable for this invocation.
  }
  return token;
}

/** Drop a token that the server rejected so the next call re-authenticates. */
export async function invalidateMipsToken(
  supabase: Db,
  branchId: string | null,
  creds: Pick<MipsCredentials, "baseUrl" | "username">,
): Promise<void> {
  const baseUrl = String(creds.baseUrl || "").replace(/\/+$/, "");
  memo.delete(scopeKey(branchId, baseUrl, String(creds.username || "")));
  try {
    const q = supabase.from("settings").delete().eq("key", TOKEN_KEY);
    if (branchId) await q.eq("branch_id", branchId);
    else await q.is("branch_id", null);
  } catch {
    // ignore
  }
}
