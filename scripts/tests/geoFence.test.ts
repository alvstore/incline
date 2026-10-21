import { describe, expect, test } from "bun:test";
import { CLUB_LOCATION, distanceMeters, isInsideClub } from "../../src/lib/registration/geoFence";

describe("in-club registration fence (200 m, Sector 14 Udaipur)", () => {
  test("standing at the club is inside", () => {
    expect(isInsideClub(CLUB_LOCATION)).toBe(true);
  });
  test("~150 m away is inside", () => {
    expect(isInsideClub({ lat: CLUB_LOCATION.lat + 0.00135, lng: CLUB_LOCATION.lng })).toBe(true);
  });
  test("~1 km away (at home) is outside", () => {
    const p = { lat: CLUB_LOCATION.lat + 0.009, lng: CLUB_LOCATION.lng };
    expect(Math.round(distanceMeters(p, CLUB_LOCATION) / 100)).toBe(10);
    expect(isInsideClub(p)).toBe(false);
  });
  test("poor accuracy cannot stretch the fence beyond 300 m", () => {
    expect(isInsideClub({ lat: CLUB_LOCATION.lat + 0.0036, lng: CLUB_LOCATION.lng }, 5000)).toBe(false);
  });
});
