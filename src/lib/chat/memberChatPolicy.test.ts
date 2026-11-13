// @ts-expect-error bun test runtime
import { describe, expect, test } from "bun:test";
import { classifyMemberChat, canDo, blockedAiTools, type ChatFacts } from "../../../supabase/functions/_shared/memberChatPolicy";

const base: ChatFacts = {
  member_status: "active", login_disabled: false, today: "2026-11-13",
  membership_id: "m1", membership_status: "active", start_date: "2026-10-01", end_date: "2027-01-31",
  plan_name: "Quarterly", freeze_until: null, dues: 0,
};
const f = (o: Partial<ChatFacts>) => ({ ...base, ...o });

describe("member chat status", () => {
  test("active plan can book classes", () => {
    expect(classifyMemberChat(base)).toBe("active");
    expect(canDo("active", "classes")).toBe(true);
  });
  test("plan ending within 7 days is expiring", () => {
    expect(classifyMemberChat(f({ end_date: "2026-11-19" }))).toBe("expiring");
  });
  test("past end date is expired even if still marked active; no class booking", () => {
    expect(classifyMemberChat(f({ end_date: "2026-11-01" }))).toBe("expired");
    expect(canDo("expired", "classes")).toBe(false);
    expect(canDo("expired", "renew")).toBe(true);
  });
  test("frozen cannot book but can request resume", () => {
    const s = classifyMemberChat(f({ membership_status: "frozen" }));
    expect(s).toBe("frozen");
    expect(canDo(s, "recovery")).toBe(false);
    expect(canDo(s, "resume")).toBe(true);
    expect(blockedAiTools(s)).toContain("book_class");
  });
  test("pending plan with dues is unpaid start", () => {
    expect(classifyMemberChat(f({ membership_status: "pending", dues: 18000 }))).toBe("unpaid_start");
  });
  test("cancelled plan or none is no_plan", () => {
    expect(classifyMemberChat(f({ membership_status: "cancelled" }))).toBe("no_plan");
    expect(classifyMemberChat(f({ membership_id: null, membership_status: null }))).toBe("no_plan");
  });
  test("suspended, blacklisted or login disabled is blocked with no actions", () => {
    expect(classifyMemberChat(f({ member_status: "suspended" }))).toBe("blocked");
    expect(classifyMemberChat(f({ member_status: "blacklisted" }))).toBe("blocked");
    expect(classifyMemberChat(f({ login_disabled: true }))).toBe("blocked");
    expect(canDo("blocked", "human")).toBe(false);
    expect(blockedAiTools("blocked")).toEqual(["*"]);
  });
});
