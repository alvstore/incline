import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Gift, Calendar, Heart, Clock, ArrowRight, Sparkles, ShieldCheck, CheckCircle } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { invalidateMembersData } from '@/lib/memberInvalidation';
import { toast } from 'sonner';
import { addDays, parseISO, format } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';

interface CompGiftDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
  memberName?: string;
  membershipId?: string;
  branchId: string;
}

export function CompGiftDrawer({ open, onOpenChange, memberId, memberName, membershipId, branchId }: CompGiftDrawerProps) {
  const queryClient = useQueryClient();
  const { hasAnyRole } = useAuth();
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [compSessions, setCompSessions] = useState('1');
  const [compBenefitTypeId, setCompBenefitTypeId] = useState('');
  const [compReason, setCompReason] = useState('');
  const [compNotes, setCompNotes] = useState('');
  const [compExpiresAt, setCompExpiresAt] = useState('');

  const isManagerOrAbove = hasAnyRole(['owner', 'admin', 'manager']);

  // Fetch current membership details
  const { data: currentMembership } = useQuery({
    queryKey: ['comp-membership-details', membershipId],
    enabled: open && !!membershipId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('memberships')
        .select('id, start_date, end_date, status, membership_plans(name)')
        .eq('id', membershipId!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Fetch plan benefits with usage
  const { data: planBenefits = [] } = useQuery({
    queryKey: ['comp-plan-benefits', currentMembership?.id],
    enabled: open && !!currentMembership,
    queryFn: async () => {
      const ms = currentMembership as any;
      const { data: membership } = await supabase
        .from('memberships')
        .select('plan_id')
        .eq('id', ms.id)
        .single();
      if (!membership) return [];

      const { data: benefits } = await supabase
        .from('plan_benefits')
        .select('*, benefit_types:benefit_type_id(id, name, code)')
        .eq('plan_id', membership.plan_id);

      const { data: usage } = await supabase
        .from('benefit_usage')
        .select('benefit_type_id, usage_count')
        .eq('membership_id', ms.id);

      const usageMap: Record<string, number> = {};
      (usage || []).forEach((u: any) => {
        if (u.benefit_type_id) usageMap[u.benefit_type_id] = (usageMap[u.benefit_type_id] || 0) + (u.usage_count || 1);
      });

      return (benefits || []).map((b: any) => ({
        ...b,
        used: b.benefit_type_id ? (usageMap[b.benefit_type_id] || 0) : 0,
        remaining: b.frequency === 'unlimited' ? null : Math.max(0, (b.limit_count || 0) - (b.benefit_type_id ? (usageMap[b.benefit_type_id] || 0) : 0)),
      }));
    },
  });

  // Fetch existing comps
  const { data: existingComps = [] } = useQuery({
    queryKey: ['member-comps', memberId],
    enabled: open && !!memberId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_comps')
        .select('*, benefit_types:benefit_type_id(name)')
        .eq('member_id', memberId)
        .order('created_at', { ascending: false });
      if (error) return [];
      return data || [];
    },
  });

  const { data: benefitTypes = [] } = useQuery({
    queryKey: ['benefit-types-for-comp', branchId],
    enabled: open && !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('benefit_types')
        .select('id, name, code')
        .eq('branch_id', branchId)
        .eq('is_active', true)
        .order('display_order');
      if (error) throw error;
      return data || [];
    },
  });

  const newExpiryPreview = currentMembership && days
    ? format(addDays(parseISO(currentMembership.end_date), parseInt(days) || 0), 'dd MMM yyyy')
    : null;

  // Extend days mutation — role-aware
  const extendMutation = useMutation({
    mutationFn: async () => {
      if (!membershipId) throw new Error('No active membership');
      const daysNum = parseInt(days);
      if (!daysNum || daysNum <= 0) throw new Error('Enter valid days');

      const { data: { user } } = await supabase.auth.getUser();

      if (isManagerOrAbove) {
        // Direct execution for admin/manager/owner
        const newEndDate = format(addDays(parseISO(currentMembership!.end_date), daysNum), 'yyyy-MM-dd');
        const { error } = await supabase
          .from('memberships')
          .update({ end_date: newEndDate })
          .eq('id', membershipId);
        if (error) throw error;

        // Log in audit
        await supabase.from('audit_logs').insert({
          action: 'COMP_EXTEND',
          table_name: 'memberships',
          record_id: membershipId,
          user_id: user?.id,
          branch_id: branchId,
          actor_name: user?.email || 'Admin',
          action_description: `Extended membership by ${daysNum} days for ${memberName}. Reason: ${reason || 'Comp extension'}`,
          new_data: { days: daysNum, new_end_date: newEndDate, reason } as any,
        });
      } else {
        // Staff: submit for approval
        const { error } = await supabase.from('approval_requests').insert({
          approval_type: 'comp_gift' as any,
          branch_id: branchId,
          reference_id: membershipId,
          reference_type: 'extend_days',
          requested_by: user?.id,
          request_data: {
            memberName: memberName || 'Unknown',
            memberId,
            membershipId,
            days: daysNum,
            reason: reason || 'Comp extension',
            currentEndDate: currentMembership?.end_date,
            newEndDate: format(addDays(parseISO(currentMembership!.end_date), daysNum), 'yyyy-MM-dd'),
          },
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      if (isManagerOrAbove) {
        toast.success(`Extended membership by ${days} days`);
        queryClient.invalidateQueries({ queryKey: ['member-details'] });
        queryClient.invalidateQueries({ queryKey: ['memberships'] });
        invalidateMembersData(queryClient);
      } else {
        toast.success(`Extension request for ${days} days submitted for approval`);
        queryClient.invalidateQueries({ queryKey: ['approval-queue'] });
        queryClient.invalidateQueries({ queryKey: ['approval-stats'] });
      }
      setDays('');
      setReason('');
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Comp sessions mutation — role-aware
  const compMutation = useMutation({
    mutationFn: async () => {
      if (!compBenefitTypeId) throw new Error('Select a benefit type');
      const sessions = parseInt(compSessions);
      if (!sessions || sessions <= 0) throw new Error('Enter valid sessions');

      const { data: { user } } = await supabase.auth.getUser();
      const selectedBenefit = benefitTypes.find((bt: any) => bt.id === compBenefitTypeId);

      if (isManagerOrAbove) {
        // Direct execution for admin/manager/owner
        const { error } = await supabase.from('member_comps').insert({
          member_id: memberId,
          benefit_type_id: compBenefitTypeId,
          comp_sessions: sessions,
          used_sessions: 0,
          reason: compReason || 'Complimentary sessions',
          granted_by: user?.id,
        } as any);
        if (error) throw error;

        // Log in audit
        await supabase.from('audit_logs').insert({
          action: 'COMP_SESSIONS',
          table_name: 'member_comps',
          record_id: memberId,
          user_id: user?.id,
          branch_id: branchId,
          actor_name: user?.email || 'Admin',
          action_description: `Granted ${sessions} comp ${selectedBenefit?.name || 'benefit'} sessions to ${memberName}. Reason: ${compReason || 'Complimentary'}`,
          new_data: { sessions, benefitType: selectedBenefit?.name, reason: compReason } as any,
        });
      } else {
        // Staff: submit for approval
        const { error } = await supabase.from('approval_requests').insert({
          approval_type: 'comp_gift' as any,
          branch_id: branchId,
          reference_id: memberId,
          reference_type: 'comp_sessions',
          requested_by: user?.id,
          request_data: {
            memberName: memberName || 'Unknown',
            memberId,
            membershipId: membershipId || null,
            benefitTypeId: compBenefitTypeId,
            benefitTypeName: selectedBenefit?.name || 'Benefit',
            sessions,
            reason: compReason || 'Complimentary sessions',
          },
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      if (isManagerOrAbove) {
        toast.success(`Comp sessions granted successfully`);
        queryClient.invalidateQueries({ queryKey: ['member-comps'] });
        queryClient.invalidateQueries({ queryKey: ['member-details'] });
        invalidateMembersData(queryClient);
      } else {
        toast.success(`Comp sessions request submitted for approval`);
        queryClient.invalidateQueries({ queryKey: ['approval-queue'] });
        queryClient.invalidateQueries({ queryKey: ['approval-stats'] });
      }
      setCompSessions('1');
      setCompBenefitTypeId('');
      setCompReason('');
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const activeComps = existingComps.filter((c: any) => c.used_sessions < c.comp_sessions);

  // Merge plan + comp totals per benefit so members/staff see one combined number
  const combinedBenefits = (() => {
    const map = new Map<string, { name: string; planRemaining: number | null; planLimit: number; planUsed: number; compRemaining: number; unlimited: boolean }>();
    planBenefits.forEach((b: any) => {
      const name = b.benefit_types?.name || b.benefit_type;
      const unlimited = b.frequency === 'unlimited';
      map.set(name, {
        name,
        unlimited,
        planLimit: b.limit_count || 0,
        planUsed: b.used || 0,
        planRemaining: unlimited ? null : (b.remaining ?? 0),
        compRemaining: 0,
      });
    });
    activeComps.forEach((c: any) => {
      const name = c.benefit_types?.name || 'Benefit';
      const remaining = c.comp_sessions - c.used_sessions;
      const existing = map.get(name);
      if (existing) {
        existing.compRemaining += remaining;
      } else {
        map.set(name, { name, unlimited: false, planLimit: 0, planUsed: 0, planRemaining: 0, compRemaining: remaining });
      }
    });
    return Array.from(map.values()).filter(b => b.unlimited || (b.planRemaining || 0) + b.compRemaining > 0 || b.planLimit > 0);
  })();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-primary" />
            Comp / Gift — {memberName}
          </SheetTitle>
          <SheetDescription>
            {isManagerOrAbove
              ? 'As a manager, your actions will be applied immediately'
              : 'Requests are routed through the approval queue for audit compliance'}
          </SheetDescription>
        </SheetHeader>

        {/* Role Notice */}
        <div className={`mt-3 flex items-center gap-2 p-3 rounded-lg border ${
          isManagerOrAbove
            ? 'bg-success/5 border-success/20'
            : 'bg-primary/5 border-primary/20'
        }`}>
          {isManagerOrAbove ? (
            <>
              <CheckCircle className="h-4 w-4 text-success flex-shrink-0" />
              <p className="text-xs text-muted-foreground">
                You have <span className="font-semibold text-success">direct execution</span> privileges. Changes apply immediately.
              </p>
            </>
          ) : (
            <>
              <ShieldCheck className="h-4 w-4 text-primary flex-shrink-0" />
              <p className="text-xs text-muted-foreground">
                All comp/gift requests require <span className="font-semibold text-foreground">Owner/Admin approval</span> before being applied.
              </p>
            </>
              )}
        </div>

        {/* Current Status Overview */}
        {currentMembership && (
          <Card className="mt-4 border-primary/20 bg-primary/5">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs text-muted-foreground">Current Plan</p>
                  <p className="font-semibold text-sm">{(currentMembership as any).membership_plans?.name}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Expires</p>
                  <p className="font-semibold text-sm">{format(parseISO(currentMembership.end_date), 'dd MMM yyyy')}</p>
                </div>
              </div>

              {planBenefits.length > 0 && (
                <>
                  <Separator className="my-3" />
                  <p className="text-xs font-medium text-muted-foreground mb-2">PLAN BENEFITS</p>
                  <div className="space-y-1.5">
                    {planBenefits.map((b: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between text-xs">
                        <span className="font-medium">{b.benefit_types?.name || b.benefit_type}</span>
                        {b.frequency === 'unlimited' ? (
                          <Badge variant="secondary" className="text-[10px] h-5">∞ Unlimited</Badge>
                        ) : (
                          <span className={`${b.remaining === 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                            {b.used}/{b.limit_count} used
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {activeComps.length > 0 && (
                <>
                  <Separator className="my-3" />
                  <p className="text-xs font-medium text-muted-foreground mb-2">ACTIVE COMPS</p>
                  <div className="space-y-1.5">
                    {activeComps.map((c: any) => (
                      <div key={c.id} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <Sparkles className="h-3 w-3 text-warning" />
                          <span className="font-medium">{c.benefit_types?.name || 'Benefit'}</span>
                        </div>
                        <Badge className="bg-warning/10 text-warning border-warning/30 text-[10px] h-5">
                          {c.comp_sessions - c.used_sessions} remaining
                        </Badge>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {combinedBenefits.some(b => b.compRemaining > 0) && (
                <>
                  <Separator className="my-3" />
                  <p className="text-xs font-medium text-muted-foreground mb-2">TOTAL AVAILABLE (PLAN + COMP)</p>
                  <div className="space-y-1.5">
                    {combinedBenefits.filter(b => b.compRemaining > 0 || (!b.unlimited && b.planLimit > 0)).map((b, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs">
                        <span className="font-medium">{b.name}</span>
                        {b.unlimited ? (
                          <Badge variant="secondary" className="text-[10px] h-5">∞ Unlimited + {b.compRemaining} comp</Badge>
                        ) : (
                          <span className="text-foreground font-semibold">
                            {(b.planRemaining || 0) + b.compRemaining} available
                            <span className="text-muted-foreground font-normal ml-1">
                              ({b.planRemaining || 0} plan + {b.compRemaining} comp)
                            </span>
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="extend" className="mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="extend" className="gap-1.5">
              <Calendar className="h-3.5 w-3.5" /> Extend Days
            </TabsTrigger>
            <TabsTrigger value="comp" className="gap-1.5">
              <Heart className="h-3.5 w-3.5" /> Comp Sessions
            </TabsTrigger>
          </TabsList>

          <TabsContent value="extend" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Extra Days *</Label>
              <Input type="number" min="1" value={days} onChange={e => setDays(e.target.value)} placeholder="e.g. 7" />
            </div>

            {newExpiryPreview && (
              <Card className="border-success/30 bg-success/5">
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span>{format(parseISO(currentMembership!.end_date), 'dd MMM yyyy')}</span>
                    <ArrowRight className="h-4 w-4 text-success" />
                    <span className="font-bold text-success">{newExpiryPreview}</span>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="space-y-2">
              <Label>Reason *</Label>
              <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Service recovery, loyalty gesture" />
            </div>
            <SheetFooter>
              <Button onClick={() => extendMutation.mutate()} disabled={extendMutation.isPending || !membershipId}>
                {isManagerOrAbove ? (
                  <CheckCircle className="h-4 w-4 mr-2" />
                ) : (
                  <ShieldCheck className="h-4 w-4 mr-2" />
                )}
                {extendMutation.isPending
                  ? 'Processing...'
                  : isManagerOrAbove
                    ? 'Apply Extension'
                    : 'Submit for Approval'}
              </Button>
            </SheetFooter>
          </TabsContent>

          <TabsContent value="comp" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Benefit Type *</Label>
              <Select value={compBenefitTypeId} onValueChange={setCompBenefitTypeId}>
                <SelectTrigger><SelectValue placeholder="Select benefit" /></SelectTrigger>
                <SelectContent>
                  {benefitTypes.map((bt: any) => (
                    <SelectItem key={bt.id} value={bt.id}>{bt.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Number of Free Sessions *</Label>
              <Input type="number" min="1" value={compSessions} onChange={e => setCompSessions(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Reason *</Label>
              <Textarea value={compReason} onChange={e => setCompReason(e.target.value)} placeholder="e.g. Birthday gift, complaint resolution" />
            </div>
            <SheetFooter>
              <Button onClick={() => compMutation.mutate()} disabled={compMutation.isPending}>
                {isManagerOrAbove ? (
                  <CheckCircle className="h-4 w-4 mr-2" />
                ) : (
                  <ShieldCheck className="h-4 w-4 mr-2" />
                )}
                {compMutation.isPending
                  ? 'Processing...'
                  : isManagerOrAbove
                    ? 'Grant Comp Sessions'
                    : 'Submit for Approval'}
              </Button>
            </SheetFooter>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}