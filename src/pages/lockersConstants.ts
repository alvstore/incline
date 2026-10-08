// Shared locker constants/helpers, split out of Lockers.tsx so that file only
// exports the page component (react-refresh/only-export-components).

export const ZONE_OPTIONS = [
  { value: 'male', label: 'Male room' },
  { value: 'female', label: 'Female room' },
  { value: 'common', label: 'Common area' },
] as const;

export const zoneLabel = (z?: string | null) =>
  ZONE_OPTIONS.find((o) => o.value === z)?.label ?? 'Common area';
