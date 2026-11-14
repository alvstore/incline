// @ts-expect-error bun test runner types
import { expect, test } from "bun:test";
import { buildGroupPrompt, classifyError, extractRpcName } from "./aiFixPrompt";

test("extracts RPC name from a REST stack frame and a worker key", () => {
  expect(extractRpcName({ id: "1", error_message: "x", stack_trace: "400 — https://x.supabase.co/rest/v1/rpc/start_membership_now" })).toBe("start_membership_now");
  expect(extractRpcName({ id: "2", error_message: "x", context: { worker: "rpc:detect_renewal_cases" } })).toBe("detect_renewal_cases");
});

test("classifies unknown column and missing function errors", () => {
  expect(classifyError('column "old_values" of relation "audit_logs" does not exist').kind).toBe("unknown_column");
  expect(classifyError("Could not find the function public.renewal_funnel(_branch_id, _days) in the schema cache").kind).toBe("missing_function");
});

test("flags clusters that share a database object", () => {
  const p = buildGroupPrompt([
    { id: "a", fingerprint: "f1", error_message: "boom", stack_trace: "/rpc/foo_bar" },
    { id: "b", fingerprint: "f2", error_message: "other", stack_trace: "/rpc/foo_bar" },
  ]);
  expect(p).toContain("function public.foo_bar appears in clusters 1, 2");
});
