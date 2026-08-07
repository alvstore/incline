// Lightweight session-scoped store for in-progress plan drafts shared between
// the create/build pages and the preview page. Drafts are NOT persisted
// across browser sessions.
//
// Storage strategy (v2):
//  1. Always keep the draft in an in-memory map — client-side navigation never
//     loses it, even when sessionStorage refuses the write (quota, privacy mode).
//  2. Mirror to sessionStorage so a hard refresh of the preview page still works.
//  3. Prune older drafts and retry once when the quota is hit, and verify the
//     write by reading it back. Callers get a boolean so they can surface a real
//     error instead of navigating to a stale draft.

const DRAFT_PREFIX = 'fitness-plan-draft:';

export interface PlanAudience {
  target_age_min?: number | null;
  target_age_max?: number | null;
  target_gender?: 'any' | 'male' | 'female';
  target_weight_min_kg?: number | null;
  target_weight_max_kg?: number | null;
  target_bmi_min?: number | null;
  target_bmi_max?: number | null;
  target_goal?: string | null;
  target_experience?: string[];
  duration_weeks?: number | null;
  days_per_week?: number | null;
}

export interface PlanDraft {
  id: string;
  source: 'ai' | 'manual-workout' | 'manual-diet';
  type: 'workout' | 'diet';
  name: string;
  description?: string;
  goal?: string;
  difficulty?: string;
  caloriesTarget?: number;
  memberId?: string;
  memberName?: string;
  memberCode?: string;
  // Per-plan member profile snapshot (overrides applied)
  memberProfile?: Record<string, any>;
  // Cuisine + dietary type for diet plans
  cuisine?: string;
  dietaryType?: string;
  /** Workout sessions per week (1-7). Persisted on draft so preview/save can show it. */
  daysPerWeek?: number;
  /** If > 0, the plan rotates exercise variants every N days. */
  rotationIntervalDays?: number;
  // The actual plan content payload (weeks/days/exercises or meals)
  content: any;
  /** Marks an audience-targeted Common (no-PT) plan — saved as is_common = true. */
  isCommon?: boolean;
  audience?: PlanAudience;
  /** Optional id of the originating template — preserved through the
   * preview/assign flow so member assignments can back-reference it. */
  templateId?: string;
  createdAt: string;
}

/** In-memory mirror — the source of truth for the current SPA session. */
const memoryDrafts = new Map<string, PlanDraft>();

export function newDraftId() {
  return `pd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Strip payload that must never be needed to render the preview. */
function slim(draft: PlanDraft): PlanDraft {
  const json = JSON.stringify(draft, (key, value) =>
    // Inline data URLs (uploaded video/image previews) blow the storage quota
    // and are re-resolved from storage paths when rendering.
    typeof value === 'string' && value.startsWith('data:') && value.length > 2048
      ? undefined
      : value,
  );
  return JSON.parse(json) as PlanDraft;
}

function storageKeys(): string[] {
  const out: string[] = [];
  for (let i = 0; i < sessionStorage.length; i += 1) {
    const k = sessionStorage.key(i);
    if (k && k.startsWith(DRAFT_PREFIX)) out.push(k);
  }
  return out;
}

/** Drop the oldest stored drafts (keeping `keep` newest) to free quota. */
function prune(keepId: string, keep = 3) {
  const entries = storageKeys()
    .filter((k) => k !== DRAFT_PREFIX + keepId)
    .map((k) => {
      let createdAt = '';
      try {
        createdAt = JSON.parse(sessionStorage.getItem(k) || '{}')?.createdAt || '';
      } catch {
        /* corrupt entry — treat as oldest */
      }
      return { k, createdAt };
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const removeCount = Math.max(0, entries.length - (keep - 1));
  entries.slice(0, removeCount).forEach((e) => {
    try { sessionStorage.removeItem(e.k); } catch { /* ignore */ }
  });
}

/**
 * Persist a draft. Returns true when the draft is retrievable afterwards
 * (memory always counts). Callers should only navigate on true.
 */
export function saveDraft(draft: PlanDraft): boolean {
  const payload = slim(draft);
  memoryDrafts.set(payload.id, payload);

  const key = DRAFT_PREFIX + payload.id;
  const write = () => {
    sessionStorage.setItem(key, JSON.stringify(payload));
    return sessionStorage.getItem(key) !== null;
  };

  try {
    if (write()) return true;
  } catch {
    // Quota or privacy mode — free space and retry once.
    prune(payload.id);
    try {
      if (write()) return true;
    } catch {
      /* fall through to memory-only */
    }
  }

  // Memory fallback still lets the in-app preview render correctly.
  return memoryDrafts.has(payload.id);
}

export function loadDraft(id: string): PlanDraft | null {
  const inMemory = memoryDrafts.get(id);
  if (inMemory) return inMemory;
  try {
    const raw = sessionStorage.getItem(DRAFT_PREFIX + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlanDraft;
    memoryDrafts.set(id, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraft(id: string) {
  memoryDrafts.delete(id);
  try {
    sessionStorage.removeItem(DRAFT_PREFIX + id);
  } catch {
    // ignore
  }
}
