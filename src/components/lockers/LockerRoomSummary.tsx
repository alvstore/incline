import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { User, Users, Layers } from 'lucide-react';

export type LockerRoom = 'male' | 'female' | 'common';

export interface RoomStats {
  total: number;
  available: number;
  assigned: number;
  maintenance: number;
}

interface Props {
  rooms: { value: LockerRoom; label: string; stats: RoomStats }[];
  active: LockerRoom;
  onSelect: (room: LockerRoom) => void;
}

const ICONS: Record<LockerRoom, typeof User> = { male: User, female: Users, common: Layers };

export function LockerRoomSummary({ rooms, active, onSelect }: Props) {
  return (
    <div role="tablist" aria-label="Locker rooms" className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {rooms.map(({ value, label, stats }) => {
        const Icon = ICONS[value];
        const selected = active === value;
        const pct = stats.total ? Math.round((stats.assigned / stats.total) * 100) : 0;
        return (
          <Card
            key={value}
            asChild={false}
            className={cn(
              'rounded-2xl border p-0 transition-colors duration-150',
              selected ? 'border-primary ring-2 ring-primary/30 bg-primary/5' : 'border-border hover:bg-secondary',
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onSelect(value)}
              className="w-full text-left p-5 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={cn('p-2 rounded-full', selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <div>
                    <p className="font-semibold tracking-tight text-foreground">{label}</p>
                    <p className="text-xs text-muted-foreground">{stats.total} lockers</p>
                  </div>
                </div>
                <p className="text-3xl font-bold tabular-nums text-foreground">{stats.available}<span className="ml-1 text-xs font-medium text-muted-foreground">free</span></p>
              </div>
              <div className="mt-4 h-1.5 rounded-full bg-muted overflow-hidden" aria-hidden>
                <div className="h-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-2 flex gap-4 text-xs text-muted-foreground tabular-nums">
                <span>{stats.assigned} assigned</span>
                <span>{stats.maintenance} out of order</span>
                <span className="ml-auto">{pct}% full</span>
              </div>
            </button>
          </Card>
        );
      })}
    </div>
  );
}
