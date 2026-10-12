// zohoDirect v1.0.0 — shared helpers for the in-app Zoho Books OAuth connection.
// Credentials live in public.zoho_direct_credentials (service-role only).
// deno-lint-ignore-file no-explicit-any
export type Dc = "in" | "com" | "eu";

export interface ZohoCreds {
  client_id: string | null;
  client_secret: string | null;
  refresh_token: string | null;
  dc: Dc;
  organization_id: string | null;
  org_name: string | null;
  connected_by: string | null;
  connected_at: string | null;
  last_test_ok_at: string | null;
  last_refresh_error: string | null;
}

export async function loadCreds(admin: any): Promise<ZohoCreds | null> {
  const { data } = await admin.from("zoho_direct_credentials").select("*").eq("id", true).maybeSingle();
  return (data as ZohoCreds) ?? null;
}

export async function getMode(admin: any): Promise<"connector" | "direct"> {
  const { data } = await admin.from("settings").select("value").is("branch_id", null)
    .eq("key", "zoho_mode").maybeSingle();
  const v = (data?.value as { mode?: string } | null)?.mode;
  return v === "direct" ? "direct" : "connector";
}

export async function setMode(admin: any, mode: "connector" | "direct") {
  const { data } = await admin.from("settings").select("id").is("branch_id", null)
    .eq("key", "zoho_mode").maybeSingle();
  if (data?.id) {
    await admin.from("settings").update({ value: { mode }, updated_at: new Date().toISOString() }).eq("id", data.id);
  } else {
    await admin.from("settings").insert({ branch_id: null, key: "zoho_mode", value: { mode },
      description: "Zoho Books connection mode: connector | direct (kill switch)" });
  }
}

export async function refreshAccessToken(creds: ZohoCreds): Promise<{ token: string; expiresIn: number }> {
  if (!creds.client_id || !creds.client_secret || !creds.refresh_token) {
    throw new Error("Direct Zoho connection is not set up");
  }
  const res = await fetch(`https://accounts.zoho.${creds.dc}/oauth/v2/token`, {
    method: "POST",
    body: new URLSearchParams({
      refresh_token: creds.refresh_token, client_id: creds.client_id,
      client_secret: creds.client_secret, grant_type: "refresh_token",
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`Zoho token refresh failed: ${j.error ?? res.status}`);
  return { token: j.access_token, expiresIn: Number(j.expires_in ?? 3600) };
}

export async function audit(admin: any, userId: string | null, action: string, description: string) {
  await admin.from("audit_logs").insert({
    user_id: userId, action, table_name: "zoho_direct_credentials",
    action_description: description, target_name: "Zoho Books",
  }).then(() => {}, () => {});
}
