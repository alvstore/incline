import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { webTurnSourceType } from "./websiteChatStore.ts";
const ALLOWED = ["campaign","ai","human","automation","transactional","system","inbound"];
Deno.test("visitor turns are stored as inbound", () => assertEquals(webTurnSourceType("user"), "inbound"));
Deno.test("concierge turns are stored as ai", () => assertEquals(webTurnSourceType("bot"), "ai"));
Deno.test("both labels pass the database check", () => {
  for (const f of ["user","bot"] as const) assertEquals(ALLOWED.includes(webTurnSourceType(f)), true);
});
