import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { ZONE_OPTIONS, zoneLabel } from '@/pages/lockersConstants';
import type { LockerRoom } from './LockerRoomSummary';

interface LockerLite { id: string; locker_number: string; gender_zone?: string | null }

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  branchId: string;
  lockers: LockerLite[];
}

const num = (s: string) => parseInt(s.replace(/\D/g, ''), 10);

export function ArrangeRoomsSheet({ open, onOpenChange, branchId, lockers }: Props) {
  const qc = useQueryClient();
  const [target, setTarget] = useState<LockerRoom>('male');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const sorted = useMemo(
    () => [...lockers].sort((a, b) => a.locker_number.localeCompare(b.locker_number, undefined, { numeric: true })),
    [lockers],
  );

  const applyRange = () => {
    const a = num(from), b = num(to);
    if (Number.isNaN(a) || Number.isNaN(b)) { toast.error('Enter locker numbers like 1 and 22'); return; }
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    const next = new Set(picked);
    sorted.forEach((l) => { const n = num(l.locker_number); if (n >= lo && n <= hi) next.add(l.id); });
    setPicked(next);
  };

  const toggle = (id: string) => {
    const next = new Set(picked);
    next.has(id) ? next.delete(id) : next.add(id);
    setPicked(next);
  };

  const save = useMutation({
    mutationFn: async () => {
      const ids = [...picked];
      const { error } = await supabase.from('lockers').update({ gender_zone: target }).in('id', ids).eq('branch_id', branchId);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ['lockers'] });
      toast.success(`${n} locker${n === 1 ? '' : 's'} moved to ${zoneLabel(target)}`);
      setPicked(new Set()); setFrom(''); setTo('');
      onOpenChange(false);
    },
    onError: () => toast.error('Could not move lockers. Please try again.'),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col p-0 gap-0">
        <SheetHeader className="p-6 border-b border-border">
          <SheetTitle>Arrange rooms</SheetTitle>
          <SheetDescription>Choose which lockers belong to the male or female room. Assigned members keep their locker.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="space-y-2">
            <Label htmlFor="arrange-target">Move selected lockers to</Label>
            <Select value={target} onValueChange={(v) => setTarget(v as LockerRoom)}>
              <SelectTrigger id="arrange-target" className="rounded-xl h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ZONE_OPTIONS.map((z) => <SelectItem key={z.value} value={z.value}>{z.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Select a range</legend>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label htmlFor="range-from" className="text-xs text-muted-foreground">From</Label>
                <Input id="range-from" inputMode="numeric" placeholder="1" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11 rounded-xl" />
              </div>
              <div className="flex-1">
                <Label htmlFor="range-to" className="text-xs text-muted-foreground">To</Label>
                <Input id="range-to" inputMode="numeric" placeholder="22" value={to} onChange={(e) => setTo(e.target.value)} className="h-11 rounded-xl" />
              </div>
              <Button type="button" variant="outline" className="h-11 rounded-xl" onClick={applyRange}>Add range</Button>
            </div>
          </fieldset>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Or tick lockers</p>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => setPicked(new Set(sorted.map((l) => l.id)))}>All</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
              </div>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {sorted.map((l) => {
                const id = `arr-${l.id}`;
                return (
                  <label key={l.id} htmlFor={id} className="flex items-center gap-2 rounded-xl border border-border p-2 min-h-11 cursor-pointer hover:bg-secondary transition-colors duration-150">
                    <Checkbox id={id} checked={picked.has(l.id)} onCheckedChange={() => toggle(l.id)} />
                    <span className="text-sm">
                      <span className="font-semibold block leading-tight">{l.locker_number}</span>
                      <span className="text-[11px] text-muted-foreground">{zoneLabel(l.gender_zone).replace(' room', '').replace(' area', '')}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-border flex items-center gap-2 bg-background pb-safe">
          <p className="text-sm text-muted-foreground flex-1" aria-live="polite">{picked.size} selected</p>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!picked.size || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Move to {zoneLabel(target)}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
