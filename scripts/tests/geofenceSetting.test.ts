import { describe, expect, test } from "bun:test";
import { isGeofenceEffective } from "../../src/lib/registration/geofenceSetting";

describe("registration location check switch", () => {
  const now = new Date("2026-10-21T16:00:00Z");
  test("no setting means the check is on", () => expect(isGeofenceEffective(null, now)).toBe(true));
  test("switched off with no end stays off", () => expect(isGeofenceEffective({ enabled: false }, now)).toBe(false));
  test("switched off until later is off", () =>
    expect(isGeofenceEffective({ enabled: false, disabled_until: "2026-10-21T17:00:00Z" }, now)).toBe(false));
  test("expired switch-off turns the check back on", () =>
    expect(isGeofenceEffective({ enabled: false, disabled_until: "2026-10-21T15:00:00Z" }, now)).toBe(true));
});
