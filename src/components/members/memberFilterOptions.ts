export type MemberStatusKey =
  | 'active'
  | 'scheduled'
  | 'frozen'
  | 'pending_plan'
  | 'inactive'
  | 'expiring_soon'
  | 'has_dues';

export const MEMBER_STATUS_CHIPS: { value: MemberStatusKey; label: string; className: string }[] = [
  { value: 'active', label: 'Active', className: 'bg-success/10 text-success border-success/30' },
  { value: 'scheduled', label: 'Scheduled', className: 'bg-indigo-100 text-indigo-700 border-indigo-300 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30' },
  { value: 'frozen', label: 'Frozen', className: 'bg-info/10 text-info border-info/30' },
  { value: 'pending_plan', label: 'Pending Plan', className: 'bg-warning/15 text-warning border-warning/30' },
  { value: 'inactive', label: 'Inactive', className: 'bg-muted text-muted-foreground border-border' },
  { value: 'expiring_soon', label: 'Expiring ≤7d', className: 'bg-destructive/10 text-destructive border-destructive/30' },
  { value: 'has_dues', label: 'Has Dues', className: 'bg-destructive/10 text-destructive border-destructive/30' },
];

export const MEMBER_SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'joined', label: 'Joined date' },
  { value: 'name', label: 'Name' },
  { value: 'code', label: 'Member code' },
  { value: 'status', label: 'Status' },
  { value: 'membership', label: 'Plan' },
  { value: 'days_left', label: 'Days left' },
  { value: 'expiry', label: 'Plan expiry' },
  { value: 'dues', label: 'Dues' },
];

export const JOINED_RANGES: { value: string; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'month', label: 'This month' },
];
