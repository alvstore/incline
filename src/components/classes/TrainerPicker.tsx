import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UserPlus } from 'lucide-react';

export const GUEST_OPTION = '__guest__';

interface Props {
  trainers: any[] | undefined;
  trainerId: string;
  guestName: string;
  onChange: (next: { trainerId: string; guestName: string }) => void;
}

/**
 * Trainer selector that also accepts freelance / guest instructors who are not
 * staff in the system. Exactly one of `trainer_id` / `external_trainer_name`
 * is ever set (enforced by a DB check constraint too).
 */
export function TrainerPicker({ trainers, trainerId, guestName, onChange }: Props) {
  const isGuest = !trainerId && guestName !== '' ? true : false;
  const value = trainerId || (isGuest ? GUEST_OPTION : 'none');

  return (
    <div className="space-y-2">
      <Label htmlFor="class-trainer">Trainer</Label>
      <Select
        value={value}
        onValueChange={(v) => {
          if (v === 'none') onChange({ trainerId: '', guestName: '' });
          else if (v === GUEST_OPTION) onChange({ trainerId: '', guestName: guestName || ' ' });
          else onChange({ trainerId: v, guestName: '' });
        }}
      >
        <SelectTrigger id="class-trainer"><SelectValue placeholder="Select trainer" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No trainer</SelectItem>
          {(trainers || []).map((trainer: any) => (
            <SelectItem key={trainer.id} value={trainer.id}>
              {trainer.profile_name || trainer.profile_email}
            </SelectItem>
          ))}
          <SelectItem value={GUEST_OPTION}>Guest / freelance trainer…</SelectItem>
        </SelectContent>
      </Select>

      {value === GUEST_OPTION && (
        <div className="space-y-1.5 rounded-xl border border-dashed p-3">
          <Label htmlFor="class-guest-trainer" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <UserPlus className="h-3.5 w-3.5" /> Guest trainer name
          </Label>
          <Input
            id="class-guest-trainer"
            value={guestName.trim()}
            placeholder="e.g. Anjali Verma (freelance)"
            onChange={(e) => onChange({ trainerId: '', guestName: e.target.value || ' ' })}
          />
          <p className="text-xs text-muted-foreground">
            Used on class cards, member booking and campaign messages. No system account is created.
          </p>
        </div>
      )}
    </div>
  );
}
