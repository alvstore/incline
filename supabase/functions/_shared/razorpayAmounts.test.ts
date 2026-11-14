// @ts-expect-error bun test runtime
import { expect, test } from "bun:test";
import { splitCapturedAmount } from "./razorpayAmounts.ts";

test("₹18,424.80 paid on ₹18,000 due credits ₹18,000 and ₹424.80 fee", () => {
  expect(splitCapturedAmount(18424.8, 18000)).toEqual({ base: 18000, fee: 424.8 });
});
test("no fee when paid equals due", () => {
  expect(splitCapturedAmount(5000, 5000)).toEqual({ base: 5000, fee: 0 });
});
test("part payment below due credits the full amount", () => {
  expect(splitCapturedAmount(3000, 18000)).toEqual({ base: 3000, fee: 0 });
});
