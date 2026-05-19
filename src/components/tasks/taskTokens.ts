export const STATUS_PILL: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-600',
};

export const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const PRIORITY_PILL: Record<string, string> = {
  low: 'bg-slate-100 text-slate-600',
  medium: 'bg-blue-50 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
};

export const PRIORITY_DOT: Record<string, string> = {
  low: 'bg-slate-300',
  medium: 'bg-blue-400',
  high: 'bg-orange-500',
  urgent: 'bg-red-500',
};

export const LANES: { id: 'pending' | 'in_progress' | 'completed' | 'cancelled'; label: string; accent: string }[] = [
  { id: 'pending', label: 'Pending', accent: 'from-amber-400 to-amber-500' },
  { id: 'in_progress', label: 'In Progress', accent: 'from-indigo-500 to-blue-500' },
  { id: 'completed', label: 'Completed', accent: 'from-emerald-400 to-emerald-500' },
  { id: 'cancelled', label: 'Cancelled', accent: 'from-slate-300 to-slate-400' },
];
