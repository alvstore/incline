import { assertEquals } from "jsr:@std/assert@1";
import { PT_REMINDER_ACTION_URLS, hasSuccessor, normalizePtSettings, ptReminderMark, type PtPkg } from "./ptExpiry.ts";

Deno.test("trainer reminders open the trainer-authorized client list", () => {
  assertEquals(PT_REMINDER_ACTION_URLS.trainer, "/my-clients");
});
Deno.test("manager reminders retain the staff PT client workspace", () => {
  assertEquals(PT_REMINDER_ACTION_URLS.manager, "/pt-sessions?tab=clients");
});
Deno.test("member reminders retain the member PT workspace", () => {
  assertEquals(PT_REMINDER_ACTION_URLS.member, "/my-pt-sessions");
});

const pkg = (o: Partial<PtPkg>): PtPkg => ({ id: "a", member_id: "m", status: "active", expiry_date: "2026-11-16", sessions_total: 0, sessions_remaining: 0, ...o });

Deno.test("expiry day-mark matches cadence", () => {
  assertEquals(ptReminderMark(pkg({}), "2026-11-09", [7, 3], 2), "d7");
  assertEquals(ptReminderMark(pkg({}), "2026-11-10", [7, 3], 2), null);
});
Deno.test("low sessions triggers for session packages", () => {
  assertEquals(ptReminderMark(pkg({ sessions_total: 12, sessions_remaining: 2 }), "2026-11-01", [7], 2), "low");
  assertEquals(ptReminderMark(pkg({ sessions_total: 12, sessions_remaining: 5 }), "2026-11-01", [7], 2), null);
});
Deno.test("successor suppresses reminder", () => {
  const old = pkg({});
  const next = pkg({ id: "b", start_date: undefined, expiry_date: "2027-02-01" } as Partial<PtPkg>);
  assertEquals(hasSuccessor(old, [old, next]), true);
  assertEquals(hasSuccessor(old, [old]), false);
});
Deno.test("settings default safely", () => {
  const s = normalizePtSettings(null);
  assertEquals(s.audiences.member.channels, ["notification"]);
  assertEquals(s.audiences.manager.enabled, false);
});
