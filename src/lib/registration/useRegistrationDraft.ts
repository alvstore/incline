// Autosaves the /register wizard to localStorage so a refresh, back-swipe or
// mobile tab reclaim never forces the member to re-type everything.
//
// Deliberately NOT persisted: government ID number, signature image, OTP code.
import { useEffect, useRef, useState } from "react";

const KEY = "incline_register_draft_v1";
const TTL_MS = 24 * 60 * 60 * 1000;

export interface RegistrationDraft {
  step: "details" | "parq" | "sign";
  values: Record<string, unknown>;
  parq: Record<string, string>;
  consents: Record<string, boolean>;
  healthConditions: string[];
  healthOther: string;
}

interface StoredDraft extends RegistrationDraft {
  saved_at: number;
}

export function readRegistrationDraft(): RegistrationDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    if (!parsed?.saved_at || Date.now() - parsed.saved_at > TTL_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    const { saved_at: _saved, ...draft } = parsed;
    return draft as RegistrationDraft;
  } catch {
    return null;
  }
}

export function clearRegistrationDraft() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage disabled — nothing to clean up */
  }
}

function sanitize(values: Record<string, unknown>): Record<string, unknown> {
  const out = { ...values };
  delete out.government_id_number;
  return out;
}

/**
 * Debounced autosave. Pass `enabled: false` once registration completes so the
 * final render doesn't write the draft back after we cleared it.
 */
export function useRegistrationDraftAutosave(draft: RegistrationDraft, enabled: boolean) {
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      try {
        const payload: StoredDraft = {
          ...draft,
          values: sanitize(draft.values),
          saved_at: Date.now(),
        };
        localStorage.setItem(KEY, JSON.stringify(payload));
      } catch {
        /* quota or private mode — autosave is best-effort */
      }
    }, 400);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [draft, enabled]);
}

/** Reads the draft once on mount (never re-reads, so typing isn't clobbered). */
export function useInitialRegistrationDraft() {
  const [draft] = useState<RegistrationDraft | null>(() => readRegistrationDraft());
  return draft;
}
