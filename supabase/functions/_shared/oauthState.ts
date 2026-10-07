// v1.0.0 — Signed, expiring OAuth `state` values: "<branchId>.<expiryMs>.<hmac>".
// Prevents forged OAuth callbacks from attaching an attacker's account to a branch.
async function hmac(msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signOAuthState(branchId: string, ttlMs = 15 * 60 * 1000): Promise<string> {
  const exp = Date.now() + ttlMs;
  return `${branchId}.${exp}.${await hmac(`${branchId}.${exp}`)}`;
}

export async function verifyOAuthState(state: string | null): Promise<string | null> {
  if (!state) return null;
  const [b, e, sig] = state.split(".");
  if (!b || !e || !sig || !/^\d+$/.test(e) || Number(e) < Date.now()) return null;
  return (await hmac(`${b}.${e}`)) === sig ? b : null;
}
