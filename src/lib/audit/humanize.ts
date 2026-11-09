/** Turns raw audit_logs rows into plain-language sentences and change lists. */

export interface AuditRowLike {
  action: string;
  table_name: string;
  actor_name?: string | null;
  user_id?: string | null;
  target_name?: string | null;
  action_description?: string | null;
  old_data?: Record<string, unknown> | null;
  new_data?: Record<string, unknown> | null;
}

export type ActionKind = 'create' | 'change' | 'delete' | 'event';

export function actionKind(action: string): ActionKind {
  if (action === 'INSERT') return 'create';
  if (action === 'UPDATE') return 'change';
  if (action === 'DELETE') return 'delete';
  return 'event';
}

const SPECIAL_TITLES: Record<string, string> = {
  CONTRACT_FIELDS_FILLED: 'filled in contract details',
  CONTRACT_SIGN_LINK_CREATED: 'created a contract signing link',
  CONTRACT_SIGNED: 'signed the contract',
  dr_standby_config_updated: 'updated the standby server settings',
  'health_brief.viewed': 'viewed the health brief',
  'health_guidance.generated': 'generated health guidance',
  gift_days_granted: 'granted gift days',
};

/** "CONTRACT_FIELDS_FILLED" / "health_brief.viewed" → readable verb phrase. */
export function specialActionLabel(action: string): string {
  if (SPECIAL_TITLES[action]) return SPECIAL_TITLES[action];
  return action.replace(/[._]+/g, ' ').toLowerCase().trim();
}

const ENTITY: Record<string, string> = {
  staff_attendance: 'attendance', member_attendance: 'check-in', member_pt_packages: 'PT package',
  pt_sessions: 'PT session', integration_settings: 'integration', user_roles: 'role',
  member_documents: 'document', benefit_bookings: 'facility booking', class_bookings: 'class booking',
  membership_free_days: 'gift days', invoices: 'invoice', payments: 'payment', memberships: 'membership',
  members: 'member', employees: 'employee', trainers: 'trainer', tasks: 'task', contracts: 'contract',
  leads: 'lead', lockers: 'locker', locker_assignments: 'locker assignment', expenses: 'expense',
};
export function entityLabel(table: string): string {
  return ENTITY[table] ?? table.replace(/_/g, ' ').replace(/s$/, '');
}

/** Who did it — never blank. */
export function actorLabel(row: AuditRowLike): string {
  if (row.actor_name && row.actor_name !== 'System') return row.actor_name.replace(/^System \((.+)\)$/, 'Automation ($1)');
  const src = String(row.new_data?.source ?? row.old_data?.source ?? '');
  if (src === 'gate') return 'Gate system';
  if (src === 'member_portal' || src.startsWith('app_')) return 'Member (self-service)';
  if (row.action.startsWith('CONTRACT_')) return 'Employee (signing link)';
  if (row.actor_name === 'System') return 'Automation';
  return row.user_id ? 'A team member' : 'Automation';
}

const HIDDEN = new Set(['id', 'created_at', 'updated_at', 'branch_id', 'search_vector', 'fts', 'embedding', 'last_seen_at', 'synced_at', 'last_synced_at']);
const NOISE = new Set(['updated_at', 'last_seen_at', 'synced_at', 'last_synced_at', 'last_event_at', 'heartbeat_at']);

const LABELS: Record<string, string> = {
  due_date: 'Due date', due_time: 'Due time', is_late: 'Late', check_in: 'Check-in', check_out: 'Check-out',
  check_in_time: 'Check-in', check_out_time: 'Check-out', full_name: 'Name', phone: 'Phone', email: 'Email',
  assigned_to: 'Assigned to', total_amount: 'Total', amount_paid: 'Paid', end_date: 'End date', start_date: 'Start date',
  expiry_date: 'Expiry date', sessions_remaining: 'Sessions left', sessions_total: 'Total sessions', is_active: 'Active',
  notice_period_days: 'Notice period (days)', base_salary: 'Base salary',
};
export function fieldLabel(key: string): string {
  if (LABELS[key]) return LABELS[key];
  const s = key.replace(/_id$/, '').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONEY = /(amount|price|salary|total|paid|due|fee|cost|balance)/i;

export function formatValue(key: string, v: unknown): { text: string; long?: boolean } {
  if (v === null || v === undefined || v === '') return { text: '—' };
  if (typeof v === 'boolean') return { text: v ? 'Yes' : 'No' };
  if (typeof v === 'number') return { text: MONEY.test(key) ? `₹${v.toLocaleString('en-IN')}` : v.toLocaleString('en-IN') };
  if (typeof v === 'string') {
    if (UUID.test(v)) return { text: 'linked record' };
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) {
      const d = new Date(v);
      if (!isNaN(d.getTime())) return { text: d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) };
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return { text: new Date(v + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) };
    if (/^[a-z_]+$/.test(v) && v.length < 30) return { text: v.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) };
    if (v.length > 120) return { text: v.slice(0, 120) + '…', long: true };
    return { text: v };
  }
  return { text: Array.isArray(v) ? `${v.length} item${v.length === 1 ? '' : 's'}` : 'details changed', long: true };
}

export interface FieldChange { key: string; label: string; before: string; after: string; long?: boolean; technical: boolean }

export function changeList(row: AuditRowLike): FieldChange[] {
  const o = row.old_data ?? {}; const n = row.new_data ?? {};
  const keys = new Set([...Object.keys(o), ...Object.keys(n)]);
  const out: FieldChange[] = [];
  keys.forEach((k) => {
    if (row.action === 'UPDATE' && JSON.stringify(o[k]) === JSON.stringify(n[k])) return;
    const val = row.action === 'DELETE' ? o[k] : n[k];
    if (row.action !== 'UPDATE' && (val === null || val === undefined || val === '')) return;
    const b = formatValue(k, o[k]); const a = formatValue(k, row.action === 'DELETE' ? undefined : n[k]);
    const technical = HIDDEN.has(k) || k.endsWith('_id') || (typeof val === 'string' && UUID.test(val));
    out.push({ key: k, label: fieldLabel(k), before: b.text, after: row.action === 'DELETE' ? b.text : a.text, long: a.long || b.long, technical });
  });
  return out.sort((x, y) => Number(x.technical) - Number(y.technical));
}

/** UPDATE where only bookkeeping timestamps changed. */
export function isNoise(row: AuditRowLike): boolean {
  if (row.action !== 'UPDATE' || !row.old_data || !row.new_data) return false;
  const changed = Object.keys({ ...row.old_data, ...row.new_data })
    .filter((k) => JSON.stringify(row.old_data![k]) !== JSON.stringify(row.new_data![k]));
  return changed.length === 0 || changed.every((k) => NOISE.has(k));
}

/** One plain-language sentence: "Rajat marked task X as Completed". */
export function sentence(row: AuditRowLike): { actor: string; verb: string; target: string } {
  const actor = actorLabel(row);
  const ent = entityLabel(row.table_name);
  const target = row.target_name || '';
  const kind = actionKind(row.action);
  if (kind === 'event') return { actor, verb: specialActionLabel(row.action) + (target ? ' for' : ''), target };
  if (kind === 'create') {
    if (row.table_name === 'staff_attendance') return { actor, verb: 'checked in', target };
    return { actor, verb: `created ${ent}`, target };
  }
  if (kind === 'delete') return { actor, verb: `deleted ${ent}`, target };
  const o = row.old_data ?? {}; const n = row.new_data ?? {};
  if ('status' in n && o.status !== n.status) {
    return { actor, verb: `marked ${ent}`, target: `${target ? target + ' ' : ''}as ${formatValue('status', n.status).text}` };
  }
  if (row.table_name === 'staff_attendance' && !o.check_out && (n.check_out || n.check_out_time)) return { actor, verb: 'checked out', target };
  const visible = changeList(row).filter((c) => !c.technical);
  const what = visible.slice(0, 2).map((c) => c.label.toLowerCase()).join(' and ');
  return { actor, verb: `changed ${what ? what + ' on ' : ''}${ent}`, target };
}

export function sentenceText(row: AuditRowLike): string {
  const s = sentence(row);
  return [s.actor, s.verb, s.target].filter(Boolean).join(' ');
}
