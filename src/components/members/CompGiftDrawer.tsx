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
import { Switch } from '@/components/ui/switch';
import { Gift, Calendar, Heart, Clock, ArrowRight, Sparkles, ShieldCheck, CheckCircle } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { invalidateMembersData } from '@/lib/memberInvalidation';
import { invalidateBenefitData } from '@/lib/benefits/invalidateBenefitData';
import { toast } from 'sonner';
import { addDays, parseISO, format } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { CompAmendActions } from '@/components/members/CompAmendActions';


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
  // Complimentary benefits normally expire with the membership itself.
  const [syncExpiryToMembership, setSyncExpiryToMembership] = useState(true);

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

  // Keep the comp expiry pinned to the membership end date while the toggle is on.
  useEffect(() => {
    if (syncExpiryToMembership && currentMembership?.end_date) {
      setCompExpiresAt(format(parseISO(String(currentMembership.end_date)), 'yyyy-MM-dd'));
    }
  }, [syncExpiryToMembership, currentMembership?.end_date]);

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
        // Atomic server-side extension: extends end_date, writes the free-days
        // ledger row and the audit entry in one transaction.
        const { error } = await supabase.rpc('grant_membership_free_days' as never, {
          p_membership_id: membershipId,
          p_days: daysNum,
          p_reason: reason || 'Comp extension',
        } as never);
        if (error) throw error;
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

  // Comp sessions mutation — atomic via grant_member_comp RPC
  const compMutation = useMutation({
    mutationFn: async () => {
      if (!compBenefitTypeId) throw new Error('Select a benefit type');
      const sessions = parseInt(compSessions);
      if (!sessions || sessions <= 0) throw new Error('Enter valid sessions');

      const { data: { user } } = await supabase.auth.getUser();
      const selectedBenefit = benefitTypes.find((bt: any) => bt.id === compBenefitTypeId);
      const expiresIso = compExpiresAt ? new Date(compExpiresAt).toISOString() : null;

      if (isManagerOrAbove) {
        // Direct execution — one atomic RPC (comp + audit + branch scoping)
        const { data, error } = await supabase.rpc('grant_member_comp', {
          p_member_id: memberId,
          p_benefit_type_id: compBenefitTypeId,
          p_sessions: sessions,
          p_reason: compReason || 'Complimentary sessions',
          p_notes: compNotes || null,
          p_expires_at: expiresIso,
          p_source: 'direct',
          p_approval_request_id: null,
          p_membership_id: membershipId || null,
          p_branch_id: branchId,
          p_granted_by: user?.id ?? null,
        });
        if (error) throw error;
        const res = data as { success?: boolean; error?: string } | null;
        if (!res?.success) throw new Error(res?.error || 'Failed to grant comp');
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
            notes: compNotes || null,
            expiresAt: expiresIso,
          },
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      if (isManagerOrAbove) {
        toast.success(`Comp sessions granted successfully`);
        invalidateBenefitData(queryClient);
        invalidateMembersData(queryClient);
      } else {

        toast.success(`Comp sessions request submitted for approval`);
        queryClient.invalidateQueries({ queryKey: ['approval-queue'] });
        queryClient.invalidateQueries({ queryKey: ['approval-stats'] });
      }
      setCompSessions('1');
      setCompBenefitTypeId('');
      setCompReason('');
      setCompNotes('');
      setCompExpiresAt('');
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
            {!membershipId && (
              <p className="text-xs font-medium text-red-600">
                This member has no active or scheduled plan to extend.
              </p>
            )}
            {membershipId && (!(parseInt(days) > 0) || reason.trim().length < 6) && (
              <p className="text-xs text-slate-500">Enter a day count above 0 and a reason of at least 6 characters.</p>
            )}
            <SheetFooter>
              <Button
                onClick={() => extendMutation.mutate()}
                disabled={
                  extendMutation.isPending ||
                  !membershipId ||
                  !(parseInt(days) > 0) ||
                  reason.trim().length < 6
                }
              >
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Free Sessions *</Label>
                <Input type="number" min="1" value={compSessions} onChange={e => setCompSessions(e.target.value)} />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="comp-expiry">Expires on</Label>
                  {currentMembership?.end_date && (
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500">
                      <Switch
                        id="comp-sync-membership"
                        checked={syncExpiryToMembership}
                        onCheckedChange={setSyncExpiryToMembership}
                      />
                      Match membership
                    </label>
                  )}
                </div>
                <Input
                  id="comp-expiry"
                  type="date"
                  value={compExpiresAt}
                  disabled={syncExpiryToMembership}
                  onChange={e => setCompExpiresAt(e.target.value)}
                />
                {syncExpiryToMembership && currentMembership?.end_date && (
                  <p className="text-xs text-slate-500">
                    Auto-set to the membership end date ({format(parseISO(String(currentMembership.end_date)), 'dd MMM yyyy')}).
                  </p>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Reason *</Label>
              <Textarea value={compReason} onChange={e => setCompReason(e.target.value)} placeholder="e.g. Birthday gift, complaint resolution" />
            </div>
            <div className="space-y-2">
              <Label>Internal notes</Label>
              <Textarea value={compNotes} onChange={e => setCompNotes(e.target.value)} placeholder="Optional — visible to managers only" rows={2} />
            </div>

            {existingComps.length > 0 && (
              <div className="rounded-2xl bg-white shadow-lg shadow-slate-200/50 p-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Comp history</p>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {existingComps.map((c: any) => (
                    <div key={c.id} className="flex items-start justify-between text-xs gap-2 py-1.5 border-b border-slate-100 last:border-0">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-slate-900">{c.benefit_types?.name || 'Benefit'}</span>
                          <Badge className={`h-4 text-[10px] px-1.5 ${c.source === 'approval' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>
                            {c.source === 'approval' ? 'Approval' : 'Direct'}
                          </Badge>
                        </div>
                        <p className="text-slate-500 truncate">{c.reason || '—'}</p>
                        <p className="text-[10px] text-slate-400">
                          {format(new Date(c.created_at), 'dd MMM yyyy')}
                          {c.expires_at && ` · expires ${format(new Date(c.expires_at), 'dd MMM yyyy')}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-slate-700 font-semibold whitespace-nowrap">
                          {c.used_sessions}/{c.comp_sessions}
                        </span>
                        <CompAmendActions comp={c} />
                      </div>

                    </div>
                  ))}
                </div>
              </div>
            )}

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