/** Shared row shapes for the PT Sessions surface. */

export interface PTSessionRow {
  id: string;
  scheduled_at: string;
  member_name?: string | null;
  member_avatar_url?: string | null;
  trainer_id?: string | null;
  duration_minutes?: number | null;
  status: string;
}

export interface PTMemberPackageRow {
  id: string;
  member_id?: string | null;
  member_name?: string | null;
  member_code?: string | null;
  member_avatar_url?: string | null;
  package_name?: string | null;
  package_type?: string | null;
  trainer_id?: string | null;
  trainer_name?: string | null;
  trainer_avatar_url?: string | null;
  dues_amount?: number | null;
  branch_id?: string | null;
  sessions_total?: number | null;
  sessions_remaining?: number | null;
  start_date?: string | null;
  created_at?: string | null;
  expiry_date: string;
  status?: string | null;
  price_paid?: number | null;
  invoice_id?: string | null;
  invoice_number?: string | null;
}


export interface PTPackageRow {
  id: string;
  name: string;
  description?: string | null;
  session_type?: string | null;
  total_sessions?: number | null;
  validity_days?: number | null;
  price?: number | null;
  is_active?: boolean | null;
}

export interface TrainerRevenueRow {
  name: string;
  avatarUrl?: string | null;
  revenue: number;
  clients: number;
}

export function initialsOf(name: string | null | undefined): string {
  if (!name) return '–';
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase() || name[0]?.toUpperCase() || '–';
}

const AVATAR_PALETTE = [
  'bg-primary/15 text-primary',
  'bg-success/15 text-success',
  'bg-warning/15 text-warning',
  'bg-info/15 text-info',
  'bg-destructive/15 text-destructive',
];

export function avatarColor(name: string | null | undefined): string {
  const s = name || '?';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

export function formatINR(value: number): string {
  if (value >= 1_00_000) return `₹${(value / 1_00_000).toFixed(1)}L`;
  if (value >= 1_000) return `₹${(value / 1_000).toFixed(1)}k`;
  return `₹${value.toLocaleString('en-IN')}`;
}
