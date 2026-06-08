// First-touch attribution: persists the original referrer + UTMs of the visit
// so leads aren't misattributed to "website" after SPA navigation.
//
// Model: last-non-direct wins (GA-style). A new visit with UTMs OR an external
// referrer overwrites the stored record; direct/same-origin navigations don't.
// TTL: 30 days.

import { deriveLeadSource } from './sourceFromReferrer';

const STORAGE_KEY = 'incline_first_touch_v1';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

const SAME_ORIGIN_HOSTS = [
  'theincline.in',
  'www.theincline.in',
  'incline.lovable.app',
  'localhost',
  '127.0.0.1',
];

export interface FirstTouch {
  source: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  landing_page: string | null;
  referrer_url: string | null;
  captured_at: string;
}

function isSameOriginRef(ref: string): boolean {
  if (!ref) return true;
  try {
    const u = new URL(ref);
    return SAME_ORIGIN_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.lovable.app'));
  } catch {
    return false;
  }
}

function readStored(): FirstTouch | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FirstTouch;
    if (!parsed?.captured_at) return null;
    if (Date.now() - new Date(parsed.captured_at).getTime() > TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(ft: FirstTouch) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ft));
  } catch {
    /* quota / private mode — silent */
  }
}

/**
 * Capture the current page's first-touch attribution.
 * Idempotent within TTL; only overwrites when the new visit is "non-direct"
 * (has UTMs or an external referrer).
 */
export function captureFirstTouch(): FirstTouch | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const utm_source = params.get('utm_source') || null;
    const utm_medium = params.get('utm_medium') || null;
    const utm_campaign = params.get('utm_campaign') || null;
    const utm_content = params.get('utm_content') || null;
    const utm_term = params.get('utm_term') || null;

    const rawRef = typeof document !== 'undefined' ? document.referrer || '' : '';
    const externalRef = rawRef && !isSameOriginRef(rawRef) ? rawRef : null;
    const isNonDirect = Boolean(utm_source || externalRef);

    const existing = readStored();
    if (existing && !isNonDirect) return existing; // keep prior attribution

    const source = deriveLeadSource(utm_source, externalRef, existing?.source || 'website');

    const ft: FirstTouch = {
      source,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,
      landing_page: `${window.location.origin}${window.location.pathname}${window.location.search}`,
      referrer_url: externalRef,
      captured_at: new Date().toISOString(),
    };

    if (!existing || isNonDirect) writeStored(ft);
    return ft;
  } catch {
    return null;
  }
}

export function getFirstTouch(): FirstTouch | null {
  return readStored();
}
