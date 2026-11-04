import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  toMsg91Content, mapVariables, toIndianMobile, sendBlocker, contentHash, pickIntegration,
  redact, msg91Fetch, sendMSG91, registerBlocker, buildAddTemplateForm, type Msg91Tpl,
} from "./msg91.ts";

const CONTENT = "Hi {{member_name}}, your {{brand_name}} plan ends on {{end_date}}.";
const DLT = "1107123456789012345";

async function syncedTpl(over: Partial<Msg91Tpl> = {}): Promise<Msg91Tpl> {
  const base: Msg91Tpl = {
    type: "sms", is_active: true, content: CONTENT, dlt_template_id: DLT, dlt_header: "INCLNE",
    msg91_template_id: "tpl_abc", msg91_sync_status: "synced", msg91_synced_content_hash: null, ...over,
  };
  base.msg91_synced_content_hash ??= await contentHash({ content: base.content, dlt_header: base.dlt_header!, dlt_template_id: base.dlt_template_id! });
  return base;
}

function mockFetch(resp: unknown, status = 200, calls: Array<{ url: string; init: RequestInit }> = []) {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(resp), { status });
  }) as unknown as typeof fetch;
}

Deno.test("named placeholders become ordered ##VARn##", () => {
  assertEquals(toMsg91Content(CONTENT), "Hi ##VAR1##, your ##VAR2## plan ends on ##VAR3##.");
});

Deno.test("variables map in order with brand defaulting to Incline", () => {
  const r = mapVariables(CONTENT, { member_name: "Asha", end_date: "1 Dec" });
  assertEquals(r.values, { VAR1: "Asha", VAR2: "Incline", VAR3: "1 Dec" });
  assertEquals(r.missing, []);
});

Deno.test("missing variable is reported", () => {
  assertEquals(mapVariables(CONTENT, { member_name: "Asha" }).missing, ["end_date"]);
});

Deno.test("Indian mobile normalisation", () => {
  assertEquals(toIndianMobile("+91 98290 12345"), "919829012345");
  assertEquals(toIndianMobile("09829012345"), "919829012345");
  assertEquals(toIndianMobile("12345"), null);
});

Deno.test("register needs 19-digit DLT ID and 6-char header", () => {
  assertStringIncludes(registerBlocker({ content: CONTENT, dlt_template_id: "123", dlt_header: "INCLNE" })!, "19-digit");
  assertStringIncludes(registerBlocker({ content: CONTENT, dlt_template_id: DLT, dlt_header: null })!, "header");
  assertEquals(registerBlocker({ content: CONTENT, dlt_template_id: DLT, dlt_header: "INCLNE" }), null);
});

Deno.test("addTemplate form keeps DLT ID separate from MSG91 content", () => {
  const f = buildAddTemplateForm({ name: "Expiry", content: CONTENT, dlt_header: "INCLNE", dlt_template_id: DLT });
  assertEquals(f.get("dlt_template_id"), DLT);
  assertEquals(f.get("sender_id"), "INCLNE");
  assertEquals(f.get("smsType"), "NORMAL");
});

Deno.test("send blocked when not synced / changed since sync", async () => {
  assertStringIncludes((await sendBlocker(await syncedTpl({ msg91_template_id: null })))!, "not registered");
  assertStringIncludes((await sendBlocker(await syncedTpl({ msg91_sync_status: "needs_resync" })))!, "resync");
  assertStringIncludes((await sendBlocker(await syncedTpl({ msg91_synced_content_hash: "stale" })))!, "changed");
  assertEquals(await sendBlocker(await syncedTpl()), null);
});

Deno.test("branch integration wins over global", () => {
  const rows = [{ branch_id: null, n: "g" }, { branch_id: "b1", n: "b" }];
  assertEquals(pickIntegration(rows, "b1")?.n, "b");
  assertEquals(pickIntegration(rows, "b2")?.n, "g");
});

Deno.test("auth key is redacted from errors and sent only as header", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const r = await msg91Fetch("SECRETKEY123", "/api/v5/flows", {}, mockFetch({ type: "error", message: "bad key SECRETKEY123 ip not whitelisted" }, 401, calls));
  assert(!r.ok);
  assert(!r.error!.includes("SECRETKEY123"));
  assertStringIncludes(r.error!, "whitelisted");
  assert(!calls[0].url.includes("SECRETKEY123"));
  assertEquals(redact("x SECRETKEY123 y", "SECRETKEY123"), "x [redacted] y");
});

Deno.test("sendMSG91 posts Flow body with template id and ordered VARs", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const r = await sendMSG91("9829012345", {}, { auth_key: "k1234" }, await syncedTpl(),
    { member_name: "Asha", end_date: "1 Dec" }, mockFetch({ type: "success", message: "req1" }, 200, calls));
  assertEquals(r, { success: true, message_id: "req1" });
  assertEquals(calls[0].url, "https://control.msg91.com/api/v5/flow");
  assertEquals(JSON.parse(String(calls[0].init.body)), {
    template_id: "tpl_abc", realTimeResponse: "1",
    recipients: [{ mobiles: "919829012345", VAR1: "Asha", VAR2: "Incline", VAR3: "1 Dec" }],
  });
});

Deno.test("sendMSG91 fails closed without calling MSG91", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f = mockFetch({}, 200, calls);
  assertStringIncludes((await sendMSG91("9829012345", {}, { auth_key: "k1234" }, await syncedTpl(), { member_name: "A" }, f)).error!, "Missing");
  assertStringIncludes((await sendMSG91("9829012345", {}, { auth_key: "k1234" }, await syncedTpl({ is_active: false }), {}, f)).error!, "off");
  assertStringIncludes((await sendMSG91("9829012345", {}, { auth_key: "k1234" }, undefined, {}, f)).error!, "legacy");
  assertEquals(calls.length, 0);
});

Deno.test("legacy fallback template id needs explicit VARn", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const r = await sendMSG91("9829012345", { template_id: "legacy1" }, { auth_key: "k1234" }, undefined, { VAR1: "x" }, mockFetch({ type: "success" }, 200, calls));
  assert(r.success);
  assertEquals(JSON.parse(String(calls[0].init.body)).template_id, "legacy1");
});
