import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { LOCKER_SIZES, REQUEST_TITLES } from './requestTypes';
import {
  MEMBER_REQUEST_LABEL,
  memberRequestTaskTitle,
  resolveMemberDisplayName,
  type MemberRequestReference,
} from '@/lib/tasks/memberRequestTasks';
import { notifyTaskAssignee } from '@/lib/tasks/taskNotify';
import type { LockerSize, RequestKind, RequestOption } from './requestTypes';

const MEMBER_REQUEST_LABEL_LOWER: Record<MemberRequestReference, string> = {
  member: MEMBER_REQUEST_LABEL.member.toLowerCase(),
  membership_unfreeze: MEMBER_REQUEST_LABEL.membership_unfreeze.toLowerCase(),
  trainer_change: MEMBER_REQUEST_LABEL.trainer_change.toLowerCase(),
  locker: MEMBER_REQUEST_LABEL.locker.toLowerCase(),
};

interface RequestComposerDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected request type; null shows the type picker first */
  initialKind: RequestKind | null;
  options: RequestOption[];
  member: any;
  activeMembership: any;
  userId: string;
  trainerName?: string | null;
  freezeDaysAllowance: number;
}

const COPY: Record<RequestKind, { title: string; description: string; fieldLabel: string; placeholder: string; note: string; requireText: boolean }> = {
  freeze: {
    title: 'Freeze membership',
    description: 'Pause your membership while you are away.',
    fieldLabel: 'Reason for freeze',
    placeholder: 'e.g., Traveling for work, medical reasons…',
    note: 'Management reviews freeze requests. You will be notified once approved and your end date extended.',
    requireText: true,
  },
  unfreeze: {
    title: 'Resume membership',
    description: 'Ask us to lift the freeze and restore your access.',
    fieldLabel: 'Reason for resuming',
    placeholder: 'e.g., Back from travel, ready to resume training…',
    note: 'Once approved your membership resumes immediately and gate access is restored.',
    requireText: true,
  },
  trainer: {
    title: 'Trainer request',
    description: 'Tell us what you are looking for in a trainer.',
    fieldLabel: 'What are you looking for?',
    placeholder: 'e.g., Morning slots, strength focus, schedule conflicts…',
    note: 'Your request is reviewed and a suitable trainer will be assigned.',
    requireText: true,
  },
  locker: {
    title: 'Request a locker',
    description: 'Ask the front desk to allocate a locker for you.',
    fieldLabel: 'Preference (optional)',
    placeholder: 'e.g., Near the changing room',
    note: 'The team confirms availability and charges (if any) before allocating.',
    requireText: false,
  },
  diet: {
    title: 'Request a diet plan',
    description: 'Ask your trainer to prepare a personalised nutrition plan.',
    fieldLabel: 'Notes for your trainer (optional)',
    placeholder: 'Goals, allergies, preferences, meal timings…',
    note: 'A task is created for your trainer so they can prepare your plan.',
    requireText: false,
  },
  workout: {
    title: 'Request a workout plan',
    description: 'Ask your trainer to design a routine for your goals.',
    fieldLabel: 'Notes for your trainer (optional)',
    placeholder: 'Goals, injuries, available days, preferred split…',
    note: 'A task is created for your trainer so they can prepare your plan.',
    requireText: false,
  },
};

export function RequestComposerDrawer({
  open,
  onOpenChange,
  initialKind,
  options,
  member,
  activeMembership,
  userId,
  trainerName,
  freezeDaysAllowance,
}: RequestComposerDrawerProps) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<RequestKind | null>(initialKind);
  const [note, setNote] = useState('');
  const [lockerSize, setLockerSize] = useState<LockerSize>('Medium');

  useEffect(() => {
    if (open) {
      setKind(initialKind);
      setNote('');
      setLockerSize('Medium');
    }
  }, [open, initialKind]);

  

  const submit = useMutation({
    mutationFn: async () => {
      if (!kind) return;

      // Always show the member's real name in staff-facing task titles.
      const memberName = await resolveMemberDisplayName(member || {});

      /** Every member request gets a task so staff/trainers see it in their queue. */
      const createRequestTask = async (title: string, description: string, assignedTo: string | null) => {
        const { data, error } = await supabase
          .from('tasks')
          .insert({
            branch_id: member.branch_id,
            title,
            description,
            priority: 'medium',
            status: 'pending',
            assigned_to: assignedTo,
            assigned_by: userId,
            linked_entity_type: 'member',
            linked_entity_id: member.id,
          } as any)
          .select('id, branch_id, assigned_to, title, description, priority, due_date')
          .single();
        if (error) throw error;
        await notifyTaskAssignee({
          taskId: (data as any).id,
          branchId: (data as any).branch_id,
          assignedTo: (data as any).assigned_to,
          title: (data as any).title,
          description: (data as any).description,
          priority: (data as any).priority,
          dueDate: (data as any).due_date,
        });
      };

      if (kind === 'diet' || kind === 'workout') {
        const title = `${kind === 'diet' ? 'Diet' : 'Workout'} plan request from ${memberName}`;
        const assignees: string[] = [];
        if (member.assigned_trainer_id) {
          const { data: t } = await (supabase as any)
            .from('trainers_directory')
            .select('user_id')
            .eq('id', member.assigned_trainer_id)
            .maybeSingle();
          if (t?.user_id) assignees.push(t.user_id);
        }
        if (assignees.length === 0) {
          const { data: branchTrainers } = await (supabase as any)
            .from('trainers_directory')
            .select('user_id')
            .eq('branch_id', member.branch_id)
            .eq('is_active', true);
          (branchTrainers || []).forEach((t: any) => t.user_id && assignees.push(t.user_id));
        }
        const targets = assignees.length > 0 ? assignees : [null];
        const rows = targets.map((uid) => ({
          branch_id: member.branch_id,
          title,
          description: note || `Member ${memberName} has requested a new ${kind} plan.`,
          priority: 'medium',
          status: 'pending',
          assigned_to: uid,
          assigned_by: userId,
          linked_entity_type: 'member',
          linked_entity_id: member.id,
        }));
        const { data: created, error } = await supabase
          .from('tasks')
          .insert(rows as any)
          .select('id, branch_id, assigned_to, title, description, priority, due_date');
        if (error) throw error;
        await Promise.all(
          (created || []).map((t: any) =>
            notifyTaskAssignee({
              taskId: t.id,
              branchId: t.branch_id,
              assignedTo: t.assigned_to,
              title: t.title,
              description: t.description,
              priority: t.priority,
              dueDate: t.due_date,
            }),
          ),
        );
        return;
      }

      const base = {
        reference_id: member.id,
        branch_id: member.branch_id,
        requested_by: userId,
      };

      const queueTask = async (reference: MemberRequestReference, assignedTo: string | null) => {
        await createRequestTask(
          memberRequestTaskTitle(reference, memberName),
          note?.trim()
            ? note.trim()
            : `${memberName} raised a ${MEMBER_REQUEST_LABEL_LOWER[reference]} request from the member portal.`,
          assignedTo,
        );
      };

      if (kind === 'freeze' || kind === 'unfreeze') {
        const reference: MemberRequestReference = kind === 'unfreeze' ? 'membership_unfreeze' : 'member';
        const { error } = await supabase.from('approval_requests').insert({
          ...base,
          approval_type: 'membership_freeze' as const,
          reference_type: reference,
          request_data: {
            membershipId: activeMembership?.id,
            reason: note,
            requested_at: new Date().toISOString(),
          },
        });
        if (error) throw error;
        await queueTask(reference, null);
        return;
      }

      if (kind === 'trainer') {
        const { error } = await supabase.from('approval_requests').insert({
          ...base,
          approval_type: 'complimentary' as const,
          reference_type: 'trainer_change',
          request_data: {
            current_trainer_id: member.assigned_trainer_id,
            reason: note,
            requested_at: new Date().toISOString(),
          },
        });
        if (error) throw error;

        let trainerUserId: string | null = null;
        if (member.assigned_trainer_id) {
          const { data: t } = await (supabase as any)
            .from('trainers_directory')
            .select('user_id')
            .eq('id', member.assigned_trainer_id)
            .maybeSingle();
          trainerUserId = t?.user_id ?? null;
        }
        await queueTask('trainer_change', trainerUserId);
        return;
      }

      // locker
      const { error } = await supabase.from('approval_requests').insert({
        ...base,
        approval_type: 'locker_request' as any,
        reference_type: 'locker',
        request_data: {
          memberName,
          memberCode: member.member_code,
          preferred_size: lockerSize,
          note,
          requested_at: new Date().toISOString(),
        },
      } as any);
      if (error) throw error;
      await createRequestTask(
        memberRequestTaskTitle('locker', memberName),
        `${memberName} requested a ${lockerSize.toLowerCase()} locker.${note?.trim() ? ` Note: ${note.trim()}` : ''}`,
        null,
      );
    },
    onSuccess: () => {
      toast.success(
        kind === 'diet' || kind === 'workout'
          ? 'Request sent to your trainer'
          : 'Request submitted for review',
      );
      queryClient.invalidateQueries({ queryKey: ['my-requests'] });
      queryClient.invalidateQueries({ queryKey: ['my-plan-requests'] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to submit request'),
  });

  const copy = kind ? COPY[kind] : null;
  const canSubmit = !!kind && (!copy?.requireText || note.trim().length > 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border/60 px-6 py-4">
          <SheetTitle>{copy ? copy.title : 'New request'}</SheetTitle>
          <SheetDescription>
            {copy ? copy.description : 'Choose what you would like to ask the team for.'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {!kind ? (
            <div className="grid gap-2">
              {options.map((option) => {
                const Icon = option.icon;
                const disabled = !!option.disabledReason;
                return (
                  <button
                    key={option.kind}
                    type="button"
                    disabled={disabled}
                    onClick={() => setKind(option.kind)}
                    className={`flex items-center gap-3 rounded-xl border border-border/60 p-3 text-left transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary ${
                      disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-primary/40 hover:shadow-md'
                    }`}
                  >
                    <span className={`flex h-9 w-9 items-center justify-center rounded-full ${option.tone}`}>
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{option.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {option.disabledReason || option.description}
                      </span>
                    </span>
                    {!disabled && <ChevronRight className="h-4 w-4 text-muted-foreground/60" />}
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              {(kind === 'freeze' || kind === 'unfreeze') && freezeDaysAllowance > 0 && (
                <div className="rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
                  Your plan includes <span className="font-semibold text-foreground">{freezeDaysAllowance} freeze days</span>.
                </div>
              )}

              {kind === 'trainer' && (
                <div className="rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
                  {trainerName
                    ? <>Current trainer: <span className="font-semibold text-foreground">{trainerName}</span></>
                    : 'No trainer is assigned to you yet.'}
                </div>
              )}

              {kind === 'locker' && (
                <div className="space-y-2">
                  <Label>Preferred size</Label>
                  <div className="flex flex-wrap gap-2">
                    {LOCKER_SIZES.map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => setLockerSize(size)}
                        className={`flex min-h-[44px] items-center gap-1.5 rounded-xl border px-4 text-sm font-medium transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary ${
                          lockerSize === size
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border/60 text-muted-foreground hover:bg-muted/60'
                        }`}
                      >
                        {lockerSize === size && <Check className="h-3.5 w-3.5" />}
                        {size}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="request-note">{copy!.fieldLabel}</Label>
                <Textarea
                  id="request-note"
                  rows={5}
                  placeholder={copy!.placeholder}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              <p className="text-sm text-muted-foreground">{copy!.note}</p>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border/60 px-6 py-4">
          {kind && !initialKind ? (
            <Button variant="ghost" onClick={() => setKind(null)} className="rounded-xl">
              <ChevronLeft className="mr-1 h-4 w-4" />
              Back
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="rounded-xl">
              Cancel
            </Button>
          )}
          <Button
            className="rounded-xl"
            onClick={() => submit.mutate()}
            disabled={!canSubmit || submit.isPending}
            data-testid="btn-submit-request"
          >
            {submit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {submit.isPending ? 'Submitting…' : `Send ${kind ? REQUEST_TITLES[kind].toLowerCase() : ''} request`}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
