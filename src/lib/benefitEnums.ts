// Known valid values for the benefit_type database enum.
// Custom benefit types use 'other' as fallback; the actual link is via benefit_type_id (UUID).
export const KNOWN_BENEFIT_ENUMS = new Set([
  'gym_access', 'pool_access', 'sauna_access', 'steam_access', 'group_classes',
  'pt_sessions', 'locker', 'towel', 'parking', 'guest_pass', 'other', 'ice_bath',
  'yoga_class', 'crossfit_class', 'spa_access', 'sauna_session', 'cardio_area', 'functional_training',
  'body_scan', 'posture_scan',
]);

/**
 * benefit_types.code values are free-form (admins create them), so they often do
 * not match the database enum. Map the known catalog codes onto valid enum values
 * before writing to any `benefit_type` column.
 */
export const BENEFIT_CODE_ALIASES: Record<string, string> = {
  sauna: 'sauna_access',
  sauna_therapy: 'sauna_access',
  steam: 'steam_access',
  steam_room: 'steam_access',
  ice_bath_f: 'ice_bath',
  cold_plunge: 'ice_bath',
  '3d_body_scanning': 'body_scan',
  body_scanning: 'body_scan',
  body_composition: 'body_scan',
  posture: 'posture_scan',
  posture_scanning: 'posture_scan',
  locker_access: 'locker',
  pool: 'pool_access',
  spa: 'spa_access',
  gym: 'gym_access',
  classes: 'group_classes',
  pt: 'pt_sessions',
};

/** Strips the merge suffix admins get from de-duplicated types, e.g. `sauna_f_merged_2026...`. */
function normalizeCode(code: string): string {
  return (code || '')
    .toLowerCase()
    .trim()
    .replace(/_merged_\d+$/, '')
    .replace(/_(f|m|female|male)$/, '');
}

export function safeBenefitEnum(code: string): string {
  const raw = (code || '').toLowerCase().trim();
  if (KNOWN_BENEFIT_ENUMS.has(raw)) return raw;
  if (BENEFIT_CODE_ALIASES[raw]) return BENEFIT_CODE_ALIASES[raw];

  const normalized = normalizeCode(raw);
  if (KNOWN_BENEFIT_ENUMS.has(normalized)) return normalized;
  if (BENEFIT_CODE_ALIASES[normalized]) return BENEFIT_CODE_ALIASES[normalized];

  return 'other';
}
