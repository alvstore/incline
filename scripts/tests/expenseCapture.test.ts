import { describe, expect, test } from "bun:test";
import {
  normalizeExpenseMode, parseAmount, resolveExpenseDate, defaultExpenseType, guessCategory, canCaptureExpense,
} from "../../supabase/functions/_shared/expenseCapture";

describe("WhatsApp expense capture", () => {
  test("amounts", () => {
    expect(parseAmount("5000")).toBe(5000);
    expect(parseAmount("₹8,450")).toBe(8450);
    expect(parseAmount("5k")).toBe(5000);
    expect(parseAmount("0")).toBeNull();
  });
  test("modes", () => {
    expect(normalizeExpenseMode("Cash")).toBe("cash");
    expect(normalizeExpenseMode("gpay")).toBe("upi");
    expect(normalizeExpenseMode("NEFT")).toBe("bank_transfer");
    expect(normalizeExpenseMode("bitcoin")).toBeNull();
  });
  test("dates", () => {
    expect(resolveExpenseDate("today", "2026-10-21")).toBe("2026-10-21");
    expect(resolveExpenseDate("yesterday", "2026-10-01")).toBe("2026-09-30");
    expect(resolveExpenseDate("2026-12-01", "2026-10-21")).toBeNull();
  });
  test("advance vs general", () => {
    expect(defaultExpenseType("housing", true)).toBe("general");
    expect(defaultExpenseType("salary advance", true)).toBe("salary_advance");
    expect(defaultExpenseType("advance", false)).toBe("general");
    expect(guessCategory("housing", true)).toBe("Rent or Mortgage");
  });
  test("only owner/admin/manager", () => {
    expect(canCaptureExpense("owner")).toBe(true);
    expect(canCaptureExpense("manager")).toBe(true);
    expect(canCaptureExpense("staff")).toBe(false);
    expect(canCaptureExpense("trainer")).toBe(false);
  });
});
