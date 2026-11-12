import { assert, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isFeedbackMessage } from "../_shared/whatsapp-member-menu.ts";

Deno.test("trainer complaint escalates", () => {
  assert(isFeedbackMessage("Off hours trainer is completely helpless. Whole time he sits at cafe or yoga room, highly disappointing"));
});
Deno.test("short Hinglish complaint escalates", () => assert(isFeedbackMessage("trainer bahut bekar hai")));
Deno.test("menu words keep routing", () => {
  for (const t of ["yoga", "book a class", "my trainer", "Workout plan", "front desk"]) assertFalse(isFeedbackMessage(t));
});
