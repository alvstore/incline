import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Key, Unlock, User } from 'lucide-react';
import { ZONE_OPTIONS, zoneLabel } from '@/pages/lockersConstants';

export interface LockerDetail {
  id: string;
  locker_number: string;
  size?: string | null;
  status: string;
  gender_zone?: string | null;
  area?: string | null;
  member?: { full_name?: string; member_code?: string } | null;
  assignmentId?: string | null;
}

interface Props {
  locker: LockerDetail | null;
  branchId: string;
  canManage: boolean;
  onOpenChange: (o: boolean) => void;
  onAssign: () => void;
  onRelease: () => void;
}

export function LockerDetailSheet({ locker, branchId, canManage, onOpenChange, onAssign, onRelease }: Props) {
  const qc = useQueryClient();
  const [zone, setZone] = useState<string>('');
  const current = locker?.gender_zone || 'common';
  const selectedZone = zone || current;

  const move = useMutation({
    mutationFn: async () => {
      if (!locker) return;
      const { error } = await supabase.from('lockers').update({ gender_zone: selectedZone }).eq('id', locker.id).eq('branch_id', branchId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lockers'] });
      toast.success(`Moved to ${zoneLabel(selectedZone)}`);
      setZone('');
      onOpenChange(false);
    },
    onError: () => toast.error('Could not move locker. Please try again.'),
  });

  return (
    <Sheet open={!!locker} onOpenChange={(o) => { if (!o) setZone(''); onOpenChange(o); }}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col p-0 gap-0">
        {locker && (
          <>
            <SheetHeader className="p-6 border-b border-border">
              <SheetTitle>Locker {locker.locker_number}</SheetTitle>
              <SheetDescription>{zoneLabel(current)} · <span className="capitalize">{locker.size || 'medium'}</span>{locker.area ? ` · ${locker.area}` : ''}</SheetDescription>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="rounded-xl border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</p>
                <p className="mt-1 font-semibold capitalize">{locker.status}</p>
                {locker.member && (
                  <div className="mt-3 flex items-center gap-3">
                    <span className="p-2 rounded-full bg-muted"><User className="h-4 w-4" aria-hidden /></span>
                    <div>
                      <p className="font-medium">{locker.member.full_name || 'Member'}</p>
                      <p className="text-xs text-muted-foreground">{locker.member.member_code}</p>
                    </div>
                  </div>
                )}
              </div>
              {canManage && (
                <div className="space-y-2">
                  <Label htmlFor="locker-room">Room</Label>
                  <div className="flex gap-2">
                    <Select value={selectedZone} onValueChange={setZone}>
                      <SelectTrigger id="locker-room" className="h-11 rounded-xl flex-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ZONE_OPTIONS.map((z) => <SelectItem key={z.value} value={z.value}>{z.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button variant="outline" className="h-11 rounded-xl" disabled={selectedZone === current || move.isPending} onClick={() => move.mutate()}>
                      {move.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Move
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-border flex justify-end gap-2 bg-background pb-safe">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              {locker.status === 'available' && (
                <Button onClick={onAssign} className="gap-2"><Key className="h-4 w-4" aria-hidden />Assign</Button>
              )}
              {locker.assignmentId && (
                <Button variant="destructive" onClick={onRelease} className="gap-2"><Unlock className="h-4 w-4" aria-hidden />Release</Button>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
