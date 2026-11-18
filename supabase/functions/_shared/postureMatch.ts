// Pure rule: attribute an unlinked posture push to the member who bound the
// same scanner recently — only when exactly one member matches.
export const POSTURE_MATCH_WINDOW_MIN = 30;
export interface SessionLite { member_id: string | null; equipment_no: string | null; created_at: string; status: string; kinds?: string[] | null }
export function pickPostureMember(sessions: SessionLite[], equipmentNo: string | null | undefined, now: Date = new Date()): string | null {
  if (!equipmentNo) return null;
  const cutoff = now.getTime() - POSTURE_MATCH_WINDOW_MIN * 60_000;
  const ids = new Set<string>();
  for (const s of sessions) {
    if (!s.member_id || s.equipment_no !== equipmentNo) continue;
    if (!["bound", "completed"].includes(s.status)) continue;
    if (s.kinds && !s.kinds.includes("posture")) continue;
    const t = new Date(s.created_at).getTime();
    if (!(t >= cutoff && t <= now.getTime())) continue;
    ids.add(s.member_id);
  }
  return ids.size === 1 ? [...ids][0] : null;
}
