import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { witnessesFromVars, applyRoleAndNotice } from "./termsFixups.ts";

Deno.test("witnesses come only from saved contract variables", () => {
  const w = witnessesFromVars({ witness_1_name: "Rajat Lekhari", witness_1_phone: "+919800000000", witness_1_id: "abc" });
  assertEquals(w, [{ slot: 1, name: "Rajat Lekhari", phone: "+919800000000", witness_id: "abc" }]);
});

Deno.test("no preset witnesses means none (employee is never asked)", () => {
  assertEquals(witnessesFromVars({}), []);
});

Deno.test("legacy draft prints saved notice and only trainer duties", () => {
  const t = "### A. FITNESS TRAINER\n* a\n\n### B. SALES STAFF\n* b\n\n### C. MANAGER\n* c\n\n---\n* Employee must serve 90 (ninety) days mandatory notice period";
  const out = applyRoleAndNotice(t, "trainer", 60);
  assertEquals(out.includes("SALES STAFF"), false);
  assertEquals(out.includes("MANAGER"), false);
  assertEquals(out.includes("60 (sixty) days"), true);
});
