import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Gift, Trash2, Loader2, Pencil } from 'lucide-react';

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';

interface GiftDaysDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  membershipId?: string | null;
  memberId?: string | null;
}

interface FreeDayRow {
  id: string;
  days_added: number;
  reason: string | null;
  created_at: string;
}

export function GiftDaysDrawer({ open, onOpenChange, membershipId, memberId }: GiftDaysDrawerProps) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['gift-days', membershipId],
    enabled: open && !!membershipId,
    queryFn: async (): Promise<FreeDayRow[]> => {
      const { data, error } = await supabase
        .from('membership_free_days')
        .select('id, days_added, reason, created_at')
        .eq('membership_id', membershipId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as FreeDayRow[];
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['gift-days', membershipId] });
    queryClient.invalidateQueries({ queryKey: ['member-profile-free-days'] });
    queryClient.invalidateQueries({ queryKey: ['member-details', memberId] });
    queryClient.invalidateQueries({ queryKey: ['members'] });
  };

  const adjust = useMutation({
    mutationFn: async (vars: { id: string; newDays?: number; remove?: boolean; reason: string }) => {
      const { data, error } = await supabase.rpc('adjust_membership_free_days' as any, {
        _free_day_id: vars.id,
        _new_days: vars.newDays ?? null,
        _delete: !!vars.remove,
        _reason: vars.reason,
      });
      if (error) throw error;
      const res = data as any;
      if (!res?.success) throw new Error(res?.error || 'Adjustment failed');
      return res;
    },
    onSuccess: (res: any) => {
      invalidate();
      setEditingId(null);
      setDays('');
      setReason('');
      toast.success(`Updated — membership now ends ${format(new Date(res.new_end_date), 'dd MMM yyyy')}`);
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to adjust complimentary days'),
  });

  const grant = useMutation({
    mutationFn: async (vars: { days: number; reason: string }) => {
      const { data, error } = await supabase.rpc('grant_membership_free_days' as any, {
        p_membership_id: membershipId!,
        p_days: vars.days,
        p_reason: vars.reason,
      });
      if (error) throw error;
      const res = data as any;
      if (!res?.success) throw new Error(res?.error || 'Could not grant complimentary days');
      return res;
    },
    onSuccess: (res: any) => {
      invalidate();
      setGrantDays('');
      setGrantReason('');
      toast.success(`+${res.days_added} days granted — membership now ends ${format(new Date(res.new_end_date), 'dd MMM yyyy')}`);
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to grant complimentary days'),
  });

  const total = rows.reduce((s, r) => s + Number(r.days_added || 0), 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-warning" /> Complimentary Days
          </SheetTitle>
          <SheetDescription>
            Granting, editing or removing a gift entry shifts the membership end date by the same number of days. A reason is required and every change is audited.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-5">
          <Card className="rounded-2xl border-warning/40 bg-warning/5 shadow-sm">
            <CardContent className="pt-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Grant new days</p>
              <div className="space-y-2">
                <Label htmlFor="grant-days">Days to gift <span className="text-destructive">*</span></Label>
                <Input
                  id="grant-days"
                  type="number"
                  min="1"
                  placeholder="e.g. 15"
                  value={grantDays}
                  onChange={(e) => setGrantDays(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="grant-reason">Reason <span className="text-destructive">*</span></Label>
                <Textarea
                  id="grant-reason"
                  value={grantReason}
                  onChange={(e) => setGrantReason(e.target.value)}
                  placeholder="e.g. Founder promise — 15 extra days at joining"
                  className="min-h-[70px]"
                />
                <p className="text-xs text-muted-foreground">Minimum 6 characters.</p>
              </div>
              <Button
                className="w-full cursor-pointer"
                disabled={
                  grant.isPending ||
                  !membershipId ||
                  Number(grantDays) <= 0 ||
                  grantReason.trim().length < 6
                }
                onClick={() => grant.mutate({ days: Number(grantDays), reason: grantReason.trim() })}
              >
                {grant.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Gift className="h-4 w-4 mr-2" />}
                Grant complimentary days
              </Button>
            </CardContent>
          </Card>

          {isLoading ? (
            <>
              <Skeleton className="h-24 w-full rounded-2xl" />
              <Skeleton className="h-24 w-full rounded-2xl" />
            </>
          ) : rows.length === 0 ? (
            <div className="rounded-2xl bg-muted/40 p-8 text-center">
              <Gift className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No complimentary days on this membership yet.</p>
            </div>
          ) : (
            <>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {total} gifted day{total === 1 ? '' : 's'} total
              </p>

              {rows.map((r) => {
                const isEditing = editingId === r.id;
                return (
                  <Card key={r.id} className="rounded-2xl border-border/60 shadow-sm">
                    <CardContent className="pt-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold">+{r.days_added} day{r.days_added === 1 ? '' : 's'}</p>
                          <p className="text-xs text-muted-foreground">{format(new Date(r.created_at), 'dd MMM yyyy')}</p>
                          {r.reason && <p className="text-sm text-muted-foreground mt-1 break-words">{r.reason}</p>}
                        </div>
                        {!isEditing && (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Edit complimentary days"
                            onClick={() => { setEditingId(r.id); setDays(String(r.days_added)); setReason(''); }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                      </div>

                      {isEditing && (
                        <div className="space-y-3 border-t border-border/60 pt-3">
                          <div className="space-y-2">
                            <Label htmlFor={`days-${r.id}`}>Days</Label>
                            <Input id={`days-${r.id}`} type="number" min="0" value={days} onChange={(e) => setDays(e.target.value)} />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`reason-${r.id}`}>Reason <span className="text-destructive">*</span></Label>
                            <Textarea
                              id={`reason-${r.id}`}
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              placeholder="e.g. corrected from 20 to 10 days"
                              className="min-h-[70px]"
                            />
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              disabled={adjust.isPending || !reason.trim() || days === ''}
                              onClick={() => adjust.mutate({ id: r.id, newDays: Number(days), reason })}
                            >
                              {adjust.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={adjust.isPending || !reason.trim()}
                              onClick={() => adjust.mutate({ id: r.id, remove: true, reason })}
                            >
                              <Trash2 className="h-4 w-4 mr-1" /> Remove
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} disabled={adjust.isPending}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </>
          )}
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
