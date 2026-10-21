export interface GeofenceSettingValue {
  enabled?: boolean;
  disabled_until?: string | null;
}

/** Mirrors get_registration_geofence(): an expired temporary switch-off means the check is back on. */
export function isGeofenceEffective(v: GeofenceSettingValue | null | undefined, now: Date = new Date()): boolean {
  if (!v || v.enabled !== false) return true;
  if (v.disabled_until && new Date(v.disabled_until).getTime() <= now.getTime()) return true;
  return false;
}

export const GEOFENCE_CACHE_KEY = "incline.registrationGeofence";
