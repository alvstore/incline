export interface DraftSlip { id: string; user_id: string; final_net: number; period_start: string; name: string }
export interface DraftMonthGroup { month: string; slips: DraftSlip[]; total: number }

/** Group unpaid slips by yyyy-MM, newest month first, with totals. */
export function groupDraftSlips(slips: DraftSlip[]): DraftMonthGroup[] {
  const map = new Map<string, DraftSlip[]>();
  for (const s of slips) {
    const m = s.period_start.slice(0, 7);
    map.set(m, [...(map.get(m) ?? []), s]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, list]) => ({
      month,
      slips: [...list].sort((a, b) => a.name.localeCompare(b.name)),
      total: Math.round(list.reduce((t, s) => t + (Number(s.final_net) || 0), 0) * 100) / 100,
    }));
}
