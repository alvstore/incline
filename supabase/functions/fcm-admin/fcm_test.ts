import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildJwtClaims, classifyFcmError, parseServiceAccount } from "../_shared/fcm.ts";

const good = { type: "service_account", project_id: "incline-b00c5", client_email: "push@incline-b00c5.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n" };

Deno.test("accepts a valid service account (object or string)", () => {
  assertEquals(parseServiceAccount(good).ok, true);
  assertEquals(parseServiceAccount(JSON.stringify(good)).ok, true);
});
Deno.test("rejects wrong type, bad email, missing key, bad JSON", () => {
  assertEquals(parseServiceAccount({ ...good, type: "user" }).ok, false);
  assertEquals(parseServiceAccount({ ...good, client_email: "a@gmail.com" }).ok, false);
  assertEquals(parseServiceAccount({ ...good, private_key: "x" }).ok, false);
  assertEquals(parseServiceAccount("{not json").ok, false);
});
Deno.test("JWT claims target Google token endpoint for one hour", () => {
  const c = buildJwtClaims("push@x.iam.gserviceaccount.com", 1000);
  assertEquals(c.iss, "push@x.iam.gserviceaccount.com");
  assertEquals(c.aud, "https://oauth2.googleapis.com/token");
  assertEquals(c.exp - c.iat, 3600);
});
Deno.test("classifies FCM errors", () => {
  assertEquals(classifyFcmError(404, ""), "stale");
  assertEquals(classifyFcmError(400, '{"status":"INVALID_ARGUMENT"}'), "stale");
  assertEquals(classifyFcmError(429, ""), "retry");
  assertEquals(classifyFcmError(503, ""), "retry");
  assertEquals(classifyFcmError(403, "PERMISSION_DENIED"), "fail");
});
