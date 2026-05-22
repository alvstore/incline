// Tiny 5-field cron helpers (UTC). Shared by Automation Brain UI.

function parseField(field: string, min: number, max: number): number[] {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    let step = 1;
    let range = part;
    if (part.includes('/')) {
      const [r, s] = part.split('/');
      range = r;
      step = parseInt(s, 10) || 1;
    }
    let from = min, to = max;
    if (range === '*' || range === '') {
      from = min; to = max;
    } else if (range.includes('-')) {
      const [a, b] = range.split('-').map((x) => parseInt(x, 10));
      from = a; to = b;
    } else {
      const v = parseInt(range, 10);
      from = v; to = v;
    }
    for (let i = from; i <= to; i += step) out.add(i);
  }
  return [...out].sort((a, b) => a - b);
}

export function describeCron(expr: string): string {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) return expr;
  const [m, h, dom, mon, dow] = p;
  if (m === '*' && h === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every minute';
  if (m.startsWith('*/') && h === '*' && dom === '*' && mon === '*' && dow === '*')
    return `Every ${m.slice(2)} minutes`;
  if (h === '*' && dom === '*' && mon === '*' && dow === '*') return `At minute ${m} of every hour`;
  if (h.startsWith('*/') && dom === '*' && mon === '*' && dow === '*')
    return `Every ${h.slice(2)} hours at :${m.padStart(2, '0')}`;
  if (dom === '*' && mon === '*' && dow === '*')
    return `Every day at ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} UTC`;
  return expr;
}

export function nextRuns(expr: string, after: Date, count = 3): Date[] {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return [];
  const [mF, hF, domF, monF, dowF] = parts;
  const mins = parseField(mF, 0, 59);
  const hrs = parseField(hF, 0, 23);
  const doms = parseField(domF, 1, 31);
  const mons = parseField(monF, 1, 12);
  const dows = parseField(dowF, 0, 6);

  const result: Date[] = [];
  const t = new Date(after.getTime() + 60 * 1000);
  t.setSeconds(0, 0);
  for (let i = 0; i < 366 * 24 * 60 && result.length < count; i++) {
    if (
      mons.includes(t.getUTCMonth() + 1) &&
      doms.includes(t.getUTCDate()) &&
      dows.includes(t.getUTCDay()) &&
      hrs.includes(t.getUTCHours()) &&
      mins.includes(t.getUTCMinutes())
    ) {
      result.push(new Date(t));
    }
    t.setUTCMinutes(t.getUTCMinutes() + 1);
  }
  return result;
}

export const CRON_PRESETS = [
  { label: 'Every minute', value: '* * * * *' },
  { label: 'Every 5 minutes', value: '*/5 * * * *' },
  { label: 'Every 15 minutes', value: '*/15 * * * *' },
  { label: 'Every 30 minutes', value: '*/30 * * * *' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Daily at 8:00 AM UTC', value: '0 8 * * *' },
  { label: 'Daily at 9:30 AM UTC', value: '30 9 * * *' },
  { label: 'Daily at 9:00 PM UTC', value: '0 21 * * *' },
];
