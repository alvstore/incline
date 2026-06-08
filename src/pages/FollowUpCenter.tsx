import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  CreditCard, UserPlus, Clock, AlertTriangle, CheckSquare,
  PhoneCall, MessageSquare, Users, Calendar, RefreshCw
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { Link } from 'react-router-dom';
import { communicationService } from '@/services/communicationService';

export default function FollowUpCenter() {
  const { user } = useAuth();

  // Get staff's assigned branch — uses same query key & shape as StaffDashboard
  const { data: staffBranch } = useQuery({
    queryKey: ['staff-branch', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data: employee } = await supabase
        .from('employees')
        .select('branch_id, branch:branches(id, name)')
        .eq('user_id', user!.id)
        .eq('is_active', true)
        .maybeSingle();
      if (employee?.branch_id) return employee.branch;
      const { data: branches } = await supabase.from('branches').select('id, name').eq('is_active', true).limit(1);
      return branches?.[0] || null;
    },
  });

  const branchId = (staffBranch as any)?.id as string | undefined;

  // ---- PENDING PAYMENTS / OVERDUE INVOICES ----
  const { data: pendingPayments = [] } = useQuery({
    queryKey: ['followup-payments', branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select('id, invoice_number, total_amount, amount_paid, due_date, status, member:members(member_code, user_id, profiles:user_id(full_name, phone))')
        .eq('branch_id', branchId!)
        .in('status', ['pending', 'overdue', 'partial'])
        .order('due_date', { ascending: true })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
  });

  // ---- MEMBERSHIP RENEWALS (expiring within 7 days) ----
  const { data: renewals = [] } = useQuery({
    queryKey: ['followup-renewals', branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const next7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('memberships')
        .select('id, end_date, plan:membership_plans(name), member:members(member_code, user_id, profiles:user_id(full_name, phone))')
        .eq('branch_id', branchId!)
        .eq('status', 'active')
        .lte('end_date', next7Days)
        .gte('end_date', today)
        .order('end_date', { ascending: true })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
  });

  // ---- LEADS FOLLOW-UP ----
  const { data: leadFollowups = [] } = useQuery({
    queryKey: ['followup-leads', branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('id, full_name, phone, email, source, status, notes, created_at, lead_followups(next_followup_date)')
        .eq('branch_id', branchId!)
        .in('status', ['new', 'contacted', 'qualified'])
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []).map((lead: any) => {
        const latestFollowup = lead.lead_followups
          ?.filter((f: any) => f.next_followup_date)
          ?.sort((a: any, b: any) => b.next_followup_date.localeCompare(a.next_followup_date))?.[0];
        return { ...lead, follow_up_date: latestFollowup?.next_followup_date || null };
      });
    },
  });

  // ---- PENDING TASKS ----
  const { data: pendingTasks = [] } = useQuery({
    queryKey: ['followup-tasks', user?.id, branchId],
    enabled: !!user && !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('branch_id', branchId!)
        .in('status', ['pending', 'in_progress'])
        .order('due_date', { ascending: true })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
  });

  // ---- INACTIVE MEMBERS (21+ days — post-automation escalation) ----
  const { data: inactiveMembers = [] } = useQuery({
    queryKey: ['followup-inactive', branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_inactive_members', {
        p_branch_id: branchId!,
        p_days: 21,
        p_limit: 50,
      });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch nudge counts for inactive members
  const { data: inactiveNudgeCounts = {} } = useQuery({
    queryKey: ['followup-nudge-counts', branchId],
    enabled: !!branchId && inactiveMembers.length > 0,
    queryFn: async () => {
      const memberIds = inactiveMembers.map((m: any) => m.member_id);
      const { data, error } = await supabase
        .from('retention_nudge_logs')
        .select('member_id, stage_level')
        .in('member_id', memberIds)
        .gt('stage_level', 0);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const log of data || []) {
        counts[log.member_id] = Math.max(counts[log.member_id] || 0, log.stage_level);
      }
      return counts;
    },
  });

  const today = new Date().toISOString().split('T')[0];

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Follow-Up Center</h1>
            <p className="text-muted-foreground">Track payments, renewals, leads, tasks & inactive members</p>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 grid-cols-2 md:grid-cols-5">
          <Card className="rounded-2xl border-destructive/20">
            <CardContent className="pt-4 pb-3 text-center">
              <CreditCard className="h-6 w-6 mx-auto text-destructive mb-1" />
              <p className="text-2xl font-bold">{pendingPayments.length}</p>
              <p className="text-xs text-muted-foreground">Pending Payments</p>
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-warning/20">
            <CardContent className="pt-4 pb-3 text-center">
              <RefreshCw className="h-6 w-6 mx-auto text-warning mb-1" />
              <p className="text-2xl font-bold">{renewals.length}</p>
              <p className="text-xs text-muted-foreground">Renewals Due</p>
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-primary/20">
            <CardContent className="pt-4 pb-3 text-center">
              <UserPlus className="h-6 w-6 mx-auto text-primary mb-1" />
              <p className="text-2xl font-bold">{leadFollowups.length}</p>
              <p className="text-xs text-muted-foreground">Leads to Follow</p>
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-accent/20">
            <CardContent className="pt-4 pb-3 text-center">
              <CheckSquare className="h-6 w-6 mx-auto text-accent mb-1" />
              <p className="text-2xl font-bold">{pendingTasks.length}</p>
              <p className="text-xs text-muted-foreground">Open Tasks</p>
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-warning/20">
            <CardContent className="pt-4 pb-3 text-center">
              <Users className="h-6 w-6 mx-auto text-warning mb-1" />
              <p className="text-2xl font-bold">{inactiveMembers.length}</p>
              <p className="text-xs text-muted-foreground">Inactive Members</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="payments" className="space-y-4">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="payments">Payments</TabsTrigger>
            <TabsTrigger value="renewals">Renewals</TabsTrigger>
            <TabsTrigger value="leads">Leads</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="inactive">Inactive</TabsTrigger>
          </TabsList>

          {/* PAYMENTS TAB */}
          <TabsContent value="payments">
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5 text-destructive" />Pending & Overdue Payments</CardTitle>
              </CardHeader>
              <CardContent>
                {pendingPayments.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No pending payments 🎉</p>
                ) : (
                  <div className="space-y-3">
                    {pendingPayments.map((inv: any) => {
                      const due = inv.amount_paid ? inv.total_amount - inv.amount_paid : inv.total_amount;
                      const isOverdue = inv.due_date && inv.due_date < today;
                      return (
                        <div key={inv.id} className="flex items-center justify-between p-4 bg-muted/50 rounded-xl border">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium">{inv.member?.profiles?.full_name || inv.invoice_number}</p>
                            <p className="text-sm text-muted-foreground">{inv.invoice_number} • ₹{due.toLocaleString()} due</p>
                            {inv.due_date && (
                              <p className={`text-xs mt-0.5 ${isOverdue ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                                {isOverdue ? 'OVERDUE' : 'Due'}: {format(new Date(inv.due_date), 'dd MMM yyyy')}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={isOverdue ? 'destructive' : inv.status === 'partial' ? 'secondary' : 'outline'}>
                              {inv.status}
                            </Badge>
                            {inv.member?.profiles?.phone && (
                              <Button size="icon" variant="ghost" className="h-8 w-8"
                                onClick={() => communicationService.sendWhatsApp(inv.member.profiles.phone, `Hi ${inv.member.profiles.full_name}, this is a reminder for your pending payment of ₹${due}. Invoice: ${inv.invoice_number}. Please visit the gym to settle.`)}>
                                <MessageSquare className="h-4 w-4 text-success" />
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* RENEWALS TAB */}
          <TabsContent value="renewals">
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><RefreshCw className="h-5 w-5 text-warning" />Membership Renewals (Next 7 Days)</CardTitle>
              </CardHeader>
              <CardContent>
                {renewals.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No renewals due this week</p>
                ) : (
                  <div className="space-y-3">
                    {renewals.map((ms: any) => {
                      const daysLeft = Math.ceil((new Date(ms.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                      return (
                        <div key={ms.id} className="flex items-center justify-between p-4 bg-muted/50 rounded-xl border">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium">{ms.member?.profiles?.full_name || ms.member?.member_code}</p>
                            <p className="text-sm text-muted-foreground">{ms.plan?.name || 'Plan'} • Expires {format(new Date(ms.end_date), 'dd MMM')}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={daysLeft <= 1 ? 'destructive' : daysLeft <= 3 ? 'secondary' : 'outline'}>
                              {daysLeft <= 0 ? 'Today' : `${daysLeft}d left`}
                            </Badge>
                            {ms.member?.profiles?.phone && (
                              <Button size="icon" variant="ghost" className="h-8 w-8"
                                onClick={() => communicationService.sendWhatsApp(ms.member.profiles.phone, `Hi ${ms.member.profiles.full_name}, your membership (${ms.plan?.name || 'plan'}) expires on ${format(new Date(ms.end_date), 'dd MMM yyyy')}. Please visit us to renew!`)}>
                                <MessageSquare className="h-4 w-4 text-success" />
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* LEADS TAB */}
          <TabsContent value="leads">
            <Card className="rounded-2xl">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-primary" />Lead Follow-Ups</CardTitle>
                <Button variant="outline" size="sm" asChild><Link to="/leads">Manage Leads</Link></Button>
              </CardHeader>
              <CardContent>
                {leadFollowups.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No leads pending follow-up</p>
                ) : (
                  <div className="space-y-3">
                    {leadFollowups.map((lead: any) => {
                      const isOverdue = lead.follow_up_date && lead.follow_up_date < today;
                      return (
                        <div key={lead.id} className="flex items-center justify-between p-4 bg-muted/50 rounded-xl border">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium">{lead.full_name}</p>
                            <p className="text-sm text-muted-foreground">{lead.phone || lead.email || 'No contact'} • Source: {lead.source || 'Direct'}</p>
                            {lead.follow_up_date && (
                              <p className={`text-xs mt-0.5 ${isOverdue ? 'text-destructive font-medium' : 'text-warning'}`}>
                                Follow-up: {format(new Date(lead.follow_up_date), 'dd MMM yyyy')} {isOverdue ? '(OVERDUE)' : ''}
                              </p>
                            )}
                            {lead.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">Notes: {lead.notes}</p>}
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={lead.status === 'new' ? 'default' : 'secondary'}>{lead.status}</Badge>
                            {lead.phone && (
                              <>
                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => window.open(`tel:${lead.phone}`)}>
                                  <PhoneCall className="h-4 w-4 text-info" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-8 w-8"
                                  onClick={() => communicationService.sendWhatsApp(lead.phone, `Hi ${lead.full_name}, we'd love to welcome you to our gym! Would you like to schedule a tour?`)}>
                                  <MessageSquare className="h-4 w-4 text-success" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* TASKS TAB */}
          <TabsContent value="tasks">
            <Card className="rounded-2xl">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2"><CheckSquare className="h-5 w-5 text-accent" />Pending Tasks</CardTitle>
                <Button variant="outline" size="sm" asChild><Link to="/tasks">Manage Tasks</Link></Button>
              </CardHeader>
              <CardContent>
                {pendingTasks.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No pending tasks</p>
                ) : (
                  <div className="space-y-3">
                    {pendingTasks.map((task: any) => {
                      const isOverdue = task.due_date && task.due_date < today;
                      return (
                        <div key={task.id} className="flex items-center justify-between p-4 bg-muted/50 rounded-xl border">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium">{task.title}</p>
                            {task.description && <p className="text-sm text-muted-foreground truncate">{task.description}</p>}
                            {task.due_date && (
                              <p className={`text-xs mt-0.5 ${isOverdue ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                                Due: {format(new Date(task.due_date), 'dd MMM yyyy')} {isOverdue ? '(OVERDUE)' : ''}
                              </p>
                            )}
                          </div>
                          <Badge variant={task.status === 'in_progress' ? 'default' : isOverdue ? 'destructive' : 'secondary'}>
                            {task.status}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* INACTIVE TAB — Day 21+ Escalation */}
          <TabsContent value="inactive">
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5 text-warning" />Requires Follow-Up (21+ Days Absent)</CardTitle>
              </CardHeader>
              <CardContent>
                {inactiveMembers.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No members past the automated sequence! 🎉</p>
                ) : (
                  <div className="space-y-3">
                    {inactiveMembers.map((member: any) => {
                      const nudgeMax = (inactiveNudgeCounts as any)[member.member_id] || 0;
                      return (
                        <div key={member.member_id} className="flex items-center justify-between p-4 bg-destructive/5 rounded-xl border border-destructive/10">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium">{member.full_name}</p>
                            <p className="text-sm text-muted-foreground">{member.phone || 'No phone'} • {member.member_code}</p>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <span className="text-xs text-destructive font-medium">
                                {member.last_visit ? `Last visit: ${format(new Date(member.last_visit), 'dd MMM')} (${member.days_absent}d ago)` : 'Never visited'}
                              </span>
                              <Badge variant="secondary" className="text-xs">
                                Nudges: {Math.min(nudgeMax, 3)}/3
                              </Badge>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="destructive">{member.days_absent || '∞'}d</Badge>
                            {member.phone && (
                              <>
                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => window.open(`tel:${member.phone}`)}>
                                  <PhoneCall className="h-4 w-4 text-info" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-8 w-8"
                                  onClick={() => communicationService.sendWhatsApp(member.phone, `Hi ${member.full_name}, we miss you at the gym! Come visit us today.`)}>
                                  <MessageSquare className="h-4 w-4 text-success" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
