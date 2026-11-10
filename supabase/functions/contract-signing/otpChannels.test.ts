import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { availableChannels, deliveryOrder, dispatchSucceeded } from "./otpChannels.ts";

Deno.test("SMS hidden when no SMS provider is active", () => {
  assertEquals(availableChannels({ hasPhone: true, hasEmail: true, whatsappTemplateApproved: true, smsProviderActive: false }), ["whatsapp", "email"]);
});

Deno.test("WhatsApp hidden without an approved template", () => {
  assertEquals(availableChannels({ hasPhone: true, hasEmail: true, whatsappTemplateApproved: false, smsProviderActive: false }), ["email"]);
});

Deno.test("requested channel first, others as fallback", () => {
  assertEquals(deliveryOrder("whatsapp", ["whatsapp", "email"]), ["whatsapp", "email"]);
  assertEquals(deliveryOrder("sms", ["whatsapp", "email"]), ["whatsapp", "email"]);
});

Deno.test("suppressed/failed dispatch is not success", () => {
  assertEquals(dispatchSucceeded({ status: "suppressed" }), false);
  assertEquals(dispatchSucceeded({ status: "failed" }), false);
  assertEquals(dispatchSucceeded(null), false);
  assertEquals(dispatchSucceeded({ status: "sent" }), true);
});
