import { CheckCircle2, Clock, AlertTriangle, XCircle, Undo2, Hand } from 'lucide-react';
import { format } from 'date-fns';

export type AutoMode = 'auto' | 'review' | 'manual';

export const OUTCOME: Record<string, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  auto_logged: { label: 'Auto-marked', cls: 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20', icon: CheckCircle2 },
  confirmed: { label: 'Marked', cls: 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20', icon: CheckCircle2 },
  ready_to_confirm: { label: 'Ready to confirm', cls: 'bg-blue-500/10 text-blue-600 border border-blue-500/20', icon: Hand },
  awaiting_trainer: { label: 'Waiting for trainer', cls: 'bg-amber-500/10 text-amber-600 border border-amber-500/20', icon: Clock },
  needs_review: { label: 'Needs review', cls: 'bg-destructive/10 text-destructive border border-destructive/20', icon: AlertTriangle },
  trainer_no_show: { label: 'Trainer did not come', cls: 'bg-destructive/10 text-destructive border border-destructive/20', icon: XCircle },
  dismissed: { label: 'Not marked', cls: 'bg-muted text-muted-foreground border border-border', icon: XCircle },
  reversed: { label: 'Undone', cls: 'bg-muted text-muted-foreground border border-border', icon: Undo2 },
};

export const REASON: Record<string, string> = {
  on_duty: 'trainer on duty',
  co_arrival: 'arrived together',
  outside_duty: 'client came after trainer duty ended',
  trainer_very_late: 'trainer very late',
};

export const hhmm = (iso: string | null | undefined) => (iso ? format(new Date(iso), 'HH:mm') : '—');

export const isMarked = (outcome: string) => outcome === 'auto_logged' || outcome === 'confirmed';
