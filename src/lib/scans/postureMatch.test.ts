// @ts-expect-error -- bun's built-in test runner has no types in the app build
import { describe, it, expect } from "bun:test";
import { pickPostureMember } from "../../../supabase/functions/_shared/postureMatch";
const now = new Date("2026-11-18T15:10:00Z");
const s = (member_id: string, minsAgo: number, extra: Record<string, unknown> = {}) => ({ member_id, equipment_no: "HD1", status: "completed", created_at: new Date(now.getTime() - minsAgo * 60000).toISOString(), ...extra });
describe("pickPostureMember", () => {
  it("assigns when one member used the scanner in the last 30 min", () => expect(pickPostureMember([s("a", 10)], "HD1", now)).toBe("a"));
  it("rejects when nobody used it in 30 min", () => expect(pickPostureMember([s("a", 31)], "HD1", now)).toBeNull());
  it("rejects when two members used it", () => expect(pickPostureMember([s("a", 5), s("b", 20)], "HD1", now)).toBeNull());
  it("ignores other scanners", () => expect(pickPostureMember([s("a", 5, { equipment_no: "X" })], "HD1", now)).toBeNull());
  it("skips sessions not covering posture", () => expect(pickPostureMember([s("a", 5, { kinds: ["body"] })], "HD1", now)).toBeNull());
});
