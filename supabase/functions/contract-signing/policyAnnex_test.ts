import { assert, assertEquals } from "jsr:@std/assert";
import { acknowledgementRows, annexureMarkdown, parseSnapshot } from "./policyAnnex.ts";

const snap = [
  { policy_id: "a", code: "posh", title: "POSH Policy", version: 2, effective_from: "2026-11-01", body_markdown: "# Scope\nAll staff", body_hash: "h1" },
  { bogus: true },
];

Deno.test("annexure lists each attached policy with its version", () => {
  const md = annexureMarkdown(parseSnapshot(snap));
  assert(md.includes("ANNEXURE B"));
  assert(md.includes("B1. POSH Policy — v2, effective 2026-11-01"));
});

Deno.test("no policies means no annexure", () => {
  assertEquals(annexureMarkdown([]), "");
});

Deno.test("one acknowledgement per attached policy at the signed version", () => {
  const rows = acknowledgementRows(parseSnapshot(snap), {
    userId: "u", employeeId: "e", trainerId: null, branchId: "b", signedName: "X",
    signatureImagePath: null, ip: null, userAgent: null, geolocation: null,
  });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].policy_version, 2);
  assertEquals(rows[0].body_hash, "h1");
});
