// @ts-expect-error bun test runner types
import { expect, test } from "bun:test";
import { buildCsp, CSP_DIRECTIVES } from "./contentSecurityPolicy";

test("CSP keeps backend, realtime, payments and fonts working", () => {
  expect(CSP_DIRECTIVES["connect-src"]).toContain("https://*.supabase.co");
  expect(CSP_DIRECTIVES["connect-src"]).toContain("wss://*.supabase.co");
  expect(CSP_DIRECTIVES["script-src"]).toContain("https://checkout.razorpay.com");
  expect(CSP_DIRECTIVES["frame-src"]).toContain("https://*.razorpay.com");
  expect(CSP_DIRECTIVES["font-src"]).toContain("'self'");
});

test("CSP blocks plugins and base-tag hijacking", () => {
  const csp = buildCsp();
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'self'");
  expect(csp).not.toContain("'unsafe-eval'");
});

test("CSP allows the body-scan 3D model storage host", () => {
  expect(CSP_DIRECTIVES["connect-src"]).toContain("https://howbody-haidiobj.s3.eu-central-1.amazonaws.com");
});
