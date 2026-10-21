/** Sector 14, Udaipur club entrance. Registration is in-club only. */
export const CLUB_LOCATION = { lat: 24.546845, lng: 73.701003 } as const;
export const CLUB_RADIUS_METERS = 200;

/** Great-circle distance in metres (Haversine). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function isInsideClub(pos: { lat: number; lng: number }, accuracy = 0): boolean {
  // Generous for GPS jitter: count the reading as inside when its accuracy circle touches the fence (capped at 100 m).
  return distanceMeters(pos, CLUB_LOCATION) - Math.min(accuracy, 100) <= CLUB_RADIUS_METERS;
}
