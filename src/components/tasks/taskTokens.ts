export const STATUS_PILL: Record<string, string> = {
  pending: 'bg-warning/15 text-warning',
  in_progress: 'bg-info/15 text-info',
  completed: 'bg-success/15 text-success',
  cancelled: 'bg-muted text-muted-foreground',
};

export const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const PRIORITY_PILL: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-info/10 text-info',
  high: 'bg-warning/15 text-warning',
  urgent: 'bg-destructive/15 text-destructive',
};

export const PRIORITY_DOT: Record<string, string> = {
  low: 'bg-muted-foreground/40',
  medium: 'bg-info',
  high: 'bg-warning',
  urgent: 'bg-destructive',
};

export const LANES: { id: 'pending' | 'in_progress' | 'completed' | 'cancelled'; label: string; accent: string }[] = [
  { id: 'pending', label: 'Pending', accent: 'from-warning to-warning' },
  { id: 'in_progress', label: 'In Progress', accent: 'from-primary to-primary' },
  { id: 'completed', label: 'Completed', accent: 'from-success to-success' },
  { id: 'cancelled', label: 'Cancelled', accent: 'from-muted to-muted-foreground/60' },
];
