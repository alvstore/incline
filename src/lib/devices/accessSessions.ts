/**
 * Access-feed session grouping.
 *
 * MIPS pushes one row per face/card scan, so the raw feed repeats the same
 * person many times a day ("already checked in", unmatched VISITOR imports…).
 * This module collapses those raw events into one presence row per person per
 * day, with a punch trail, so the UI can show *who is in the gym* instead of a
 * tape of duplicate scans.
 *
 * Pure functions only — no React, no Supabase.
 */

export interface RawAccessEvent {
  id: string;
  device_sn: string;
  event_type: string;
  result: string | null;
  message: string | null;
  member_id: string | null;
  profile_id: string | null;
  branch_id: string | null;
  payload: Record<string, unknown> | null;
  captured_at: string | null;
  created_at: string;
  source?: 'webhook' | 'mips';
  members?: {
    id: string;
    member_code: string;
    biometric_photo_url: string | null;
    profiles: { full_name: string; avatar_url: string | null } | null;
    memberships: Array<{ status: string; end_date: string; membership_plans: { name: string } | null }>;
  } | null;
  profiles?: { full_name: string | null; avatar_url: string | null } | null;
}

export type PersonKind = 'member' | 'staff' | 'trainer' | 'unmatched' | 'denied';

export interface Punch {
  id: string;
  at: string;
  gate: string;
  deviceSn: string;
  result: string | null;
  message: string | null;
  source: 'webhook' | 'mips';
  payload: Record<string, unknown> | null;
  /** repeat scans collapsed into this punch */
  count: number;
}

export interface PersonSession {
  key: string;
  name: string;
  code: string | null;
  kind: PersonKind;
  avatarUrl: string | null;
  memberId: string | null;
  profileId: string | null;
  memberships: Array<{ status: string; end_date: string; membership_plans: { name: string } | null }> | undefined;
  punches: Punch[];
  firstAt: string;
  lastAt: string;
  scanCount: number;
  /** minutes between first and last scan of the day */
  onSiteMinutes: number;
  /** last scan is recent enough that the person is presumed inside */
  isInside: boolean;
  denied: boolean;
  /** distinct informational messages (e.g. "Member is already checked in") */
  notes: string[];
}

export interface SystemAction {
  id: string;
  at: string;
  result: string | null;
  message: string | null;
  memberId: string | null;
  eventType: string;
}

export interface GroupedAccessFeed {
  people: PersonSession[];
  unmatched: PersonSession[];
  systemActions: SystemAction[];
  insideCount: number;
}

/** Scans of the same person closer than this collapse into one punch. */
const PUNCH_MERGE_MS = 3 * 60_000;
/** A person whose last scan is newer than this is presumed still inside. */
const PRESUMED_INSIDE_MS = 120 * 60_000;

const DENIED_RESULTS = new Set(['member_denied', 'not_found', 'stranger']);
/** CRM-originated bookkeeping rows — not gate traffic. */
const SYSTEM_DEVICE = 'CRM-SYSTEM';
const SYSTEM_EVENTS = new Set(['hardware_revoke', 'hardware_restore']);

function eventTime(e: RawAccessEvent): string {
  return e.captured_at || e.created_at;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function personKind(e: RawAccessEvent): PersonKind {
  if (e.result === 'trainer') return 'trainer';
  if (e.result === 'staff') return 'staff';
  if (e.member_id) return 'member';
  if (DENIED_RESULTS.has(e.result || '')) return 'denied';
  if (e.profile_id) return 'staff';
  return 'unmatched';
}

function displayName(e: RawAccessEvent): string {
  return (
    e.members?.profiles?.full_name ||
    e.profiles?.full_name ||
    str(e.payload?.personName) ||
    str(e.payload?.person_no) ||
    'Unknown person'
  );
}

function identityKey(e: RawAccessEvent): string {
  if (e.member_id) return `m:${e.member_id}`;
  if (e.profile_id) return `p:${e.profile_id}`;
  const sn = str(e.payload?.personSn) || str(e.payload?.person_no);
  if (sn) return `sn:${sn}`;
  return `n:${displayName(e).toLowerCase()}`;
}

export function groupAccessEvents(
  events: RawAccessEvent[],
  now: number = Date.now(),
): GroupedAccessFeed {
  const systemActions: SystemAction[] = [];
  const buckets = new Map<string, PersonSession>();

  // Oldest first so punch trails read left-to-right in time order.
  const ordered = [...events].sort(
    (a, b) => new Date(eventTime(a)).getTime() - new Date(eventTime(b)).getTime(),
  );

  for (const e of ordered) {
    if (e.device_sn === SYSTEM_DEVICE || SYSTEM_EVENTS.has(e.event_type)) {
      systemActions.push({
        id: e.id,
        at: eventTime(e),
        result: e.result,
        message: e.message,
        memberId: e.member_id,
        eventType: e.event_type,
      });
      continue;
    }

    const key = identityKey(e);
    const at = eventTime(e);
    const punch: Punch = {
      id: e.id,
      at,
      gate: str(e.payload?.deviceName) || e.device_sn,
      deviceSn: e.device_sn,
      result: e.result,
      message: e.message,
      source: e.source ?? 'webhook',
      payload: e.payload,
      count: 1,
    };

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        key,
        name: displayName(e),
        code: e.members?.member_code || str(e.payload?.personSn) || str(e.payload?.person_no),
        kind: personKind(e),
        avatarUrl:
          e.members?.biometric_photo_url ||
          e.members?.profiles?.avatar_url ||
          e.profiles?.avatar_url ||
          null,
        memberId: e.member_id,
        profileId: e.profile_id,
        memberships: e.members?.memberships,
        punches: [],
        firstAt: at,
        lastAt: at,
        scanCount: 0,
        onSiteMinutes: 0,
        isInside: false,
        denied: false,
        notes: [],
      };
      buckets.set(key, bucket);
    }

    // Prefer a resolved identity if a later event carries one.
    if (!bucket.memberId && e.member_id) bucket.memberId = e.member_id;
    if (!bucket.profileId && e.profile_id) bucket.profileId = e.profile_id;
    if (bucket.kind === 'unmatched' && personKind(e) !== 'unmatched') bucket.kind = personKind(e);
    if (!bucket.memberships && e.members?.memberships) bucket.memberships = e.members.memberships;

    const last = bucket.punches[bucket.punches.length - 1];
    if (
      last &&
      last.result === punch.result &&
      new Date(at).getTime() - new Date(last.at).getTime() < PUNCH_MERGE_MS
    ) {
      last.count += 1;
      last.at = at;
    } else {
      bucket.punches.push(punch);
    }

    bucket.scanCount += 1;
    bucket.lastAt = at;
    if (DENIED_RESULTS.has(e.result || '')) bucket.denied = true;
    if (e.message && !bucket.notes.includes(e.message)) bucket.notes.push(e.message);
  }

  const all = [...buckets.values()].map((b) => {
    const span = new Date(b.lastAt).getTime() - new Date(b.firstAt).getTime();
    return {
      ...b,
      onSiteMinutes: Math.max(0, Math.round(span / 60_000)),
      isInside: !b.denied && now - new Date(b.lastAt).getTime() < PRESUMED_INSIDE_MS,
    };
  });

  all.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());

  return {
    people: all.filter((p) => p.kind !== 'unmatched'),
    unmatched: all.filter((p) => p.kind === 'unmatched'),
    systemActions: systemActions.sort(
      (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
    ),
    insideCount: all.filter((p) => p.isInside).length,
  };
}

export function formatOnSite(minutes: number): string {
  if (minutes < 1) return 'just arrived';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
