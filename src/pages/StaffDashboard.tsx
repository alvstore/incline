import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { 
  UserCheck, ShoppingCart, FileText, UserPlus, Clock, AlertTriangle,
  CheckCircle, Users, Calendar, TrendingUp, PhoneCall, MessageSquare, UserX, Eye, ArrowRightLeft, IndianRupee
} from 'lucide-react';
import { format, startOfDay, endOfDay } from 'date-fns';
import { Link } from 'react-router-dom';
import { communicationService } from '@/services/communicationService';
import { SmartAssistDrawer } from '@/components/retention/SmartAssistDrawer';
import { ConvertMemberDrawer } from '@/components/leads/ConvertMemberDrawer';
import { MyShiftWeekCard } from '@/components/staff/MyShiftWeekCard';

export default function StaffDashboard() {
  const { profile, user } = useAuth();
  const today = new Date();
  const todayStart = startOfDay(today).toISOString();
  const todayEnd = endOfDay(today).toISOString();
  const [smartAssistMember, setSmartAssistMember] = useState<any>(null);
  const [convertLead, setConvertLead] = useState<any>(null);
  const [pricingOpen, setPricingOpen] = useState(false);

  // Get staff's assigned branch
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

  const branchId = staffBranch?.id;

  // Fetch today's stats
  const { data: stats } = useQuery({
    queryKey: ['staff-dashboard-stats', branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { count: todayCheckins } = await supabase.from('member_attendance').select('id', { count: 'exact' }).eq('branch_id', branchId!).gte('check_in', todayStart).lte('check_in', todayEnd);
      const { count: currentlyIn } = await supabase.from('member_attendance').select('id', { count: 'exact' }).eq('branch_id', branchId!).gte('check_in', todayStart).is('check_out', null);
      const { count: pendingInvoices } = await supabase.from('invoices').select('id', { count: 'exact' }).eq('branch_id', branchId!).in('status', ['pending', 'partial', 'overdue']);
      const { count: pendingLeads } = await supabase.from('leads').select('id', { count: 'exact' }).eq('branch_id', branchId!).in('status', ['new', 'contacted']);
      const { count: expiringToday } = await supabase.from('memberships').select('id', { count: 'exact' }).eq('branch_id', branchId!).eq('status', 'active').eq('end_date', today.toISOString().split('T')[0]);
      const next7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const { count: expiringWeek } = await supabase.from('memberships').select('id', { count: 'exact' }).eq('branch_id', branchId!).eq('status', 'active').lte('end_date', next7Days).gte('end_date', today.toISOString().split('T')[0]);
      return { todayCheckins: todayCheckins || 0, currentlyIn: currentlyIn || 0, pendingInvoices: pendingInvoices || 0, pendingLeads: pendingLeads || 0, expiringToday: expiringToday || 0, expiringWeek: expiringWeek || 0 };
    },
  });

  // Inactive members (no visit in 5+ days to capture full sequence)
  const { data: inactiveMembers = [] } = useQuery({
    queryKey: ['inactive-members', branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_inactive_members', {
        p_branch_id: branchId!,
        p_days: 5,
        p_limit: 50,
      });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch nudge counts per member
  const { data: nudgeCounts = {} } = useQuery({
    queryKey: ['nudge-counts', branchId],
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

  const inSequenceMembers = inactiveMembers.filter((m: any) => (m.days_absent || 0) < 21);
  const escalationMembers = inactiveMembers.filter((m: any) => (m.days_absent || 0) >= 21);

  // Fetch pending tasks assigned to staff
  const { data: pendingTasks = [] } = useQuery({
    queryKey: ['staff-tasks', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from('tasks').select('*').eq('assigned_to', user!.id).in('status', ['pending', 'in_progress']).order('due_date', { ascending: true }).limit(5);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch leads requiring follow-up
  const { data: followUpLeads = [] } = useQuery({
    queryKey: ['staff-followup-leads', branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase.from('leads').select('id, full_name, phone, source, status, notes, created_at').eq('branch_id', branchId!).in('status', ['new', 'contacted']).order('created_at', { ascending: false }).limit(5);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch recent check-ins
  const { data: recentCheckins = [] } = useQuery({
    queryKey: ['recent-checkins', branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase.from('member_attendance').select(`id, check_in, member:members(member_code, user_id, profiles:user_id(full_name, avatar_url))`).eq('branch_id', branchId!).gte('check_in', todayStart).order('check_in', { ascending: false }).limit(5);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch expiring memberships
  const { data: expiringMemberships = [] } = useQuery({
    queryKey: ['expiring-memberships', branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const next3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const { data, error } = await supabase.from('memberships').select(`id, end_date, member:members(member_code, user_id, profiles:user_id(full_name, phone, avatar_url))`).eq('branch_id', branchId!).eq('status', 'active').lte('end_date', next3Days).gte('end_date', today.toISOString().split('T')[0]).order('end_date', { ascending: true }).limit(5);
      if (error) throw error;
      return data || [];
    },
  });

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Welcome Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Hello, {profile?.full_name?.split(' ')[0] || 'Staff'}!</h1>
            <p className="text-muted-foreground">{staffBranch?.name || 'Your Branch'} • {format(today, 'EEEE, dd MMM yyyy')}</p>
          </div>
          <Badge variant="default" className="w-fit">Staff</Badge>
        </div>

        {/* Quick Actions */}
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
          <Link to="/attendance"><Card className="hover:border-accent/50 transition-colors cursor-pointer h-full rounded-2xl"><CardContent className="flex flex-col items-center justify-center py-6 gap-2"><UserCheck className="h-8 w-8 text-emerald-500" /><span className="font-medium text-center">Check In Member</span></CardContent></Card></Link>
          <Link to="/pos"><Card className="hover:border-accent/50 transition-colors cursor-pointer h-full rounded-2xl"><CardContent className="flex flex-col items-center justify-center py-6 gap-2"><ShoppingCart className="h-8 w-8 text-accent" /><span className="font-medium text-center">Open POS</span></CardContent></Card></Link>
          <Link to="/leads"><Card className="hover:border-accent/50 transition-colors cursor-pointer h-full rounded-2xl"><CardContent className="flex flex-col items-center justify-center py-6 gap-2"><UserPlus className="h-8 w-8 text-amber-500" /><span className="font-medium text-center">Add Lead</span></CardContent></Card></Link>
          <Link to="/invoices"><Card className="hover:border-accent/50 transition-colors cursor-pointer h-full rounded-2xl"><CardContent className="flex flex-col items-center justify-center py-6 gap-2"><FileText className="h-8 w-8 text-primary" /><span className="font-medium text-center">View Invoices</span></CardContent></Card></Link>
          <Card className="hover:border-accent/50 transition-colors cursor-pointer h-full rounded-2xl" onClick={() => setPricingOpen(true)}><CardContent className="flex flex-col items-center justify-center py-6 gap-2"><TrendingUp className="h-8 w-8 text-violet-500" /><span className="font-medium text-center">View Pricing</span></CardContent></Card>
        </div>

        {/* Stats Row */}
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
          <Link to="/attendance"><StatCard title="Today's Check-ins" value={stats?.todayCheckins || 0} icon={UserCheck} description={`${stats?.currentlyIn || 0} currently in`} variant="success" /></Link>
          <Link to="/invoices"><StatCard title="Unpaid Invoices" value={stats?.pendingInvoices || 0} icon={FileText} variant="warning" /></Link>
          <Link to="/leads"><StatCard title="Active Leads" value={stats?.pendingLeads || 0} icon={UserPlus} variant="accent" /></Link>
          <Link to="/members"><StatCard title="Expiring This Week" value={stats?.expiringWeek || 0} icon={AlertTriangle} description={`${stats?.expiringToday || 0} today`} variant="destructive" /></Link>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Inactive Members — Retention Outreach */}
          <Card className="border-destructive/20 rounded-2xl shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <UserX className="h-5 w-5 text-destructive" />
                At-Risk Members
              </CardTitle>
              <Badge variant="destructive" className="rounded-full">{inactiveMembers.length}</Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Day 21+ Escalation — Requires Follow-Up */}
              {escalationMembers.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="destructive" className="text-xs">🔥 Requires Follow-Up</Badge>
                    <span className="text-xs text-muted-foreground">({escalationMembers.length})</span>
                  </div>
                  <div className="space-y-3">
                    {escalationMembers.map((member: any) => {
                      const nudgeMax = (nudgeCounts as any)[member.member_id] || 0;
                      return (
                        <div key={member.member_id} className="flex items-center justify-between p-3 bg-destructive/10 rounded-xl border border-destructive/20">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{member.full_name}</p>
                            <p className="text-sm text-muted-foreground">{member.phone || 'No phone'}</p>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <span className="text-xs text-destructive font-medium">
                                {member.last_visit ? `Last: ${format(new Date(member.last_visit), 'dd MMM')} (${member.days_absent}d)` : 'Never visited'}
                              </span>
                              <Badge variant="secondary" className="text-xs">
                                Nudges: {Math.min(nudgeMax, 3)}/3
                              </Badge>
                            </div>
                          </div>
                          <div className="flex gap-1 ml-2">
                            {member.phone && (
                              <>
                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => window.open(`tel:${member.phone}`)}>
                                  <PhoneCall className="h-4 w-4 text-sky-500" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => communicationService.sendWhatsApp(member.phone, `Hi ${member.full_name}, we miss you at the gym! Come visit us today.`)}>
                                  <MessageSquare className="h-4 w-4 text-emerald-500" />
                                </Button>
                              </>
                            )}
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setSmartAssistMember(member)}>
                              <Eye className="h-4 w-4 text-primary" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* In Sequence (5-20 days) */}
              {inSequenceMembers.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="secondary" className="text-xs">In Sequence</Badge>
                    <span className="text-xs text-muted-foreground">({inSequenceMembers.length})</span>
                  </div>
                  <div className="space-y-2">
                    {inSequenceMembers.slice(0, 5).map((member: any) => {
                      const nudgeMax = (nudgeCounts as any)[member.member_id] || 0;
                      return (
                        <div key={member.member_id} className="flex items-center justify-between p-2.5 bg-muted/50 rounded-xl border">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{member.full_name}</p>
                            <p className="text-xs text-muted-foreground">
                              {member.days_absent}d absent
                              {nudgeMax > 0 && <span className="ml-1.5">• {nudgeMax}/3 nudges</span>}
                            </p>
                          </div>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setSmartAssistMember(member)}>
                            <Eye className="h-3.5 w-3.5 text-primary" />
                          </Button>
                        </div>
                      );
                    })}
                    {inSequenceMembers.length > 5 && (
                      <p className="text-xs text-center text-muted-foreground pt-1">+{inSequenceMembers.length - 5} more in sequence</p>
                    )}
                  </div>
                </div>
              )}

              {inactiveMembers.length === 0 && (
                <p className="text-muted-foreground text-center py-8">All members are active! 🎉</p>
              )}
            </CardContent>
          </Card>

          {/* Recent Check-ins */}
          <Card className="border-border/50 rounded-2xl">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2"><Clock className="h-5 w-5" />Recent Check-ins</CardTitle>
              <Button variant="ghost" size="sm" asChild><Link to="/attendance">View All</Link></Button>
            </CardHeader>
            <CardContent>
              {recentCheckins.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No check-ins today</p>
              ) : (
                <div className="space-y-3">
                  {recentCheckins.map((checkin: any) => (
                    <div key={checkin.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-xl">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={checkin.member?.profiles?.avatar_url} />
                          <AvatarFallback className="text-xs">{checkin.member?.profiles?.full_name?.charAt(0) || '?'}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">{checkin.member?.profiles?.full_name || checkin.member?.member_code}</p>
                          <p className="text-sm text-muted-foreground">{checkin.member?.member_code}</p>
                        </div>
                      </div>
                      <span className="text-sm text-muted-foreground">{format(new Date(checkin.check_in), 'HH:mm')}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Expiring Memberships */}
          <Card className="border-border/50 rounded-2xl">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-500" />Expiring Soon</CardTitle>
              <Button variant="ghost" size="sm" asChild><Link to="/members">View All</Link></Button>
            </CardHeader>
            <CardContent>
              {expiringMemberships.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No memberships expiring soon</p>
              ) : (
                <div className="space-y-3">
                  {expiringMemberships.map((membership: any) => {
                    const daysLeft = Math.ceil((new Date(membership.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                    return (
                      <div key={membership.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-xl">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={membership.member?.profiles?.avatar_url} />
                            <AvatarFallback className="text-xs">{membership.member?.profiles?.full_name?.charAt(0) || '?'}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">{membership.member?.profiles?.full_name || membership.member?.member_code}</p>
                            <p className="text-sm text-muted-foreground">{membership.member?.profiles?.phone || 'No phone'}</p>
                          </div>
                        </div>
                        <Badge variant={daysLeft <= 1 ? 'destructive' : 'secondary'}>{daysLeft <= 0 ? 'Today' : `${daysLeft}d`}</Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Follow-Up Leads */}
          <Card className="border-border/50 rounded-2xl">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2"><UserPlus className="h-5 w-5 text-accent" />Follow-Up Leads</CardTitle>
              <Button variant="ghost" size="sm" asChild><Link to="/leads">View All</Link></Button>
            </CardHeader>
            <CardContent>
              {followUpLeads.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No leads pending follow-up</p>
              ) : (
                <div className="space-y-3">
                  {followUpLeads.map((lead: any) => (
                    <div key={lead.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-xl">
                      <div className="flex-1 min-w-0"><p className="font-medium">{lead.full_name}</p><p className="text-sm text-muted-foreground">{lead.phone || 'No phone'} • {lead.source || 'Unknown'}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Added: {format(new Date(lead.created_at), 'dd MMM')}</p>
                      </div>
                      <div className="flex items-center gap-1.5 ml-2">
                        <Badge variant={lead.status === 'new' ? 'default' : 'secondary'}>{lead.status}</Badge>
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setConvertLead(lead)}>
                          <ArrowRightLeft className="h-3 w-3" /> Convert
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* My Tasks */}
          <Card className="border-border/50 rounded-2xl md:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2"><Calendar className="h-5 w-5" />My Pending Tasks</CardTitle>
              <Button variant="ghost" size="sm" asChild><Link to="/tasks">View All</Link></Button>
            </CardHeader>
            <CardContent>
              {pendingTasks.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No pending tasks</p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {pendingTasks.map((task: any) => (
                    <div key={task.id} className="flex items-center justify-between p-4 bg-muted/50 rounded-xl">
                      <div><p className="font-medium">{task.title}</p>{task.due_date && <p className="text-sm text-muted-foreground">Due: {format(new Date(task.due_date), 'dd MMM yyyy')}</p>}</div>
                      <Badge variant={task.status === 'in_progress' ? 'default' : 'secondary'}>{task.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <SmartAssistDrawer
        open={!!smartAssistMember}
        onOpenChange={(open) => !open && setSmartAssistMember(null)}
        member={smartAssistMember}
        branchId={branchId}
      />

      {convertLead && (
        <ConvertMemberDrawer
          open={!!convertLead}
          onOpenChange={(open) => !open && setConvertLead(null)}
          lead={convertLead}
        />
      )}

      {/* View Pricing Drawer */}
      <PricingDrawer open={pricingOpen} onOpenChange={setPricingOpen} branchId={branchId} />
    </AppLayout>
  );
}

function PricingDrawer({ open, onOpenChange, branchId }: { open: boolean; onOpenChange: (open: boolean) => void; branchId?: string }) {
  const { data: plans = [] } = useQuery({
    queryKey: ['membership-plans-pricing', branchId],
    queryFn: async () => {
      let query = supabase
        .from('membership_plans')
        .select('id, name, duration_days, price, is_active, plan_benefits(id, benefit_type, frequency, limit_count, benefit_types(name, code))')
        .eq('is_active', true)
        .order('price', { ascending: true });
      if (branchId) query = query.eq('branch_id', branchId);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: open,
  });

  const formatFrequency = (f: string | null) => {
    if (!f) return '';
    return f === 'per_membership' ? 'total' : f === 'unlimited' ? '∞' : `/${f}`;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <IndianRupee className="h-5 w-5 text-primary" />
            Membership Pricing
          </SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {plans.length === 0 && (
            <p className="text-center text-muted-foreground py-8">No plans configured</p>
          )}
          {plans.map((plan: any) => (
            <Card key={plan.id} className="rounded-xl border shadow-sm">
              <CardContent className="pt-4 pb-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-base">{plan.name}</p>
                    <p className="text-xs text-muted-foreground">{plan.duration_days} days</p>
                  </div>
                  <Badge className="bg-primary/10 text-primary border-primary/20 text-sm font-bold">
                    ₹{plan.price?.toLocaleString('en-IN')}
                  </Badge>
                </div>
                {plan.plan_benefits && plan.plan_benefits.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Included Benefits</p>
                    <ul className="space-y-1">
                      {plan.plan_benefits.map((pb: any) => (
                        <li key={pb.id} className="flex items-center gap-2 text-sm">
                          <CheckCircle className="h-3.5 w-3.5 text-success flex-shrink-0" />
                          <span>{pb.benefit_types?.name || pb.benefit_type}</span>
                          {pb.limit_count && (
                            <span className="text-xs text-muted-foreground">
                              {pb.limit_count} {formatFrequency(pb.frequency)}
                            </span>
                          )}
                          {pb.frequency === 'unlimited' && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Unlimited</Badge>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
