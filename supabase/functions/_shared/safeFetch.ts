// v1.0.0 — Outbound fetch guard for caller-supplied URLs (SSRF protection).
// Only public https URLs are allowed; hostnames resolving to private, loopback,
// link-local or metadata addresses are refused. Redirects are not followed.

function isPrivateIPv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function isPrivateIPv6(ip: string): boolean {
  const s = ip.toLowerCase();
  return s === "::1" || s === "::" || s.startsWith("fc") || s.startsWith("fd") ||
    s.startsWith("fe80") || s.startsWith("::ffff:");
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("Invalid URL"); }
  if (u.protocol !== "https:") throw new Error("Only https URLs are allowed");
  if (u.username || u.password) throw new Error("Credentials in URL are not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error("Host not allowed");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (isPrivateIPv4(host)) throw new Error("Host not allowed");
    return u;
  }
  if (host.includes(":")) {
    if (isPrivateIPv6(host)) throw new Error("Host not allowed");
    return u;
  }
  const addrs: string[] = [];
  try { addrs.push(...(await Deno.resolveDns(host, "A"))); } catch { /* none */ }
  try { addrs.push(...(await Deno.resolveDns(host, "AAAA"))); } catch { /* none */ }
  if (addrs.length === 0) throw new Error("Host could not be resolved");
  for (const a of addrs) {
    if (a.includes(":") ? isPrivateIPv6(a) : isPrivateIPv4(a)) throw new Error("Host not allowed");
  }
  return u;
}

/** fetch() a caller-supplied URL after validating it; never follows redirects. */
export async function safeFetch(raw: string, init: RequestInit = {}): Promise<Response> {
  const u = await assertPublicUrl(raw);
  return await fetch(u.toString(), { ...init, redirect: "manual" });
}
