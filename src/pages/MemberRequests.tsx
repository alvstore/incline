import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from '@/components/ui/sheet';
import { supabase } from '@/integrations/supabase/client';
import { useMemberData } from '@/hooks/useMemberData';
import { Snowflake, User, Clock, AlertCircle, Loader2, CheckCircle, XCircle, Plus, UtensilsCrossed, Dumbbell } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

export default function MemberRequests() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { member, activeMembership, isLoading: memberLoading } = useMemberData();
  const [freezeReason, setFreezeReason] = useState('');
  const [trainerChangeReason, setTrainerChangeReason] = useState('');
  const [unfreezeReason, setUnfreezeReason] = useState('');
  const [freezeSheetOpen, setFreezeSheetOpen] = useState(false);
  const [trainerSheetOpen, setTrainerSheetOpen] = useState(false);
  const [unfreezeSheetOpen, setUnfreezeSheetOpen] = useState(false);
  const [planRequestOpen, setPlanRequestOpen] = useState<null | 'diet' | 'workout'>(null);
  const [planNote, setPlanNote] = useState('');

  const isFrozen = activeMembership?.status === 'frozen';

  // Fetch existing requests
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

  // Submit freeze request
  const submitFreezeRequest = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('approval_requests')
        .insert({
          approval_type: 'membership_freeze' as const,
          reference_type: 'member',
          reference_id: member!.id,
          branch_id: member!.branch_id,
          requested_by: user!.id,
          request_data: {
            membershipId: activeMembership?.id,
            reason: freezeReason,
            requested_at: new Date().toISOString(),
          },
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Freeze request submitted');
      setFreezeSheetOpen(false);
      setFreezeReason('');
      queryClient.invalidateQueries({ queryKey: ['my-requests'] });
    },
    onError: () => {
      toast.error('Failed to submit request');
    },
  });

  // Submit trainer change request - using discount as placeholder since trainer_change isn't in enum
  const submitTrainerChangeRequest = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('approval_requests')
        .insert({
          approval_type: 'complimentary' as const,
          reference_type: 'trainer_change',
          reference_id: member!.id,
          branch_id: member!.branch_id,
          requested_by: user!.id,
          request_data: {
            current_trainer_id: member!.assigned_trainer_id,
            reason: trainerChangeReason,
            requested_at: new Date().toISOString(),
          },
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Trainer change request submitted');
      setTrainerSheetOpen(false);
      setTrainerChangeReason('');
      queryClient.invalidateQueries({ queryKey: ['my-requests'] });
    },
    onError: () => {
      toast.error('Failed to submit request');
    },
  });

  // Submit unfreeze request
  const submitUnfreezeRequest = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('approval_requests')
        .insert({
          approval_type: 'membership_freeze' as const,
          reference_type: 'membership_unfreeze',
          reference_id: member!.id,
          branch_id: member!.branch_id,
          requested_by: user!.id,
          request_data: {
            membershipId: activeMembership?.id,
            reason: unfreezeReason,
            requested_at: new Date().toISOString(),
          },
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Unfreeze request submitted');
      setUnfreezeSheetOpen(false);
      setUnfreezeReason('');
      queryClient.invalidateQueries({ queryKey: ['my-requests'] });
    },
    onError: () => {
      toast.error('Failed to submit request');
    },
  });

  // Request a Diet/Workout plan — creates tasks for the assigned trainer
  // (or all branch trainers when none is assigned).
  const submitPlanRequest = useMutation({
    mutationFn: async (planType: 'diet' | 'workout') => {
      const memberName = (member as any)?.profiles?.full_name || member!.member_code || 'Member';
      const title = planType === 'diet'
        ? `Diet plan request from ${memberName}`
        : `Workout plan request from ${memberName}`;

      // Resolve trainer assignees: prefer the assigned trainer; fall back to
      // all active trainers in the branch.
      const assignees: string[] = [];
      if (member!.assigned_trainer_id) {
        const { data: t } = await (supabase as any)
          .from('trainers_directory')
          .select('user_id')
          .eq('id', member!.assigned_trainer_id)
          .maybeSingle();
        if (t?.user_id) assignees.push(t.user_id);
      }
      if (assignees.length === 0) {
        const { data: branchTrainers } = await (supabase as any)
          .from('trainers_directory')
          .select('user_id')
          .eq('branch_id', member!.branch_id)
          .eq('is_active', true);
        (branchTrainers || []).forEach((t: any) => t.user_id && assignees.push(t.user_id));
      }

      // Always at least record one task even if no trainers exist.
      const targets = assignees.length > 0 ? assignees : [null];

      const rows = targets.map((uid) => ({
        branch_id: member!.branch_id,
        title,
        description: planNote || `Member ${memberName} has requested a new ${planType} plan.`,
        priority: 'medium',
        status: 'pending',
        assigned_to: uid,
        assigned_by: user!.id,
        linked_entity_type: 'member',
        linked_entity_id: member!.id,
      }));
      const { error } = await supabase.from('tasks').insert(rows as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Request sent to your trainer');
      setPlanRequestOpen(null);
      setPlanNote('');
    },
    onError: (e: any) => {
      toast.error(e?.message || 'Failed to submit request');
    },
  });

  if (memberLoading || requestsLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  if (!member) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
          <AlertCircle className="h-12 w-12 text-warning" />
          <h2 className="text-xl font-semibold">No Member Profile Found</h2>
        </div>
      </AppLayout>
    );
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return <Badge variant="default" className="bg-success"><CheckCircle className="h-3 w-3 mr-1" />Approved</Badge>;
      case 'pending':
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
      case 'rejected':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Rejected</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getRequestTypeLabel = (request: any) => {
    if (request.reference_type === 'trainer_change') return 'Trainer Change';
    if (request.reference_type === 'membership_unfreeze') return 'Membership Unfreeze';
    switch (request.approval_type) {
      case 'membership_freeze':
        return 'Membership Freeze';
      default:
        return request.approval_type;
    }
  };

  const hasPendingTrainerRequest = requests.some(
    (r: any) => r.reference_type === 'trainer_change' && r.status === 'pending'
  );
  const hasPendingFreezeRequest = requests.some(
    (r: any) => r.approval_type === 'membership_freeze' && r.reference_type !== 'membership_unfreeze' && r.status === 'pending'
  );
  const hasPendingUnfreezeRequest = requests.some(
    (r: any) => r.reference_type === 'membership_unfreeze' && r.status === 'pending'
  );

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Requests</h1>
          <p className="text-muted-foreground">Manage membership and service requests</p>
        </div>

        {/* Quick Actions */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Freeze / Unfreeze Card */}
          {isFrozen ? (
            <Card className="border-info/50 bg-info/5">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-info">
                    <Snowflake className="h-5 w-5" />
                    Membership Frozen
                  </CardTitle>
                  <Badge className="bg-info/10 text-info">Paused</Badge>
                </div>
                <CardDescription>
                  Your membership is currently paused. You do not have gym access.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Sheet open={unfreezeSheetOpen} onOpenChange={setUnfreezeSheetOpen}>
                  <SheetTrigger asChild>
                    <Button
                      className="w-full"
                      variant="outline"
                      disabled={hasPendingUnfreezeRequest}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      {hasPendingUnfreezeRequest ? 'Unfreeze Request Pending' : 'Request Unfreeze'}
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="right">
                    <SheetHeader>
                      <SheetTitle>Request Membership Unfreeze</SheetTitle>
                    </SheetHeader>
                    <div className="space-y-4 py-4">
                      <div>
                        <label className="text-sm font-medium">Reason for unfreeze</label>
                        <Textarea
                          placeholder="e.g., Back from travel, Ready to resume training, etc."
                          value={unfreezeReason}
                          onChange={(e) => setUnfreezeReason(e.target.value)}
                          className="mt-2"
                        />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Your request will be reviewed by the management. Once approved, your membership will resume and the end date will be extended.
                      </p>
                    </div>
                    <SheetFooter>
                      <Button variant="outline" onClick={() => setUnfreezeSheetOpen(false)}>Cancel</Button>
                      <Button
                        onClick={() => submitUnfreezeRequest.mutate()}
                        disabled={!unfreezeReason || submitUnfreezeRequest.isPending}
                      >
                        Submit Request
                      </Button>
                    </SheetFooter>
                  </SheetContent>
                </Sheet>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-border/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Snowflake className="h-5 w-5" />
                  Freeze Membership
                </CardTitle>
                <CardDescription>
                  Temporarily pause your membership while you're away
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Sheet open={freezeSheetOpen} onOpenChange={setFreezeSheetOpen}>
                  <SheetTrigger asChild>
                    <Button
                      className="w-full"
                      variant="outline"
                      disabled={!activeMembership || hasPendingFreezeRequest}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      {hasPendingFreezeRequest ? 'Request Pending' : 'Request Freeze'}
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="right">
                    <SheetHeader>
                      <SheetTitle>Request Membership Freeze</SheetTitle>
                    </SheetHeader>
                    <div className="space-y-4 py-4">
                      <div>
                        <label className="text-sm font-medium">Reason for freeze</label>
                        <Textarea
                          placeholder="e.g., Traveling for work, Medical reasons, etc."
                          value={freezeReason}
                          onChange={(e) => setFreezeReason(e.target.value)}
                          className="mt-2"
                        />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Your request will be reviewed by the management. You'll be notified once approved.
                      </p>
                    </div>
                    <SheetFooter>
                      <Button variant="outline" onClick={() => setFreezeSheetOpen(false)}>Cancel</Button>
                      <Button
                        onClick={() => submitFreezeRequest.mutate()}
                        disabled={!freezeReason || submitFreezeRequest.isPending}
                      >
                        Submit Request
                      </Button>
                    </SheetFooter>
                  </SheetContent>
                </Sheet>
              </CardContent>
            </Card>
          )}

          {/* Trainer Change Request */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                {member.assigned_trainer_id ? 'Change Trainer' : 'Request Trainer'}
              </CardTitle>
              <CardDescription>
                {member.assigned_trainer_id 
                  ? 'Request a different personal trainer' 
                  : 'Request a personal trainer assignment'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Sheet open={trainerSheetOpen} onOpenChange={setTrainerSheetOpen}>
                <SheetTrigger asChild>
                   <Button className="w-full" variant="outline" disabled={hasPendingTrainerRequest}>
                    <Plus className="h-4 w-4 mr-2" />
                    {hasPendingTrainerRequest ? 'Request Pending' : (member.assigned_trainer_id ? 'Request Trainer Change' : 'Request Trainer')}
                  </Button>
                </SheetTrigger>
                <SheetContent side="right">
                  <SheetHeader>
                    <SheetTitle>Request Trainer Change</SheetTitle>
                  </SheetHeader>
                  <div className="space-y-4 py-4">
                    <div>
                      <label className="text-sm font-medium">Reason for change</label>
                      <Textarea
                        placeholder="e.g., Schedule conflicts, Training style preference, etc."
                        value={trainerChangeReason}
                        onChange={(e) => setTrainerChangeReason(e.target.value)}
                        className="mt-2"
                      />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Your request will be reviewed and a suitable trainer will be assigned.
                    </p>
                  </div>
                  <SheetFooter>
                    <Button
                      variant="outline"
                      onClick={() => setTrainerSheetOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={() => submitTrainerChangeRequest.mutate()}
                      disabled={!trainerChangeReason || submitTrainerChangeRequest.isPending}
                    >
                      Submit Request
                    </Button>
                  </SheetFooter>
                </SheetContent>
              </Sheet>
            </CardContent>
          </Card>

          {/* Diet Plan Request */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UtensilsCrossed className="h-5 w-5" />
                Request Diet Plan
              </CardTitle>
              <CardDescription>
                Ask your trainer to prepare a personalised nutrition plan
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full"
                variant="outline"
                onClick={() => setPlanRequestOpen('diet')}
              >
                <Plus className="h-4 w-4 mr-2" /> Request Diet Plan
              </Button>
            </CardContent>
          </Card>

          {/* Workout Plan Request */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Dumbbell className="h-5 w-5" />
                Request Workout Plan
              </CardTitle>
              <CardDescription>
                Ask your trainer to design a workout routine for your goals
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full"
                variant="outline"
                onClick={() => setPlanRequestOpen('workout')}
              >
                <Plus className="h-4 w-4 mr-2" /> Request Workout Plan
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Plan request sheet */}
        <Sheet open={!!planRequestOpen} onOpenChange={(o) => !o && setPlanRequestOpen(null)}>
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>
                Request {planRequestOpen === 'diet' ? 'Diet' : 'Workout'} Plan
              </SheetTitle>
            </SheetHeader>
            <div className="space-y-4 py-4">
              <div>
                <label className="text-sm font-medium">Notes for your trainer (optional)</label>
                <Textarea
                  placeholder="Goals, allergies, preferences, schedule…"
                  value={planNote}
                  onChange={(e) => setPlanNote(e.target.value)}
                  className="mt-2"
                />
              </div>
              <p className="text-sm text-muted-foreground">
                A task will be created for your assigned trainer (or all branch trainers)
                so they can prepare your plan.
              </p>
            </div>
            <SheetFooter>
              <Button variant="outline" onClick={() => setPlanRequestOpen(null)}>Cancel</Button>
              <Button
                onClick={() => planRequestOpen && submitPlanRequest.mutate(planRequestOpen)}
                disabled={submitPlanRequest.isPending}
              >
                {submitPlanRequest.isPending ? 'Submitting…' : 'Send Request'}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        {/* Request History */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle>Request History</CardTitle>
          </CardHeader>
          <CardContent>
            {requests.length === 0 ? (
              <div className="text-center py-12">
                <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No requests yet</p>
              </div>
            ) : (
              <div className="space-y-4">
                {requests.map((request: any) => (
                  <Card key={request.id} className="border-border/50">
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-semibold">{getRequestTypeLabel(request)}</h4>
                          <p className="text-sm text-muted-foreground">
                            Submitted on {format(new Date(request.created_at), 'dd MMM yyyy')}
                          </p>
                          {request.request_data?.reason && (
                            <p className="text-sm mt-2">{request.request_data.reason}</p>
                          )}
                          {request.review_notes && (
                            <p className="text-sm text-muted-foreground mt-2">
                              <span className="font-medium">Response:</span> {request.review_notes}
                            </p>
                          )}
                        </div>
                        {getStatusBadge(request.status)}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
