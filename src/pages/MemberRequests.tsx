import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useMemberData } from '@/hooks/useMemberData';
import { AlertCircle, Loader2, Snowflake, Sun, User, Lock, UtensilsCrossed, Dumbbell } from 'lucide-react';
import { RequestsHero } from '@/components/member/requests/RequestsHero';
import { RequestLauncher } from '@/components/member/requests/RequestLauncher';
import { RequestTimeline, type TimelineItem } from '@/components/member/requests/RequestTimeline';
import { RequestComposerDrawer } from '@/components/member/requests/RequestComposerDrawer';
import type { RequestKind, RequestOption } from '@/components/member/requests/requestTypes';

export default function MemberRequests() {
  const { user } = useAuth();
  const { member, activeMembership, isLoading: memberLoading } = useMemberData();
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerKind, setComposerKind] = useState<RequestKind | null>(null);

  const isFrozen = activeMembership?.status === 'frozen';
  const freezeDaysAllowance = Number((activeMembership as any)?.plan?.max_freeze_days || 0);
  const freezeAllowed = freezeDaysAllowance > 0;

  // Approval-backed requests (freeze / unfreeze / trainer / locker)
  const { data: requests = [], isLoading: requestsLoading } = useQuery({
    queryKey: ['my-requests', member?.id],
    enabled: !!member,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('approval_requests')
        .select('*')
        .eq('reference_id', member!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Plan requests are recorded as trainer tasks — surface them in the timeline too.
  const { data: planRequests = [], isLoading: planRequestsLoading } = useQuery({
    queryKey: ['my-plan-requests', member?.id],
    enabled: !!member,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('id, title, description, status, created_at')
        .eq('linked_entity_type', 'member')
        .eq('linked_entity_id', member!.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []).filter((t: any) => /plan request from/i.test(t.title || ''));
    },
  });

  const timelineItems: TimelineItem[] = useMemo(() => {
    const approvalItems: TimelineItem[] = (requests as any[]).map((r) => {
      let kind: RequestKind = 'freeze';
      let label = 'Membership freeze';
      if (r.reference_type === 'trainer_change') {
        kind = 'trainer';
        label = 'Trainer request';
      } else if (r.reference_type === 'locker') {
        kind = 'locker';
        label = 'Locker request';
      } else if (r.reference_type === 'membership_unfreeze') {
        kind = 'unfreeze';
        label = 'Membership unfreeze';
      }
      const status: TimelineItem['status'] =
        r.status === 'approved' ? 'approved' : r.status === 'rejected' ? 'rejected' : 'pending';
      return {
        id: r.id,
        kind,
        label,
        status,
        createdAt: r.created_at,
        reason: r.request_data?.reason || r.request_data?.note || null,
        response: r.review_notes || null,
      };
    });

    // Tasks are created per trainer — collapse duplicates by title + day.
    const seen = new Set<string>();
    const planItems: TimelineItem[] = [];
    for (const t of planRequests as any[]) {
      const isDiet = /diet/i.test(t.title || '');
      const dedupeKey = `${t.title}-${(t.created_at || '').slice(0, 10)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      planItems.push({
        id: t.id,
        kind: isDiet ? 'diet' : 'workout',
        label: isDiet ? 'Diet plan request' : 'Workout plan request',
        status: t.status === 'completed' ? 'approved' : t.status === 'cancelled' ? 'rejected' : 'pending',
        createdAt: t.created_at,
        reason: t.description || null,
        response: null,
      });
    }

    return [...approvalItems, ...planItems].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [requests, planRequests]);

  const hasPending = (kind: RequestKind) =>
    timelineItems.some((i) => i.kind === kind && i.status === 'pending');

  const options: RequestOption[] = useMemo(() => {
    const list: RequestOption[] = [];

    if (isFrozen) {
      list.push({
        kind: 'unfreeze',
        title: 'Resume membership',
        description: 'Lift the freeze and restore your gym access',
        icon: Sun,
        tone: 'bg-info/10 text-info',
        disabledReason: hasPending('unfreeze') ? 'Request already pending' : undefined,
      });
    } else if (freezeAllowed) {
      list.push({
        kind: 'freeze',
        title: 'Freeze membership',
        description: `Pause your plan — ${freezeDaysAllowance} freeze days included`,
        icon: Snowflake,
        tone: 'bg-info/10 text-info',
        disabledReason: !activeMembership
          ? 'No active membership'
          : hasPending('freeze')
            ? 'Request already pending'
            : undefined,
      });
    }

    list.push({
      kind: 'trainer',
      title: member?.assigned_trainer_id ? 'Change trainer' : 'Request a trainer',
      description: member?.assigned_trainer_id
        ? 'Ask for a different personal trainer'
        : 'Get a personal trainer assigned to you',
      icon: User,
      tone: 'bg-primary/10 text-primary',
      disabledReason: hasPending('trainer') ? 'Request already pending' : undefined,
    });

    list.push({
      kind: 'locker',
      title: 'Request a locker',
      description: 'Ask the front desk to allocate a locker',
      icon: Lock,
      tone: 'bg-warning/10 text-warning',
      disabledReason: hasPending('locker') ? 'Request already pending' : undefined,
    });

    list.push({
      kind: 'diet',
      title: 'Request a diet plan',
      description: 'Personalised nutrition from your trainer',
      icon: UtensilsCrossed,
      tone: 'bg-success/10 text-success',
    });

    list.push({
      kind: 'workout',
      title: 'Request a workout plan',
      description: 'A routine designed around your goals',
      icon: Dumbbell,
      tone: 'bg-success/10 text-success',
    });

    return list;
  }, [isFrozen, freezeAllowed, freezeDaysAllowance, activeMembership, member, timelineItems]);

  const openComposer = (kind: RequestKind | null) => {
    setComposerKind(kind);
    setComposerOpen(true);
  };

  if (memberLoading) {
    return (
      <AppLayout>
        <div className="flex min-h-[50vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  if (!member) {
    return (
      <AppLayout>
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
          <AlertCircle className="h-12 w-12 text-warning" />
          <h2 className="text-xl font-semibold">No Member Profile Found</h2>
        </div>
      </AppLayout>
    );
  }

  const memberName = ((member as any)?.profiles?.full_name || member.member_code || 'Member')
    .split(' ')[0];
  const openCount = timelineItems.filter((i) => i.status === 'pending').length;
  const approvedCount = timelineItems.filter((i) => i.status === 'approved').length;

  const contextChips = [
    {
      label: 'Membership',
      value: isFrozen ? 'Frozen' : activeMembership ? 'Active' : 'None',
      tone: isFrozen
        ? 'bg-info/10 text-info'
        : activeMembership
          ? 'bg-success/10 text-success'
          : 'bg-muted text-muted-foreground',
    },
    {
      label: 'Trainer',
      value: member.assigned_trainer_id ? 'Assigned' : 'Not assigned',
      tone: member.assigned_trainer_id ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground',
    },
    {
      label: 'Freeze days',
      value: freezeAllowed ? `${freezeDaysAllowance} included` : 'Not in plan',
      tone: freezeAllowed ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
    },
  ];

  return (
    <AppLayout>
      <div className="space-y-6">
        <RequestsHero
          memberName={memberName}
          openCount={openCount}
          approvedCount={approvedCount}
          totalCount={timelineItems.length}
          onNewRequest={() => openComposer(null)}
        />

        <div className="flex flex-wrap gap-2">
          {contextChips.map((chip) => (
            <Badge
              key={chip.label}
              className={`rounded-full border-transparent px-3 py-1 text-xs font-medium ${chip.tone}`}
            >
              {chip.label}: {chip.value}
            </Badge>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <RequestLauncher options={options} onSelect={(kind) => openComposer(kind)} />
          <RequestTimeline
            items={timelineItems}
            isLoading={requestsLoading || planRequestsLoading}
            onNewRequest={() => openComposer(null)}
          />
        </div>
      </div>

      <RequestComposerDrawer
        open={composerOpen}
        onOpenChange={setComposerOpen}
        initialKind={composerKind}
        options={options}
        member={member}
        activeMembership={activeMembership}
        userId={user!.id}
        trainerName={(member as any)?.trainer?.full_name || null}
        freezeDaysAllowance={freezeDaysAllowance}
      />
    </AppLayout>
  );
}
