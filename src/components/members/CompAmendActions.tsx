import { useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Pencil, Trash2, AlertTriangle } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { invalidateMembersData } from '@/lib/memberInvalidation';
import { invalidateBenefitData } from '@/lib/benefits/invalidateBenefitData';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface CompRow {
  id: string;
  comp_sessions: number;
  used_sessions: number;
  benefit_types?: { name?: string | null } | null;
}

interface CompAmendActionsProps {
  comp: CompRow;
  /** Compact icon-only buttons (used inside dense lists) */
  compact?: boolean;
}

/**
 * Correct or revoke a complimentary gift.
 * Owner / admin / manager only — the `amend_member_comp` RPC enforces the same rule server-side.
 */
export function CompAmendActions({ comp, compact = true }: CompAmendActionsProps) {
  const { hasAnyRole } = useAuth();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'edit' | 'revoke' | null>(null);
  const [sessions, setSessions] = useState(String(comp.comp_sessions));
  const [reason, setReason] = useState('');

  const canAmend = hasAnyRole(['owner', 'admin', 'manager']);
  const benefitName = comp.benefit_types?.name || 'Benefit';
  const used = comp.used_sessions || 0;

  const amend = useMutation({
    mutationFn: async () => {
      const next = mode === 'revoke' ? 0 : parseInt(sessions, 10);
      if (mode === 'edit' && (!Number.isFinite(next) || next < 1)) throw new Error('Enter a valid session count');
      const { data, error } = await supabase.rpc('amend_member_comp' as never, {
        p_comp_id: comp.id,
        p_new_sessions: next,
        p_reason: reason.trim(),
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success(mode === 'revoke' ? 'Gift revoked' : 'Gift updated');
      invalidateBenefitData(queryClient);
      invalidateMembersData(queryClient);
      setMode(null);
      setReason('');
    },
    onError: (e: any) => {
      const msg = String(e?.message || '');
      if (msg.includes('ALREADY_USED')) toast.error('Cannot reduce below the sessions already used');
      else if (msg.includes('NOT_AUTHORIZED')) toast.error('You do not have permission to change gifts');
      else toast.error(msg || 'Failed to update gift');
    },
  });

  if (!canAmend) return null;

  const reasonValid = reason.trim().length >= 4;
  const editValid = mode === 'revoke' || (parseInt(sessions, 10) >= Math.max(1, used));

  return (
    <>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size={compact ? 'icon' : 'sm'}
          aria-label={`Edit ${benefitName} gift`}
          className="cursor-pointer h-8 w-8 text-slate-500 hover:text-indigo-600"
          onClick={() => { setSessions(String(comp.comp_sessions)); setReason(''); setMode('edit'); }}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size={compact ? 'icon' : 'sm'}
          aria-label={`Revoke ${benefitName} gift`}
          className="cursor-pointer h-8 w-8 text-slate-500 hover:text-red-600"
          onClick={() => { setReason(''); setMode('revoke'); }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <Sheet open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{mode === 'revoke' ? 'Revoke gift' : 'Correct gift'} — {benefitName}</SheetTitle>
            <SheetDescription>
              {mode === 'revoke'
                ? 'This removes the complimentary grant and the matching bookable credits.'
                : 'Change the number of complimentary sessions. Credits stay in step automatically.'}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-4">
            <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-600">
              Currently <span className="font-semibold text-slate-900">{comp.comp_sessions}</span> granted,{' '}
              <span className="font-semibold text-slate-900">{used}</span> used.
            </div>

            {mode === 'edit' && (
              <div className="space-y-2">
                <Label htmlFor="comp-amend-sessions">Sessions *</Label>
                <Input
                  id="comp-amend-sessions"
                  type="number"
                  min={Math.max(1, used)}
                  value={sessions}
                  onChange={(e) => setSessions(e.target.value)}
                />
                {!editValid && (
                  <p className="text-xs font-medium text-red-600">Cannot go below the {used} session(s) already used.</p>
                )}
              </div>
            )}

            {mode === 'revoke' && used > 0 && (
              <div className="flex items-start gap-2 rounded-2xl bg-red-50 p-3 text-xs text-red-700">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{used} session(s) already used — this gift cannot be revoked. Reduce it instead.</span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="comp-amend-reason">Reason *</Label>
              <Textarea
                id="comp-amend-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Added by mistake, wrong benefit selected"
                rows={3}
              />
              {!reasonValid && <p className="text-xs text-slate-500">Minimum 4 characters.</p>}
            </div>
          </div>

          <SheetFooter className="mt-6 gap-2">
            <Button type="button" variant="outline" className="cursor-pointer" onClick={() => setMode(null)}>Cancel</Button>
            <Button
              type="button"
              className="cursor-pointer"
              variant={mode === 'revoke' ? 'destructive' : 'default'}
              disabled={amend.isPending || !reasonValid || !editValid || (mode === 'revoke' && used > 0)}
              onClick={() => amend.mutate()}
            >
              {amend.isPending ? 'Saving...' : mode === 'revoke' ? 'Revoke gift' : 'Save changes'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
