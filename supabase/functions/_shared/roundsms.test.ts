import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { roundSendUrl } from "./roundsms.ts";

Deno.test("RoundSMS send URL unchanged (regression)", () => {
  const url = roundSendUrl("+919829012345", "Hi Asha", { sender_id: "INCLNE" }, { username: "MUSGARR", password: "p" });
  assertEquals(url, "http://voice.roundsms.co/api/sendmsg.php?user=MUSGARR&pass=p&sender=INCLNE&phone=9829012345&text=Hi%20Asha&priority=ndnd&stype=normal");
});

Deno.test("RoundSMS DLT params only when parameter names configured", () => {
  const cfg = { sender_id: "INCLNE", dlt_template_id: "1107123456789012345" };
  const without = roundSendUrl("9829012345", "x", cfg, { username: "u", password: "p" });
  assertEquals(without.includes("1107123456789012345"), false);
  const withParam = roundSendUrl("9829012345", "x", { ...cfg, dlt_template_param: "templateid" }, { username: "u", password: "p" });
  assertEquals(withParam.endsWith("&templateid=1107123456789012345"), true);
});
