import { useState, useMemo, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, LayoutGrid, List, Calendar, Download, Target, BarChart3, Save, BookmarkCheck, X, Bot, Clock } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { exportToCSV } from '@/lib/csvExport';
import { leadService, type LeadFilters } from '@/services/leadService';
import { supabase } from '@/integrations/supabase/client';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek, subHours } from 'date-fns';
import { useBranchContext } from '@/contexts/BranchContext';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// Components
import { AddLeadDrawer } from '@/components/leads/AddLeadDrawer';
import { FollowupDrawer } from '@/components/leads/FollowupDrawer';
import { ConvertMemberDrawer } from '@/components/leads/ConvertMemberDrawer';
import { LeadDashboard } from '@/components/leads/LeadDashboard';
import { LeadKanban } from '@/components/leads/LeadKanban';
import { LeadList } from '@/components/leads/LeadList';
import { LeadFilterBar, STATUS_CONFIG } from '@/components/leads/LeadFilters';
import { LeadProfileDrawer } from '@/components/leads/LeadProfileDrawer';
import { LeadAnalytics } from '@/components/leads/LeadAnalytics';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { CardHeader, CardTitle } from '@/components/ui/card';

export default function LeadsPage() {
  const { user } = useAuth();
  const { effectiveBranchId, branchFilter } = useBranchContext();
  const queryClient = useQueryClient();

  // UI State
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [showAddDrawer, setShowAddDrawer] = useState(false);
  const [showFollowupDrawer, setShowFollowupDrawer] = useState(false);
  const [showConvertDrawer, setShowConvertDrawer] = useState(false);
  const [showProfileDrawer, setShowProfileDrawer] = useState(false);
  const [viewMode, setViewMode] = useState<'kanban' | 'list' | 'calendar' | 'analytics' | 'ai_audit'>('kanban');
  const [page, setPage] = useState(0);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [showSaveView, setShowSaveView] = useState(false);
  const [newViewName, setNewViewName] = useState('');

  // Filters
  const [filters, setFilters] = useState<LeadFilters>({});
  const [statusFilter, setStatusFilter] = useState<string[]>(['new', 'contacted', 'qualified', 'negotiation']);
  const [temperatureFilter, setTemperatureFilter] = useState<string[]>([]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setShowAddDrawer(true); }
      if (e.key === 'k' || e.key === 'K') { e.preventDefault(); setViewMode('kanban'); }
      if (e.key === 'l' || e.key === 'L') { e.preventDefault(); setViewMode('list'); }
      if (e.key === 'a' || e.key === 'A') { e.preventDefault(); setViewMode('analytics'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Cmd+K deep-links: ?new=1 opens AddLead, ?lead=<id> opens profile drawer
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('new') === '1') {
      setShowAddDrawer(true);
      url.searchParams.delete('new');
      window.history.replaceState({}, '', url.toString());
    }
    const leadId = url.searchParams.get('lead');
    if (!leadId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('leads').select('*').eq('id', leadId).maybeSingle();
      if (cancelled || !data) return;
      setSelectedLead(data);
      setShowProfileDrawer(true);
      const u2 = new URL(window.location.href);
      u2.searchParams.delete('lead');
      window.history.replaceState({}, '', u2.toString());
    })();
    return () => { cancelled = true; };
  }, []);

  // Data
  const { data: leads = [], isLoading } = useQuery({
    queryKey: ['leads', branchFilter],
    queryFn: () => leadService.fetchLeads(branchFilter),
    enabled: !!user,
  });

  const { data: stats } = useQuery({
    queryKey: ['lead-stats', branchFilter],
    queryFn: () => leadService.getLeadStats(branchFilter),
    enabled: !!user,
  });

  // AI Capture audit: last 24h WhatsApp conversations that didn't become leads
  const { data: aiAuditData = [], isLoading: aiAuditLoading } = useQuery({
    queryKey: ['ai-audit-leads', branchFilter],
    queryFn: async () => {
      const since = subHours(new Date(), 24).toISOString();
      // Get inbound WhatsApp messages from last 24h
      const { data: messages } = await supabase
        .from('whatsapp_messages')
        .select('phone_number, contact_name, content, created_at, branch_id')
        .eq('direction', 'inbound')
        .gte('created_at', since)
        .order('created_at', { ascending: false });

      if (!messages) return [];

      // Group by phone, get unique phones
      const phoneMap = new Map<string, any>();
      for (const msg of messages) {
        if (!phoneMap.has(msg.phone_number)) {
          phoneMap.set(msg.phone_number, {
            phone: msg.phone_number,
            contact_name: msg.contact_name,
            last_message: msg.content,
            last_at: msg.created_at,
            branch_id: msg.branch_id,
          });
        }
      }

      // Check which phones already have leads
      const phones = Array.from(phoneMap.keys());
      if (phones.length === 0) return [];

      const { data: existingLeads } = await supabase
        .from('leads')
        .select('phone')
        .in('phone', phones);

      const existingPhones = new Set((existingLeads || []).map(l => l.phone));

      // Also check for members
      const { data: profiles } = await supabase
        .from('profiles')
        .select('phone')
        .in('phone', phones);

      const memberPhones = new Set((profiles || []).map(p => p.phone).filter(Boolean));

      return Array.from(phoneMap.values()).filter(
        (p) => !existingPhones.has(p.phone) && !memberPhones.has(p.phone)
      );
    },
    enabled: !!user && viewMode === 'ai_audit',
  });

  const { data: savedViews = [] } = useQuery({
    queryKey: ['saved-lead-views'],
    queryFn: () => leadService.getSavedViews(),
    enabled: !!user,
  });

  const saveViewMutation = useMutation({
    mutationFn: (name: string) => leadService.saveView(name, { ...filters, status: statusFilter, temperature: temperatureFilter }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-lead-views'] });
      setShowSaveView(false);
      setNewViewName('');
      toast.success('View saved');
    },
  });

  const deleteViewMutation = useMutation({
    mutationFn: (id: string) => leadService.deleteView(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-lead-views'] });
      toast.success('View deleted');
    },
  });

  const loadView = (view: any) => {
    const f = view.filters || {};
    setFilters({ search: f.search, source: f.source, ownerId: f.ownerId, overdueOnly: f.overdueOnly });
    setStatusFilter(f.status || []);
    setTemperatureFilter(f.temperature || []);
    toast.success(`Loaded view: ${view.name}`);
  };

  // Derived
  const sources = useMemo(() => {
    const s = new Set(leads.map((l: any) => l.source).filter(Boolean));
    return Array.from(s) as string[];
  }, [leads]);

  const STALE_DAYS = 3;
  const ACTIVE_STAGES = ['new', 'contacted', 'qualified', 'negotiation'];
  const isStale = (l: any) => {
    if (!ACTIVE_STAGES.includes(l.status)) return false;
    const ref = l.last_contacted_at || l.created_at;
    if (!ref) return false;
    const ageMs = Date.now() - new Date(ref).getTime();
    return ageMs > STALE_DAYS * 24 * 60 * 60 * 1000;
  };

  const [showStaleOnly, setShowStaleOnly] = useState(false);

  const filteredLeads = useMemo(() => {
    return leads.filter((lead: any) => {
      const matchesSearch = !filters.search ||
        lead.full_name?.toLowerCase().includes(filters.search.toLowerCase()) ||
        lead.phone?.includes(filters.search) ||
        lead.email?.toLowerCase().includes(filters.search.toLowerCase());
      const matchesSource = !filters.source || filters.source === 'all' || lead.source === filters.source;
      const matchesStatus = statusFilter.length === 0 || statusFilter.includes(lead.status);
      const matchesTemp = temperatureFilter.length === 0 || temperatureFilter.includes(lead.temperature);
      const matchesOwner = !filters.ownerId || (filters.ownerId === 'unassigned' ? !lead.owner_id : lead.owner_id === filters.ownerId);
      const matchesOverdue = !filters.overdueOnly || (lead.next_action_at && new Date(lead.next_action_at) < new Date());
      const matchesStale = !showStaleOnly || isStale(lead);
      return matchesSearch && matchesSource && matchesStatus && matchesTemp && matchesOwner && matchesOverdue && matchesStale;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, filters, statusFilter, temperatureFilter, showStaleOnly]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const staleCount = useMemo(() => leads.filter(isStale).length, [leads]);

  // Actions
  const openProfile = useCallback((lead: any) => { setSelectedLead(lead); setShowProfileDrawer(true); }, []);
  const openFollowup = useCallback((lead: any) => { setSelectedLead(lead); setShowFollowupDrawer(true); }, []);
  const openConvert = useCallback((lead: any) => { setSelectedLead(lead); setShowConvertDrawer(true); }, []);

  // Calendar helpers
  const monthStart = startOfMonth(calendarMonth);
  const monthEnd = endOfMonth(calendarMonth);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  const getLeadsForDay = (day: Date) => filteredLeads.filter((l: any) => isSameDay(new Date(l.created_at), day));

  return (
    <AppLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground">
                <Target className="h-6 w-6" />
              </div>
              Lead Management
            </h1>
            <p className="text-muted-foreground mt-1">Track, nurture, and convert leads into members</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex bg-muted rounded-xl p-1">
              <Button variant={viewMode === 'kanban' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('kanban')} className="rounded-lg" title="Kanban (K)">
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button variant={viewMode === 'list' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('list')} className="rounded-lg" title="List (L)">
                <List className="h-4 w-4" />
              </Button>
              <Button variant={viewMode === 'calendar' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('calendar')} className="rounded-lg">
                <Calendar className="h-4 w-4" />
              </Button>
              <Button variant={viewMode === 'analytics' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('analytics')} className="rounded-lg" title="Analytics (A)">
                <BarChart3 className="h-4 w-4" />
              </Button>
              <Button variant={viewMode === 'ai_audit' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('ai_audit')} className="rounded-lg" title="AI Capture Audit">
                <Bot className="h-4 w-4" />
              </Button>
            </div>

            {/* Saved Views */}
            {savedViews.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="rounded-xl gap-1.5">
                    <BookmarkCheck className="h-4 w-4" /> Views
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-2">
                  {savedViews.map((v: any) => (
                    <div key={v.id} className="flex items-center justify-between py-1 px-2 hover:bg-muted rounded-lg">
                      <button className="text-sm text-left flex-1" onClick={() => loadView(v)}>{v.name}</button>
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => deleteViewMutation.mutate(v.id)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </PopoverContent>
              </Popover>
            )}

            <Popover open={showSaveView} onOpenChange={setShowSaveView}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="rounded-xl gap-1.5">
                  <Save className="h-4 w-4" /> Save View
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-3">
                <Input
                  placeholder="View name..."
                  value={newViewName}
                  onChange={(e) => setNewViewName(e.target.value)}
                  className="mb-2"
                />
                <Button size="sm" className="w-full" disabled={!newViewName.trim()}
                  onClick={() => saveViewMutation.mutate(newViewName.trim())}
                >
                  Save
                </Button>
              </PopoverContent>
            </Popover>

            <Button onClick={() => setShowAddDrawer(true)} className="gap-2 rounded-xl shadow-lg shadow-primary/20" title="Add Lead (N)">
              <Plus className="h-4 w-4" /> Add Lead
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 rounded-xl" onClick={() => {
              const rows = filteredLeads.map((l: any) => ({
                Name: l.full_name || '', Phone: l.phone || '', Email: l.email || '',
                Source: l.source || 'Direct', Status: l.status || '', Temperature: l.temperature || '',
                Score: l.score || 0, 'Created At': l.created_at ? format(new Date(l.created_at), 'yyyy-MM-dd') : '',
                Notes: l.notes || '', 'UTM Source': l.utm_source || '', 'UTM Campaign': l.utm_campaign || '',
              }));
              exportToCSV(rows, 'leads');
            }}>
              <Download className="h-4 w-4" /> Export
            </Button>
          </div>
        </div>

        {/* Dashboard Stats */}
        {stats && <LeadDashboard stats={stats} />}

        {/* Stale-leads SLA banner */}
        {staleCount > 0 && viewMode !== 'analytics' && (
          <div className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-9 w-9 shrink-0 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
                <Clock className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-amber-900">
                  {staleCount} stale lead{staleCount === 1 ? '' : 's'} need attention
                </p>
                <p className="text-xs text-amber-700">
                  Active leads with no contact in the last 3 days. Reach out to keep them warm.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant={showStaleOnly ? 'default' : 'outline'}
              className="rounded-xl shrink-0"
              onClick={() => setShowStaleOnly((v) => !v)}
            >
              {showStaleOnly ? 'Show all' : 'Show stale only'}
            </Button>
          </div>
        )}

        {/* Filters */}
        {viewMode !== 'analytics' && (
          <Card className="rounded-2xl border-border/50 shadow-lg shadow-primary/5">
            <CardContent className="pt-5 pb-4">
              <LeadFilterBar
                filters={filters}
                onFiltersChange={(f) => { setFilters(f); setPage(0); }}
                sources={sources}
                statusFilter={statusFilter}
                onStatusFilterChange={(s) => { setStatusFilter(s); setPage(0); }}
                temperatureFilter={temperatureFilter}
                onTemperatureFilterChange={(t) => { setTemperatureFilter(t); setPage(0); }}
              />
            </CardContent>
          </Card>
        )}

        {/* Views */}
        {viewMode === 'kanban' && (
          <LeadKanban leads={filteredLeads} onSelectLead={openProfile} onFollowup={openFollowup} onConvert={openConvert} />
        )}
        {viewMode === 'list' && (
          <LeadList leads={filteredLeads} isLoading={isLoading} page={page} onPageChange={setPage} onSelectLead={openProfile} onFollowup={openFollowup} onConvert={openConvert} />
        )}
        {viewMode === 'analytics' && (
          <LeadAnalytics leads={filteredLeads} />
        )}
        {viewMode === 'calendar' && (
          <Card className="rounded-2xl border-border/50 shadow-lg">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{format(calendarMonth, 'MMMM yyyy')}</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="icon" onClick={() => setCalendarMonth(d => subMonths(d, 1))} className="rounded-xl">
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setCalendarMonth(new Date())} className="rounded-xl">Today</Button>
                  <Button variant="outline" size="icon" onClick={() => setCalendarMonth(d => addMonths(d, 1))} className="rounded-xl">
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-px bg-border rounded-xl overflow-hidden">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                  <div key={d} className="bg-muted p-2 text-center text-xs font-medium text-muted-foreground">{d}</div>
                ))}
                {calendarDays.map((day, idx) => {
                  const dayLeads = getLeadsForDay(day);
                  const isCurrentMonth = isSameMonth(day, calendarMonth);
                  const isToday = isSameDay(day, new Date());
                  return (
                    <div key={idx} className={`bg-card p-2 min-h-[80px] ${!isCurrentMonth ? 'opacity-40' : ''} ${isToday ? 'ring-2 ring-primary ring-inset' : ''}`}>
                      <p className={`text-xs font-medium mb-1 ${isToday ? 'text-primary font-bold' : 'text-muted-foreground'}`}>
                        {format(day, 'd')}
                      </p>
                      {dayLeads.slice(0, 3).map((lead: any) => (
                        <div key={lead.id} className={`text-xs px-1.5 py-0.5 rounded mb-0.5 truncate cursor-pointer ${STATUS_CONFIG[lead.status]?.color || 'bg-muted'}`} onClick={() => openProfile(lead)}>
                          {lead.full_name}
                        </div>
                      ))}
                      {dayLeads.length > 3 && <p className="text-xs text-muted-foreground">+{dayLeads.length - 3} more</p>}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
        {viewMode === 'ai_audit' && (
          <Card className="rounded-2xl border-border/50 shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-primary" />
                AI Capture Audit — Last 24 Hours
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                WhatsApp conversations from non-members/non-leads that may need manual follow-up
              </p>
            </CardHeader>
            <CardContent>
              {aiAuditLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : aiAuditData.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No uncaptured conversations in the last 24 hours ✓
                </div>
              ) : (
                <div className="space-y-2">
                  {aiAuditData.map((item: any, idx: number) => (
                    <div key={idx} className="flex items-center justify-between p-3 rounded-xl border hover:bg-muted/50 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{item.contact_name || 'Unknown'}</p>
                        <p className="text-xs text-muted-foreground font-mono">{item.phone}</p>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{item.last_message}</p>
                      </div>
                      <div className="flex items-center gap-2 ml-3">
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {format(new Date(item.last_at), 'HH:mm')}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-lg"
                          onClick={() => {
                            setShowAddDrawer(true);
                          }}
                        >
                          <Plus className="h-3 w-3 mr-1" /> Create Lead
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Drawers */}
      <LeadProfileDrawer open={showProfileDrawer} onOpenChange={setShowProfileDrawer} lead={selectedLead} onFollowup={openFollowup} onConvert={openConvert} />
      <AddLeadDrawer open={showAddDrawer} onOpenChange={setShowAddDrawer} defaultBranchId={effectiveBranchId || ''} />
      <FollowupDrawer open={showFollowupDrawer} onOpenChange={setShowFollowupDrawer} lead={selectedLead} />
      <ConvertMemberDrawer open={showConvertDrawer} onOpenChange={setShowConvertDrawer} lead={selectedLead} />
    </AppLayout>
  );
}
