import { Film, Loader2, Lock } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { track } from '@/lib/analytics';

/** Owner/admin-only branch switch: lets members see exercise demo pictures and videos. */
export function MemberExerciseDemosCard({ branchId }: { branchId: string }) {
  const qc = useQueryClient();
  const key = ['member-exercise-demos', branchId];
  const { data: on = false, isLoading, isError } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_member_exercise_demos', { p_branch_id: branchId });
      if (error) throw error;
      return data === true;
    },
  });
  const m = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await supabase.rpc('set_member_exercise_demos', { p_branch_id: branchId, p_enabled: enabled });
      if (error) throw error;
      return enabled;
    },
    onMutate: async (enabled) => {
      const prev = qc.getQueryData<boolean>(key);
      qc.setQueryData(key, enabled);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      qc.setQueryData(key, ctx?.prev);
      toast.error('Could not change the setting');
    },
    onSuccess: (enabled) => {
      track('member_exercise_demos_toggled', { on: enabled });
      toast.success(enabled ? 'Members can now see exercise demos' : 'Exercise demos hidden from members');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  return (
    <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Film className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <Label htmlFor="member-demos-switch" className="flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-foreground">
            Show exercise demos to members
            <Lock className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          </Label>
          <p className="text-xs text-muted-foreground">
            {isError
              ? 'Could not load this setting'
              : on
                ? 'On — members see a picture and short video for each exercise'
                : 'Off — members see exercise and machine names only. Trainers always see demos.'}
          </p>
        </div>
      </div>
      {isLoading || m.isPending ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Saving" />
      ) : (
        <Switch
          id="member-demos-switch"
          checked={on}
          disabled={isError}
          onCheckedChange={(v) => m.mutate(v)}
          className="cursor-pointer"
        />
      )}
    </div>
  );
}
