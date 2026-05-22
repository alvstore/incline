import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  Activity, ToggleLeft, FlaskConical, ChevronDown, ChevronRight,
  Phone, Clock, RefreshCw, Play, Loader2, ExternalLink, AlertTriangle,
  Bot, Brain, MessageSquare, Search, Power, PowerOff,
  IdCard, Gift, CalendarDays, CalendarPlus, CalendarX, Dumbbell, UserCog,
  CreditCard, Receipt, Wallet, Link2, FileText, Snowflake, RotateCcw,
  Users, Star, ShoppingBag, Bell, MapPin, ClipboardList,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AIBrainTab } from '@/components/settings/AIBrainTab';
import { HandlesTab } from '@/components/settings/ai/HandlesTab';
import { PlumbingTab } from '@/components/settings/ai/PlumbingTab';

type ToolDef = {
  name: string;
  label: string;
  description: string;
  icon: React.ElementType;
  risk: 'read' | 'write' | 'payment' | 'escalation';
};

type ToolCategory = {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  accent: string; // tailwind classes for icon badge
  tools: ToolDef[];
};

// Grouped tool registry — covers self-service, bookings, payments, lifecycle, engagement
const TOOL_CATEGORIES: ToolCategory[] = [
  {
    id: 'membership',
    label: 'Membership & Account',
    description: 'Status, plans, dues and member identity',
    icon: IdCard,
    accent: 'bg-violet-50 text-violet-600 ring-violet-100',
    tools: [
      { name: 'get_membership_status', label: 'Membership Status', description: 'Check plan, expiry date, days remaining and pending dues', icon: IdCard, risk: 'read' },
      { name: 'get_member_profile', label: 'Member Profile', description: 'Fetch member details, contact, branch and join date', icon: UserCog, risk: 'read' },
      { name: 'update_member_contact', label: 'Update Contact', description: 'Update member email or phone (verified)', icon: UserCog, risk: 'write' },
      { name: 'request_freeze', label: 'Freeze Membership', description: 'Submit a freeze request for approval', icon: Snowflake, risk: 'write' },
      { name: 'request_resume', label: 'Resume Membership', description: 'Resume from freeze before scheduled end date', icon: RotateCcw, risk: 'write' },
    ],
  },
  {
    id: 'benefits',
    label: 'Benefits & Bookings',
    description: 'Sauna, ice bath, classes and facility slots',
    icon: Gift,
    accent: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
    tools: [
      { name: 'get_benefit_balance', label: 'Benefit Balance', description: 'Remaining credits for sauna, ice bath, classes', icon: Gift, risk: 'read' },
      { name: 'get_available_slots', label: 'Available Slots', description: 'List bookable facility slots by date', icon: CalendarDays, risk: 'read' },
      { name: 'book_facility_slot', label: 'Book Slot', description: 'Book a facility slot for the member', icon: CalendarPlus, risk: 'write' },
      { name: 'cancel_facility_booking', label: 'Cancel Booking', description: 'Cancel an existing facility booking', icon: CalendarX, risk: 'write' },
      { name: 'list_my_bookings', label: 'My Bookings', description: 'Upcoming bookings for the member', icon: ClipboardList, risk: 'read' },
    ],
  },
  {
    id: 'training',
    label: 'Personal Training',
    description: 'PT sessions, trainers and bookings',
    icon: Dumbbell,
    accent: 'bg-orange-50 text-orange-600 ring-orange-100',
    tools: [
      { name: 'get_pt_balance', label: 'PT Balance', description: 'Personal training session balance and expiry', icon: Dumbbell, risk: 'read' },
      { name: 'list_trainers', label: 'List Trainers', description: 'Available trainers at the member’s branch', icon: Users, risk: 'read' },
      { name: 'book_pt_session', label: 'Book PT Session', description: 'Book a PT session with a specific trainer', icon: CalendarPlus, risk: 'write' },
      { name: 'cancel_pt_session', label: 'Cancel PT Session', description: 'Cancel an upcoming PT session', icon: CalendarX, risk: 'write' },
    ],
  },
  {
    id: 'payments',
    label: 'Payments & Billing',
    description: 'Invoices, dues, payment links and wallet',
    icon: CreditCard,
    accent: 'bg-sky-50 text-sky-600 ring-sky-100',
    tools: [
      { name: 'get_outstanding_dues', label: 'Outstanding Dues', description: 'Total pending invoice amount for the member', icon: Receipt, risk: 'read' },
      { name: 'list_invoices', label: 'List Invoices', description: 'Recent invoices with status (paid / due / overdue)', icon: FileText, risk: 'read' },
      { name: 'send_invoice_pdf', label: 'Send Invoice PDF', description: 'Email/WhatsApp the invoice PDF to the member', icon: FileText, risk: 'write' },
      { name: 'create_payment_link', label: 'Create Payment Link', description: 'Generate a Razorpay payment link for an invoice', icon: Link2, risk: 'payment' },
      { name: 'get_wallet_balance', label: 'Wallet Balance', description: 'Member wallet balance and recent transactions', icon: Wallet, risk: 'read' },
      { name: 'pay_with_wallet', label: 'Pay With Wallet', description: 'Apply wallet credit toward an open invoice', icon: Wallet, risk: 'payment' },
    ],
  },
  {
    id: 'engagement',
    label: 'Engagement & Loyalty',
    description: 'Rewards, referrals, store and announcements',
    icon: Star,
    accent: 'bg-amber-50 text-amber-600 ring-amber-100',
    tools: [
      { name: 'get_rewards_balance', label: 'Rewards Balance', description: 'Loyalty points and tier status', icon: Star, risk: 'read' },
      { name: 'redeem_reward', label: 'Redeem Reward', description: 'Redeem points against a benefit or store credit', icon: Gift, risk: 'write' },
      { name: 'get_referral_link', label: 'Referral Link', description: 'Personalised referral link with tracking', icon: Link2, risk: 'read' },
      { name: 'list_announcements', label: 'Announcements', description: 'Active branch announcements and offers', icon: Bell, risk: 'read' },
      { name: 'list_store_products', label: 'Store Products', description: 'Browse merchandise and supplements', icon: ShoppingBag, risk: 'read' },
    ],
  },
  {
    id: 'branch',
    label: 'Branch Info',
    description: 'Hours, location and class schedules',
    icon: MapPin,
    accent: 'bg-slate-100 text-slate-600 ring-slate-200',
    tools: [
      { name: 'get_branch_info', label: 'Branch Info', description: 'Address, phone, opening hours and amenities', icon: MapPin, risk: 'read' },
      { name: 'get_class_schedule', label: 'Class Schedule', description: 'Group class timings by day or trainer', icon: CalendarDays, risk: 'read' },
    ],
  },
  {
    id: 'escalation',
    label: 'Escalation',
    description: 'Hand off to humans when needed',
    icon: MessageSquare,
    accent: 'bg-rose-50 text-rose-600 ring-rose-100',
    tools: [
      { name: 'transfer_to_human', label: 'Transfer to Human', description: 'Hand off conversation to gym staff', icon: MessageSquare, risk: 'escalation' },
    ],
  },
];

// Flat list for legacy lookups (test lab, etc.)
const AI_TOOLS = TOOL_CATEGORIES.flatMap((c) => c.tools.map((t) => ({ name: t.name, description: t.description })));

const RISK_BADGE: Record<ToolDef['risk'], { label: string; className: string }> = {
  read: { label: 'Read', className: 'bg-slate-100 text-slate-700 border-slate-200' },
  write: { label: 'Write', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  payment: { label: 'Payment', className: 'bg-sky-50 text-sky-700 border-sky-200' },
  escalation: { label: 'Escalation', className: 'bg-rose-50 text-rose-700 border-rose-200' },
};

export function AIAgentControlCenter() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="bg-gradient-to-br from-violet-500 to-indigo-600 text-white p-2.5 rounded-xl shadow-lg shadow-violet-500/20">
          <Bot className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">AI Agent Hub</h2>
          <p className="text-sm text-muted-foreground">
            Single source of truth — Overview, Knowledge, Handles and Plumbing.
          </p>
        </div>
      </div>

      <AIAgentTabs />
    </div>
  );
}

function AIAgentTabs() {
  const [tab, setTab] = useState<'overview' | 'knowledge' | 'handles' | 'plumbing'>('overview');
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="space-y-6">
      <TabsList className="grid grid-cols-4 w-full h-auto p-1">
        <TabsTrigger value="overview" className="text-xs sm:text-sm gap-1.5 py-2">
          <Activity className="h-3.5 w-3.5 hidden sm:block" />
          Overview
        </TabsTrigger>
        <TabsTrigger value="knowledge" className="text-xs sm:text-sm gap-1.5 py-2">
          <Brain className="h-3.5 w-3.5 hidden sm:block" />
          Knowledge
        </TabsTrigger>
        <TabsTrigger value="handles" className="text-xs sm:text-sm gap-1.5 py-2">
          <Bot className="h-3.5 w-3.5 hidden sm:block" />
          Handles
        </TabsTrigger>
        <TabsTrigger value="plumbing" className="text-xs sm:text-sm gap-1.5 py-2">
          <ToggleLeft className="h-3.5 w-3.5 hidden sm:block" />
          Plumbing
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <DashboardTab />
      </TabsContent>

      <TabsContent value="knowledge">
        <AIBrainTab />
      </TabsContent>

      <TabsContent value="handles">
        <HandlesTab onJumpToKnowledge={() => setTab('knowledge')} />
      </TabsContent>

      <TabsContent value="plumbing">
        <PlumbingTab toolsPanel={<ToolsTab />} />
      </TabsContent>
    </Tabs>
  );
}


function DashboardTab() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const { data: toolLogs, isLoading: logsLoading } = useQuery({
    queryKey: ['ai-tool-logs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_tool_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    refetchInterval: 10000,
  });

  const totalCalls = toolLogs?.length || 0;
  const errorCalls = toolLogs?.filter(l => l.status === 'error').length || 0;
  const successRate = totalCalls > 0 ? Math.round(((totalCalls - errorCalls) / totalCalls) * 100) : 100;
  const avgDuration = totalCalls > 0
    ? Math.round((toolLogs?.reduce((s, l) => s + (l.execution_time_ms || 0), 0) || 0) / totalCalls)
    : 0;

  return (
    <div className="space-y-6">
      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="rounded-xl shadow-lg shadow-slate-200/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-emerald-50 text-emerald-600 p-2.5 rounded-full"><Activity className="h-5 w-5" /></div>
            <div>
              <p className="text-2xl font-bold text-foreground">{totalCalls}</p>
              <p className="text-xs text-muted-foreground">Tool Calls (Last 50)</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-lg shadow-slate-200/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-indigo-50 text-indigo-600 p-2.5 rounded-full"><Activity className="h-5 w-5" /></div>
            <div>
              <p className="text-2xl font-bold text-foreground">{successRate}%</p>
              <p className="text-xs text-muted-foreground">Success Rate</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-lg shadow-slate-200/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-amber-50 text-amber-600 p-2.5 rounded-full"><Clock className="h-5 w-5" /></div>
            <div>
              <p className="text-2xl font-bold text-foreground">{avgDuration}ms</p>
              <p className="text-xs text-muted-foreground">Avg Duration</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Live Activity Feed */}
      <Card className="rounded-xl shadow-lg shadow-slate-200/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" />
                Live Activity Feed
              </CardTitle>
              <CardDescription>Real-time AI tool execution log (auto-refreshes every 10s)</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => queryClient.invalidateQueries({ queryKey: ['ai-tool-logs'] })}
              className="gap-1.5 rounded-lg"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {logsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
            </div>
          ) : !toolLogs || toolLogs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Activity className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No tool executions yet. Activity will appear here when the AI agent uses tools.</p>
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[40px]" />
                    <TableHead>Time</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Tool</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {toolLogs.map((log: any) => (
                    <Collapsible key={log.id} open={expandedRow === log.id} onOpenChange={(open) => setExpandedRow(open ? log.id : null)} asChild>
                      <>
                        <CollapsibleTrigger asChild>
                          <TableRow className="cursor-pointer">
                            <TableCell>
                              {expandedRow === log.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {format(new Date(log.created_at), 'MMM dd, HH:mm:ss')}
                            </TableCell>
                            <TableCell className="font-mono text-xs">{log.phone_number || '—'}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="font-mono text-xs">{log.tool_name}</Badge>
                            </TableCell>
                            <TableCell>
                              <Badge className={log.status === 'success'
                                ? 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30 hover:bg-emerald-500/20'
                                : 'bg-red-500/15 text-red-700 border-red-500/30 hover:bg-red-500/20'
                              }>
                                {log.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{log.execution_time_ms}ms</TableCell>
                            <TableCell>
                              {log.status === 'error' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="gap-1 text-xs h-7 text-amber-600 hover:text-amber-700"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(`/whatsapp-chat?phone=${encodeURIComponent(log.phone_number || '')}`);
                                  }}
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  Handle Manually
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        </CollapsibleTrigger>
                        <CollapsibleContent asChild>
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={7} className="p-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <p className="text-xs font-semibold text-muted-foreground mb-1">Arguments</p>
                                  <pre className="text-xs bg-background rounded-lg p-3 overflow-auto max-h-40 border">
                                    {JSON.stringify(log.arguments, null, 2)}
                                  </pre>
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-muted-foreground mb-1">Result</p>
                                  <pre className={`text-xs rounded-lg p-3 overflow-auto max-h-40 border ${log.status === 'error' ? 'bg-red-50 border-red-200' : 'bg-background'}`}>
                                    {JSON.stringify(log.result, null, 2)}
                                  </pre>
                                  {log.error_message && (
                                    <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                                      <AlertTriangle className="h-3 w-3" /> {log.error_message}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        </CollapsibleContent>
                      </>
                    </Collapsible>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ToolsTab() {
  const queryClient = useQueryClient();
  const [testTool, setTestTool] = useState('');
  const [testArgs, setTestArgs] = useState('{}');
  const [testResult, setTestResult] = useState<any>(null);
  const [testRunning, setTestRunning] = useState(false);
  const [search, setSearch] = useState('');

  // SSOT: tool allow-list lives on ai_purposes.tools_allowed for the
  // global whatsapp_reply handle. Empty array = all tools allowed (permissive).
  const { data: purposeRow, isLoading: configLoading } = useQuery({
    queryKey: ['ai-tools-allowed', 'whatsapp_reply', 'global'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_purposes')
        .select('id, tools_allowed')
        .eq('purpose', 'whatsapp_reply')
        .is('branch_id', null)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const allowedList: string[] = (purposeRow?.tools_allowed as string[]) ?? [];
  const allowedSet = new Set(allowedList);
  // Permissive default: if no allow-list has ever been set, treat as all-on.
  const isPermissive = allowedList.length === 0;
  const toolEnabled = (name: string) => isPermissive || allowedSet.has(name);
  // Back-compat shape for the rest of the component below.
  const toolConfig: Record<string, boolean> = {};

  async function persistAllowed(next: string[]) {
    if (!purposeRow?.id) throw new Error('whatsapp_reply handle not found');
    const { error } = await supabase
      .from('ai_purposes')
      .update({ tools_allowed: next })
      .eq('id', purposeRow.id);
    if (error) throw error;
  }

  const toggleTool = useMutation({
    mutationFn: async ({ toolName, enabled }: { toolName: string; enabled: boolean }) => {
      const base = isPermissive
        ? TOOL_CATEGORIES.flatMap((c) => c.tools.map((t) => t.name))
        : [...allowedList];
      const set = new Set(base);
      if (enabled) set.add(toolName);
      else set.delete(toolName);
      await persistAllowed(Array.from(set));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-tools-allowed'] });
      toast.success('Tool config updated');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to update tool config'),
  });

  const bulkToggle = useMutation({
    mutationFn: async ({ toolNames, enabled }: { toolNames: string[]; enabled: boolean }) => {
      const base = isPermissive
        ? TOOL_CATEGORIES.flatMap((c) => c.tools.map((t) => t.name))
        : [...allowedList];
      const set = new Set(base);
      toolNames.forEach((n) => (enabled ? set.add(n) : set.delete(n)));
      await persistAllowed(Array.from(set));
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['ai-tools-allowed'] });
      toast.success(vars.enabled ? 'Tools enabled' : 'Tools disabled');
    },
    onError: (e: any) => toast.error(e.message || 'Bulk update failed'),
  });

  const handleTestExecute = async () => {
    if (!testTool) { toast.error('Select a tool first'); return; }
    try { JSON.parse(testArgs); } catch { toast.error('Invalid JSON arguments'); return; }
    setTestRunning(true);
    setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('diagnostics', {
        body: { kind: 'ai_tool', tool_name: testTool, arguments: JSON.parse(testArgs) },
      });
      if (error) throw error;
      setTestResult(data);
    } catch (e: any) {
      setTestResult({ error: e.message || 'Execution failed' });
    } finally {
      setTestRunning(false);
    }
  };

  // Filter categories by search
  const filteredCategories = TOOL_CATEGORIES
    .map((cat) => ({
      ...cat,
      tools: cat.tools.filter((t) =>
        !search ||
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.label.toLowerCase().includes(search.toLowerCase()) ||
        t.description.toLowerCase().includes(search.toLowerCase())
      ),
    }))
    .filter((cat) => cat.tools.length > 0);

  // Stats across all tools
  const allTools = TOOL_CATEGORIES.flatMap((c) => c.tools);
  const enabledCount = allTools.filter((t) => toolEnabled(t.name)).length;
  const totalCount = allTools.length;

  return (
    <div className="space-y-6">
      {/* Hero summary */}
      <Card className="rounded-2xl shadow-lg shadow-slate-200/50 overflow-hidden border-0">
        <div className="bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 text-white p-5 md:p-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="bg-white/15 backdrop-blur p-3 rounded-2xl ring-1 ring-white/20">
                <ToggleLeft className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg md:text-xl font-bold">AI Tool Library</h3>
                <p className="text-sm text-white/80">
                  {enabledCount} of {totalCount} tools enabled across {TOOL_CATEGORIES.length} categories
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="rounded-lg bg-white/15 hover:bg-white/25 text-white border-0 backdrop-blur gap-1.5"
                onClick={() => bulkToggle.mutate({ toolNames: allTools.map((t) => t.name), enabled: true })}
                disabled={bulkToggle.isPending}
              >
                <Power className="h-3.5 w-3.5" /> Enable all
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="rounded-lg bg-white/15 hover:bg-white/25 text-white border-0 backdrop-blur gap-1.5"
                onClick={() => bulkToggle.mutate({ toolNames: allTools.map((t) => t.name), enabled: false })}
                disabled={bulkToggle.isPending}
              >
                <PowerOff className="h-3.5 w-3.5" /> Disable all
              </Button>
            </div>
          </div>
          {/* Progress bar */}
          <div className="mt-4 h-1.5 w-full bg-white/15 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-300 rounded-full transition-all"
              style={{ width: `${totalCount ? (enabledCount / totalCount) * 100 : 0}%` }}
            />
          </div>
        </div>
        {/* Search bar */}
        <CardContent className="p-4 bg-white">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tools by name or description..."
              className="w-full h-10 pl-9 pr-3 rounded-lg bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40"
            />
          </div>
        </CardContent>
      </Card>

      {/* Categories */}
      {configLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)}
        </div>
      ) : filteredCategories.length === 0 ? (
        <Card className="rounded-2xl shadow-lg shadow-slate-200/50">
          <CardContent className="py-12 text-center text-muted-foreground">
            <Search className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No tools match "{search}"</p>
          </CardContent>
        </Card>
      ) : (
        filteredCategories.map((category) => {
          const Icon = category.icon;
          const catEnabled = category.tools.filter((t) => toolConfig[t.name] !== false).length;
          const catTotal = category.tools.length;
          return (
            <Card key={category.id} className="rounded-2xl shadow-lg shadow-slate-200/50 overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-xl ring-1 ${category.accent}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-base font-bold text-foreground">{category.label}</CardTitle>
                      <CardDescription className="text-xs">{category.description}</CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="rounded-full text-xs font-medium">
                      {catEnabled}/{catTotal} on
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs rounded-lg"
                      onClick={() => bulkToggle.mutate({
                        toolNames: category.tools.map((t) => t.name),
                        enabled: catEnabled < catTotal,
                      })}
                    >
                      {catEnabled < catTotal ? 'Enable all' : 'Disable all'}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {category.tools.map((tool) => {
                    const isEnabled = toolConfig[tool.name] !== false;
                    const ToolIcon = tool.icon;
                    const risk = RISK_BADGE[tool.risk];
                    return (
                      <div
                        key={tool.name}
                        className={`group flex items-start gap-3 p-3 rounded-xl border transition-all ${
                          isEnabled
                            ? 'bg-white border-slate-200 hover:border-primary/30 hover:shadow-md hover:shadow-slate-200/60'
                            : 'bg-slate-50/60 border-slate-200/60 opacity-70'
                        }`}
                      >
                        <div className={`p-2 rounded-lg ${category.accent} shrink-0`}>
                          <ToolIcon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-foreground truncate">{tool.label}</p>
                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 rounded-md ${risk.className}`}>
                              {risk.label}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{tool.description}</p>
                          <p className="font-mono text-[10px] text-muted-foreground/70 mt-1 truncate">{tool.name}</p>
                        </div>
                        <Switch
                          checked={isEnabled}
                          onCheckedChange={(checked) => toggleTool.mutate({ toolName: tool.name, enabled: checked })}
                          className="mt-1"
                        />
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })
      )}

      {/* Manual Test Lab */}
      <Card className="rounded-2xl shadow-lg shadow-slate-200/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <div className="bg-emerald-50 text-emerald-600 p-2 rounded-lg ring-1 ring-emerald-100">
              <FlaskConical className="h-4 w-4" />
            </div>
            Manual Test Lab
          </CardTitle>
          <CardDescription>Execute any AI tool with custom JSON arguments to verify behaviour.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Select Tool</label>
              <Select value={testTool} onValueChange={setTestTool}>
                <SelectTrigger className="rounded-lg">
                  <SelectValue placeholder="Choose a tool..." />
                </SelectTrigger>
                <SelectContent>
                  {TOOL_CATEGORIES.map((cat) => (
                    <div key={cat.id}>
                      <div className="px-2 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                        {cat.label}
                      </div>
                      {cat.tools.map((t) => (
                        <SelectItem key={t.name} value={t.name}>
                          <span className="font-mono text-xs">{t.name}</span>
                        </SelectItem>
                      ))}
                    </div>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Arguments (JSON)</label>
              <Textarea
                value={testArgs}
                onChange={(e) => setTestArgs(e.target.value)}
                placeholder='{"member_id": "..."}'
                className="font-mono text-xs rounded-lg min-h-[80px]"
              />
            </div>
          </div>
          <Button
            onClick={handleTestExecute}
            disabled={testRunning || !testTool}
            className="gap-2 rounded-lg"
          >
            {testRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Execute
          </Button>
          {testResult && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-muted-foreground mb-1">Result</p>
              <pre className={`text-xs rounded-lg p-4 overflow-auto max-h-60 border ${testResult.error ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
                {JSON.stringify(testResult, null, 2)}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
