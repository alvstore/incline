import { assertEquals } from "jsr:@std/assert";
import { expiryAlertKind, expiryAlertDedupeKey, renewalInAppDedupeKey, istDate } from "../../supabase/functions/send-reminders/expiryAlerts.ts";
const now = new Date("2026-11-07T20:00:00Z"); // 8 Nov 01:30 IST
Deno.test("IST date crosses midnight", () => assertEquals(istDate(now), "2026-11-08"));
Deno.test("expiry day alert", () => assertEquals(expiryAlertKind("2026-11-08", now), "day"));
Deno.test("grace alert 3 days after", () => assertEquals(expiryAlertKind("2026-11-05", now), "grace"));
Deno.test("no alert otherwise", () => { assertEquals(expiryAlertKind("2026-11-07", now), null); assertEquals(expiryAlertKind("2026-11-01", now), null); });
Deno.test("stable dedupe keys", () => {
  assertEquals(expiryAlertDedupeKey("m1", "day"), "membership_expired:m1:day");
  assertEquals(renewalInAppDedupeKey("c1", "d7"), "renewal_case:c1:d7:in_app");
});
