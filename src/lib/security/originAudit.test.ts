import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
import { isAllowedOrigin } from "./originAudit";
describe("CSP allowlist", () => {
  it("allows backend, Razorpay and own site", () => {
    expect(isAllowedOrigin("https://iyqqpbvnszyrrgerniog.supabase.co", "https://theincline.in")).toBe(true);
    expect(isAllowedOrigin("https://checkout.razorpay.com", "https://theincline.in")).toBe(true);
    expect(isAllowedOrigin("https://www.theincline.in", "https://theincline.in")).toBe(true);
  });
  it("flags unknown origins", () => {
    expect(isAllowedOrigin("https://evil.example.com", "https://theincline.in")).toBe(false);
  });
});
