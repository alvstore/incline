import { useEffect, useMemo, useState } from 'react';
import { useLockerPricing } from '@/hooks/useLockerPricing';
import { track } from '@/lib/analytics';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Loader2, ChevronLeft, ChevronRight, Check, UserPlus, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { fetchMyTrainers } from '@/lib/members/myTrainers';
import {
  LOCKER_SIZES,
  REQUEST_TITLES,
  lockerPricing,
  TRAINER_CHANGE_REASONS,
  TRAINER_GOALS,
  TRAINER_SLOTS,
  isEscalationReason,
  reasonNeedsDetails,
  trainerReasonLabel,
  validateTrainerChange,
  type TrainerChangeReason,
} from './requestTypes';
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
    title: 'Request a dedicated locker',
    description: 'Reserve your own locker for the rest of your membership.',
    fieldLabel: 'Preference (optional)',
    placeholder: 'e.g., Near the changing room',
    note: 'The front desk confirms availability, assigns your locker and collects the fee.',
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
  const [reasonCode, setReasonCode] = useState<TrainerChangeReason | null>(null);
  const [goal, setGoal] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [preferredTrainer, setPreferredTrainer] = useState('');
  const [targetTrainerId, setTargetTrainerId] = useState<string | null>(null);
  const { data: lockerCfg } = useLockerPricing(member?.branch_id);

  // Same cache as useMemberData — includes general coach and PT-package trainers.
  const { data: myTrainers = [] } = useQuery({
    queryKey: ['my-trainers', userId],
    enabled: open && !!userId,
    queryFn: fetchMyTrainers,
    staleTime: 5 * 60 * 1000,
  });
  const currentTrainers = useMemo(() => {
    const seen = new Set<string>();
    return myTrainers
      .filter((t) => t.relation === 'assigned' || t.relation === 'pt_package')
      .filter((t) => (seen.has(t.trainer_id) ? false : (seen.add(t.trainer_id), true)));
  }, [myTrainers]);
  const hasTrainer = currentTrainers.length > 0;

  // Kill switch: settings key `trainer_change_reason_required` (global row). Default ON.
  const { data: reasonFlagOn = true } = useQuery({
    queryKey: ['setting', 'trainer_change_reason_required'],
    enabled: open,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'trainer_change_reason_required')
        .is('branch_id', null)
        .maybeSingle();
      const v = (data as any)?.value;
      if (v === false || v === 'false' || v?.enabled === false) return false;
      return true;
    },
  });

  useEffect(() => {
    if (open) {
      setKind(initialKind);
      setNote('');
      setLockerSize('Medium');
      setReasonCode(null);
      setGoal(null);
      setSlot(null);
      setPreferredTrainer('');
      setTargetTrainerId(null);
    }
  }, [open, initialKind]);

  const trainerError = kind === 'trainer'
    ? validateTrainerChange({ flagOn: reasonFlagOn, hasTrainer, reason: reasonCode, details: note })
    : null;

  

  const submit = useMutation({
    mutationFn: async () => {
      if (!kind) return;

      // Always show the member's real name in staff-facing task titles.
      const memberName = await resolveMemberDisplayName(member || {});

      /** Every member request gets a task so staff/trainers see it in their queue. */
      const createRequestTask = async (title: string, description: string, assignedTo: string | null, priority: 'medium' | 'high' = 'medium') => {
        const { data, error } = await supabase
          .from('tasks')
          .insert({
            branch_id: member.branch_id,
            title,
            description,
            priority,
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
        const target = currentTrainers.find((t) => t.trainer_id === targetTrainerId) ?? currentTrainers[0] ?? null;
        const reasonLabel = trainerReasonLabel(reasonCode);
        const { error } = await supabase.from('approval_requests').insert({
          ...base,
          approval_type: 'complimentary' as const,
          reference_type: 'trainer_change',
          request_data: {
            memberName,
            memberCode: member.member_code,
            request_mode: target ? 'change' : 'new',
            current_trainer_id: target?.trainer_id ?? member.assigned_trainer_id ?? null,
            current_trainer_name: target?.full_name ?? null,
            currentTrainerName: target?.full_name ?? null,
            current_trainer_source: target ? (target.relation === 'assigned' ? 'general' : 'personal_training') : null,
            reason_code: reasonCode,
            reason_label: reasonLabel,
            reason: note.trim(),
            goal: goal,
            preferred_trainer_name: preferredTrainer.trim() || null,
            preferred_slot: slot,
            requested_at: new Date().toISOString(),
          },
        } as any);
        if (error) throw error;

        // Escalate to branch staff/manager queue — never to the trainer being reviewed.
        const priority = isEscalationReason(reasonCode) ? 'high' : 'medium';
        const parts = [
          target ? `Current trainer: ${target.full_name}` : 'No trainer assigned — wants one',
          reasonLabel ? `Reason: ${reasonLabel}` : null,
          goal ? `Goal: ${goal}` : null,
          slot ? `Preferred time: ${slot}` : null,
          preferredTrainer.trim() ? `Preferred trainer: ${preferredTrainer.trim()}` : null,
          note.trim() ? `Details: ${note.trim()}` : null,
        ].filter(Boolean);
        await createRequestTask(memberRequestTaskTitle('trainer_change', memberName), parts.join(' · '), null, priority);
        track('trainer_request_submitted', { mode: target ? 'change' : 'new', reason: reasonCode ?? 'none' });
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
          quoted_fee: lockerPricing(lockerSize),
          validity: 'until_membership_end',
          note,
          requested_at: new Date().toISOString(),
        },
      } as any);
      if (error) throw error;
      const quote = lockerPricing(lockerSize);
      await createRequestTask(
        memberRequestTaskTitle('locker', memberName),
        `${memberName} requested a dedicated ${lockerSize.toLowerCase()} locker (₹${quote.base.toLocaleString('en-IN')} + GST = ₹${quote.total.toLocaleString('en-IN')}, valid until membership end). Assign a locker and collect payment.${note?.trim() ? ` Note: ${note.trim()}` : ''}`,
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

  const baseCopy = kind ? COPY[kind] : null;
  const copy = kind === 'trainer' && baseCopy
    ? hasTrainer
      ? { ...baseCopy, title: 'Change trainer', description: 'Tell us what isn’t working so the manager can help.', note: 'The branch manager reviews your request and follows up.' }
      : { ...baseCopy, title: 'Request a trainer', description: 'Get matched with a coach for your goals.', note: 'The front desk will match you with a suitable trainer.' }
    : baseCopy;
  const canSubmit = !!kind && (kind === 'trainer' ? !trainerError : (!copy?.requireText || note.trim().length > 0));

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
                <div className="space-y-5">
                  {hasTrainer ? (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {currentTrainers.length > 1 ? 'Which trainer is this about?' : 'Your current trainer'}
                      </p>
                      <div className="grid gap-2" role="radiogroup" aria-label="Current trainer">
                        {currentTrainers.map((t) => {
                          const selected = (targetTrainerId ?? currentTrainers[0].trainer_id) === t.trainer_id;
                          const initials = t.full_name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
                          return (
                            <button
                              key={t.trainer_id}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              disabled={currentTrainers.length === 1}
                              onClick={() => setTargetTrainerId(t.trainer_id)}
                              className={`flex min-h-[56px] items-center gap-3 rounded-xl border p-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default ${
                                selected ? 'border-primary bg-primary/5' : 'cursor-pointer border-border/60 hover:bg-muted/60'
                              }`}
                            >
                              <Avatar className="h-10 w-10">
                                {t.avatar_url && <AvatarImage src={t.avatar_url} alt={`Photo of ${t.full_name}`} />}
                                <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">{initials}</AvatarFallback>
                              </Avatar>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-semibold text-foreground">{t.full_name}</span>
                                <span className="block text-xs text-muted-foreground">
                                  {t.relation === 'assigned' ? 'General coach' : 'Personal training'}
                                  {t.trainer_code ? ` · ${t.trainer_code}` : ''}
                                </span>
                              </span>
                              {selected && currentTrainers.length > 1 && <Check className="h-4 w-4 text-primary" aria-hidden="true" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 p-4">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <UserPlus className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-foreground">You don't have a trainer yet</p>
                        <p className="text-xs text-muted-foreground">Tell us your goal and we'll match you with the right coach.</p>
                      </div>
                    </div>
                  )}

                  {reasonFlagOn && hasTrainer && (
                    <ChipGroup
                      label="Why do you want to change? (required)"
                      options={TRAINER_CHANGE_REASONS.map((r) => ({ value: r.code, label: r.label }))}
                      value={reasonCode}
                      onChange={(v) => setReasonCode(v as TrainerChangeReason)}
                      columns
                    />
                  )}

                  {reasonFlagOn && !hasTrainer && (
                    <ChipGroup
                      label="Your main goal"
                      options={TRAINER_GOALS.map((g) => ({ value: g, label: g }))}
                      value={goal}
                      onChange={setGoal}
                    />
                  )}

                  {reasonFlagOn && (
                    <>
                      <ChipGroup
                        label="Preferred time (optional)"
                        options={TRAINER_SLOTS.map((s) => ({ value: s, label: s }))}
                        value={slot}
                        onChange={(v) => setSlot(slot === v ? null : v)}
                      />
                      <div className="space-y-2">
                        <Label htmlFor="pref-trainer">Preferred trainer (optional)</Label>
                        <Input
                          id="pref-trainer"
                          value={preferredTrainer}
                          maxLength={80}
                          onChange={(e) => setPreferredTrainer(e.target.value)}
                          placeholder="No preference"
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              {kind === 'locker' && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                    {lockerCfg?.daily_use_note ||
                      'Our standard gym lockers are free for temporary, daily use while you work out. Choose a dedicated locker below if you would like one reserved for you for the rest of your membership.'}
                  </div>
                  <Label>Dedicated locker size</Label>
                  <div className="grid grid-cols-2 gap-3" role="group" aria-label="Dedicated locker size">
                    {LOCKER_SIZES.map((size) => {
                      const price = lockerPricing(size, lockerCfg);
                      const selected = lockerSize === size;
                      return (
                        <button
                          key={size}
                          type="button"
                          onClick={() => setLockerSize(size)}
                          aria-pressed={selected}
                          className={`flex min-h-[44px] flex-col items-start gap-1 rounded-xl border p-4 text-left transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary ${
                            selected ? 'border-primary bg-primary/10' : 'border-border/60 hover:bg-muted/60'
                          }`}
                        >
                          <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                            {selected && <Check className="h-3.5 w-3.5 text-primary" />}
                            {size}
                          </span>
                          <span className="text-lg font-bold tabular-nums text-foreground">₹{price.base.toLocaleString('en-IN')}</span>
                          <span className="text-xs text-muted-foreground">{price.gst ? `+ ₹${price.gst.toLocaleString("en-IN")} GST · ` : "No GST · "}₹{price.total.toLocaleString('en-IN')} total</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Valid until your current membership ends. The front desk confirms the locker number and collects payment.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="request-note">
                  {kind === 'trainer' && reasonFlagOn
                    ? hasTrainer
                      ? reasonNeedsDetails(reasonCode) ? 'What happened? (required)' : 'Details (optional)'
                      : 'Anything else we should know? (optional)'
                    : copy!.fieldLabel}
                </Label>
                <Textarea
                  id="request-note"
                  rows={kind === 'trainer' ? 4 : 5}
                  maxLength={kind === 'trainer' ? 500 : undefined}
                  placeholder={kind === 'trainer' && hasTrainer && reasonFlagOn
                    ? 'Share specifics so the manager can follow up — e.g. missed sessions, late arrivals…'
                    : copy!.placeholder}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  aria-required={kind === 'trainer' ? reasonNeedsDetails(reasonCode) || !reasonFlagOn : copy!.requireText}
                  aria-invalid={!!trainerError && note.length > 0}
                  aria-describedby={kind === 'trainer' ? 'trainer-error' : undefined}
                />
                {kind === 'trainer' && (
                  <p id="trainer-error" role="status" aria-live="polite" className="min-h-[1rem] text-xs text-muted-foreground">
                    {trainerError && (reasonCode || note.length > 0) ? trainerError : note.length > 0 ? `${note.length}/500` : ''}
                  </p>
                )}
              </div>

              {kind === 'trainer' && hasTrainer && reasonFlagOn ? (
                <p className="flex items-start gap-2 text-sm text-muted-foreground">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  Your feedback goes to the branch manager, not your trainer.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">{copy!.note}</p>
              )}
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
