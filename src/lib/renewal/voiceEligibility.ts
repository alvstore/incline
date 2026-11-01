/** Mirrors the renewal binding trigger; human-owned cases stay with staff. */
export function renewalVoiceBlockReason(row: {
  claimed_by: string | null;
  stage: string;
  voice_attempts_count: number;
}): string | null {
  if (row.voice_attempts_count >= 3) return 'Call budget used (3 calls). Follow up in person.';
  if (row.claimed_by) return 'This case is claimed by staff. Follow up personally or release it after review.';
  if (!['eligible', 'reminding', 'lapsed', 'win_back', 'voice_escalation'].includes(row.stage)) {
    return 'This case requires staff review; AI calling is paused.';
  }
  return null;
}