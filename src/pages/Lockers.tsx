import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLockers } from '@/hooks/useLockers';
import { useBranchContext } from '@/contexts/BranchContext';
import { useAuth } from '@/contexts/AuthContext';
import { Lock, Plus, User, Key, Package, MapPin, Grid3x3, List, Wrench, AlertTriangle, Search, Download } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { toast } from 'sonner';
import { BulkCreateLockersDrawer } from '@/components/lockers/BulkCreateLockersDrawer';
import { AssignLockerDrawer } from '@/components/lockers/AssignLockerDrawer';
import { LockerPricingSheet } from '@/components/lockers/LockerPricingSheet';
import { IndianRupee } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { exportToCSV } from '@/lib/csvExport';
import { ZONE_OPTIONS, zoneLabel } from './lockersConstants';
import { LockerRoomSummary, type LockerRoom } from '@/components/lockers/LockerRoomSummary';
import { ArrangeRoomsSheet } from '@/components/lockers/ArrangeRoomsSheet';
import { LockerDetailSheet, type LockerDetail } from '@/components/lockers/LockerDetailSheet';
import { useSearchParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { Shuffle, Wrench as WrenchIcon, CheckCircle2 } from 'lucide-react';

const createLockerSchema = z.object({
  locker_number: z.string().min(1, 'Locker number required'),
  size: z.string().optional(),
  area: z.string().optional(),
  gender_zone: z.enum(['male', 'female', 'common']).default('common'),
  notes: z.string().optional(),
});



type CreateLockerData = z.infer<typeof createLockerSchema>;

export default function LockersPage() {
  const { effectiveBranchId: branchId, isLoading: branchLoading } = useBranchContext();
  const { roles } = useAuth();
  const [pricingOpen, setPricingOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isBulkCreateOpen, setIsBulkCreateOpen] = useState(false);
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [selectedLocker, setSelectedLocker] = useState<any>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchParams, setSearchParams] = useSearchParams();
  const [arrangeOpen, setArrangeOpen] = useState(false);
  const [detail, setDetail] = useState<LockerDetail | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  
  // Release confirmation state
  const [releaseConfirmOpen, setReleaseConfirmOpen] = useState(false);
  const [releaseTarget, setReleaseTarget] = useState<{ assignmentId: string; lockerId: string; memberName: string; lockerNumber: string } | null>(null);
  const [releaseReason, setReleaseReason] = useState('');

  const { lockers, createLocker, releaseLocker, isCreating } = useLockers(branchId);

  // Cmd+K: ?assign=1 opens the create-locker drawer (closest to "assign")
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('assign') === '1') {
      setIsCreateOpen(true);
      url.searchParams.delete('assign');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  const assignedMemberIds = lockers.data
    ?.flatMap(l => l.locker_assignments?.filter(a => a.is_active).map(a => a.member_id) || [])
    .filter(Boolean) || [];

  const { data: memberProfiles = {} } = useQuery({
    queryKey: ['locker-member-profiles', assignedMemberIds],
    queryFn: async () => {
      if (!assignedMemberIds.length) return {};
      const { data: members } = await supabase
        .from('members')
        .select('id, member_code, user_id')
        .in('id', assignedMemberIds);
      if (!members?.length) return {};
      const userIds = members.map(m => m.user_id).filter(Boolean) as string[];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, phone')
        .in('id', userIds);
      const profileMap: Record<string, any> = {};
      members.forEach(m => {
        const profile = profiles?.find(p => p.id === m.user_id);
        profileMap[m.id] = { ...m, full_name: profile?.full_name, phone: profile?.phone };
      });
      return profileMap;
    },
    enabled: assignedMemberIds.length > 0,
  });

  const form = useForm<CreateLockerData>({
    resolver: zodResolver(createLockerSchema),
    defaultValues: { locker_number: '', size: 'medium', area: '', gender_zone: 'common', notes: '' },
  });

  const onCreateSubmit = (data: CreateLockerData) => {
    if (!branchId) return;
    createLocker({
      branch_id: branchId,
      locker_number: data.locker_number,
      size: data.size,
      location: data.area || null,
      gender_zone: data.gender_zone || 'common',
      notes: data.notes || null,
    });
    setIsCreateOpen(false);
    form.reset({ locker_number: '', size: 'medium', area: '', gender_zone: activeRoom, notes: '' });
  };


  const getStatusColor = (status: string) => {
    switch (status) {
      case 'available': return 'bg-success/15 text-success border-success/30';
      case 'assigned': return 'bg-primary/15 text-primary border-primary/30';
      case 'maintenance': return 'bg-warning/15 text-warning border-warning/30';
      case 'reserved': return 'bg-info/15 text-info border-info/30';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      available: 'bg-success/10 text-success border-success/30',
      assigned: 'bg-primary/10 text-primary border-primary/30',
      maintenance: 'bg-warning/10 text-warning border-warning/30',
      reserved: 'bg-info/10 text-info border-info/30',
    };
    return <Badge variant="outline" className={`capitalize ${colors[status] || ''}`}>{status}</Badge>;
  };

  const getAreaFromNotes = (notes: string | null) => {
    if (!notes) return null;
    const match = notes.match(/^Area:\s*([^|]+)/);
    return match ? match[1].trim() : null;
  };

  // Location comes from the dedicated column; legacy rows kept it inside notes
  const getLockerArea = (l: any) => l?.location || getAreaFromNotes(l?.notes) || null;

  const stats = {
    total: lockers.data?.length || 0,
    available: lockers.data?.filter(l => l.status === 'available').length || 0,
    assigned: lockers.data?.filter(l => l.status === 'assigned').length || 0,
    maintenance: lockers.data?.filter(l => l.status === 'maintenance').length || 0,
  };

  const occupancyRate = stats.total > 0 ? Math.round((stats.assigned / stats.total) * 100) : 0;

  const roomOf = (l: any): LockerRoom => (l.gender_zone || 'common') as LockerRoom;
  const roomStats = (room: LockerRoom) => {
    const list = (lockers.data || []).filter((l: any) => roomOf(l) === room);
    return {
      total: list.length,
      available: list.filter((l: any) => l.status === 'available').length,
      assigned: list.filter((l: any) => l.status === 'assigned').length,
      maintenance: list.filter((l: any) => l.status === 'maintenance').length,
    };
  };
  const rooms = (['male', 'female', 'common'] as LockerRoom[])
    .map((value) => ({ value, label: zoneLabel(value), stats: roomStats(value) }))
    .filter((r) => r.value !== 'common' || r.stats.total > 0);
  const roomParam = searchParams.get('room') as LockerRoom | null;
  const activeRoom: LockerRoom = roomParam && rooms.some((r) => r.value === roomParam)
    ? roomParam
    : (rooms.find((r) => r.stats.total > 0)?.value ?? 'male');
  const selectRoom = (room: LockerRoom) => {
    const next = new URLSearchParams(searchParams);
    next.set('room', room);
    setSearchParams(next, { replace: true });
  };

  const sortLockers = (a: any, b: any) => a.locker_number.localeCompare(b.locker_number, undefined, { numeric: true });
  const filteredLockers = (lockers.data?.filter((l: any) => {
    if (roomOf(l) !== activeRoom) return false;
    if (filterStatus !== 'all' && l.status !== filterStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const area = getLockerArea(l);
      const a = l.locker_assignments?.find((x: any) => x.is_active);
      const m = a ? memberProfiles[a.member_id] : null;
      return l.locker_number.toLowerCase().includes(q) || (area && area.toLowerCase().includes(q))
        || (m?.full_name || '').toLowerCase().includes(q) || (m?.member_code || '').toLowerCase().includes(q);
    }
    return true;
  }) || []).sort(sortLockers);
  const canManage = !roles?.some((r: any) => ['staff'].includes(typeof r === 'string' ? r : r?.role));
  const initials = (n?: string) => (n || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const openDetail = (locker: any) => {
    const a = locker.locker_assignments?.find((x: any) => x.is_active);
    setDetail({
      id: locker.id, locker_number: locker.locker_number, size: locker.size, status: locker.status,
      gender_zone: locker.gender_zone, area: getLockerArea(locker),
      member: a ? memberProfiles[a.member_id] || null : null, assignmentId: a?.id || null,
    });
  };


  const openAssignDialog = (locker: any) => {
    if (locker.status === 'available') {
      setSelectedLocker(locker);
      setIsAssignOpen(true);
    }
  };

  const handleReleaseClick = (assignmentId: string, lockerId: string, memberName: string, lockerNumber: string) => {
    setReleaseTarget({ assignmentId, lockerId, memberName, lockerNumber });
    setReleaseReason('');
    setReleaseConfirmOpen(true);
  };

  const confirmRelease = async () => {
    if (!releaseTarget) return;
    if (!releaseReason.trim()) {
      toast.error('Please provide a reason for releasing this locker');
      return;
    }
    
    try {
      // Log to audit
      await supabase.from('audit_logs').insert({
        action: 'LOCKER_RELEASE',
        table_name: 'locker_assignments',
        record_id: releaseTarget.assignmentId,
        action_description: `Released locker ${releaseTarget.lockerNumber} from ${releaseTarget.memberName}. Reason: ${releaseReason}`,
        actor_name: 'Staff',
      });
    } catch {
      // Non-critical — proceed anyway
    }
    
    releaseLocker({ assignmentId: releaseTarget.assignmentId, lockerId: releaseTarget.lockerId });
    setReleaseConfirmOpen(false);
    setReleaseTarget(null);
    toast.success('Locker released successfully');
  };

  if (branchLoading || !branchId) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-accent to-accent/60 text-accent-foreground">
                <Lock className="h-6 w-6" />
              </div>
              Locker Management
            </h1>
            <p className="text-muted-foreground mt-1">Manage locker assignments, rentals, and availability</p>
          </div>
          {!roles?.some((r: any) => ['staff'].includes(typeof r === 'string' ? r : r?.role)) && (
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {
                const rows = (lockers.data || []).map((l: any) => {
                  const assignment = l.locker_assignments?.find((a: any) => a.is_active);
                  const member = assignment ? memberProfiles[assignment.member_id] : null;
                  return {
                    'Locker #': l.locker_number,
                    Size: l.size || '',
                    'Area / Location': getLockerArea(l) || '',
                    Zone: zoneLabel(l.gender_zone),
                    Status: l.status,
                    'Assigned To': member?.full_name || '',
                    'Member Code': member?.member_code || '',
                  };

                });
                exportToCSV(rows, 'lockers');
              }}>
                <Download className="h-4 w-4" /> Export
              </Button>
              {branchId && (
                <Button variant="outline" onClick={() => setPricingOpen(true)} className="gap-2 rounded-xl">
                  <IndianRupee className="w-4 h-4" />
                  Pricing & GST
                </Button>
              )}
              <Button variant="outline" onClick={() => setIsBulkCreateOpen(true)} className="gap-2 rounded-xl">
                <Package className="w-4 h-4" />
                Bulk Create
              </Button>
              <Button variant="outline" onClick={() => setArrangeOpen(true)} className="gap-2 rounded-xl">
                <Shuffle className="w-4 h-4" />
                Arrange rooms
              </Button>
              <Button onClick={() => { form.setValue('gender_zone', activeRoom); setIsCreateOpen(true); }} className="gap-2 rounded-xl shadow-lg shadow-primary/20">
                <Plus className="w-4 h-4" />
                Add Locker
              </Button>
            </div>
          )}
        </div>

        {/* Stats Row */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="bg-card border border-border/50 shadow-lg shadow-slate-200/50 rounded-2xl">
            <CardContent className="pt-6 pb-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground font-medium">Total Lockers</p>
                  <p className="text-3xl font-bold text-foreground mt-1">{stats.total}</p>
                </div>
                <div className="p-3 rounded-xl bg-muted/50"><Lock className="h-5 w-5 text-muted-foreground" /></div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-success/10 to-success/5 border border-success/20 shadow-lg rounded-2xl">
            <CardContent className="pt-6 pb-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-success font-medium">Available</p>
                  <p className="text-3xl font-bold text-success mt-1">{stats.available}</p>
                </div>
                <div className="p-3 rounded-xl bg-success/10"><Key className="h-5 w-5 text-success" /></div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 shadow-lg rounded-2xl">
            <CardContent className="pt-6 pb-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-primary font-medium">Assigned</p>
                  <p className="text-3xl font-bold text-primary mt-1">{stats.assigned}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{occupancyRate}% occupancy</p>
                </div>
                <div className="p-3 rounded-xl bg-primary/10"><User className="h-5 w-5 text-primary" /></div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-warning/10 to-warning/5 border border-warning/20 shadow-lg rounded-2xl">
            <CardContent className="pt-6 pb-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-warning font-medium">Maintenance</p>
                  <p className="text-3xl font-bold text-warning mt-1">{stats.maintenance}</p>
                </div>
                <div className="p-3 rounded-xl bg-warning/10"><Wrench className="h-5 w-5 text-warning" /></div>
              </div>
            </CardContent>
          </Card>
        </div>

        <LockerRoomSummary rooms={rooms} active={activeRoom} onSelect={selectRoom} />

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative max-w-xs flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search locker or member..." aria-label="Search lockers" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9 rounded-xl" />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-36 rounded-xl" aria-label="Filter by status"><SelectValue placeholder="Filter" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="available">Available</SelectItem>
                <SelectItem value="assigned">Assigned</SelectItem>
                <SelectItem value="maintenance">Maintenance</SelectItem>
                <SelectItem value="reserved">Reserved</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1 bg-muted/50 rounded-xl p-1">
            <Button variant={viewMode === 'grid' ? 'default' : 'ghost'} size="icon" aria-label="Grid view" className="h-8 w-8 rounded-lg" onClick={() => setViewMode('grid')}><Grid3x3 className="h-4 w-4" /></Button>
            <Button variant={viewMode === 'list' ? 'default' : 'ghost'} size="icon" aria-label="List view" className="h-8 w-8 rounded-lg" onClick={() => setViewMode('list')}><List className="h-4 w-4" /></Button>
          </div>
        </div>

        {/* Content */}
        <Tabs defaultValue="overview">
          <TabsList className="bg-muted/50 rounded-xl">
            <TabsTrigger value="overview" className="rounded-lg">Overview</TabsTrigger>
            <TabsTrigger value="assigned" className="rounded-lg">Assigned ({stats.assigned})</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            <Card className="border-border/50 shadow-lg rounded-2xl">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Locker Map · {zoneLabel(activeRoom)}</CardTitle>
                  <p className="text-sm text-muted-foreground">{filteredLockers.length} lockers</p>
                </div>
              </CardHeader>
              <CardContent>
                {viewMode === 'grid' ? (
                  <>
                    {lockers.isLoading ? (
                      <div className="grid gap-3 grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
                        {Array.from({ length: 20 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
                      </div>
                    ) : lockers.isError ? (
                      <div className="text-center py-12 space-y-3">
                        <p className="text-muted-foreground">Lockers could not be loaded.</p>
                        <Button variant="outline" onClick={() => lockers.refetch()}>Try again</Button>
                      </div>
                    ) : (
                    <ul className="grid gap-3 grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10" aria-label={`${zoneLabel(activeRoom)} lockers`}>
                      {filteredLockers.map((locker: any) => {
                        const activeAssignment = locker.locker_assignments?.find((a: any) => a.is_active);
                        const memberInfo = activeAssignment ? memberProfiles[activeAssignment.member_id] : null;
                        const StatusIcon = locker.status === 'available' ? CheckCircle2 : locker.status === 'maintenance' ? WrenchIcon : locker.status === 'assigned' ? User : Key;
                        const label = `Locker ${locker.locker_number}, ${zoneLabel(locker.gender_zone)}, ${locker.status}${memberInfo?.full_name ? `, assigned to ${memberInfo.full_name}` : ''}`;
                        return (
                          <li key={locker.id}>
                            <button
                              type="button"
                              onClick={() => openDetail(locker)}
                              aria-label={label}
                              title={memberInfo ? `${memberInfo.full_name} (${memberInfo.member_code})` : label}
                              className={`w-full min-h-20 p-2 rounded-xl border-2 text-center flex flex-col items-center justify-center gap-1 transition-colors duration-150 hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 cursor-pointer ${getStatusColor(locker.status)}`}
                            >
                              <span className="font-bold text-sm tabular-nums">{locker.locker_number}</span>
                              <span className="flex items-center gap-1 text-[11px] font-medium">
                                <StatusIcon className="h-3 w-3" aria-hidden />
                                {memberInfo ? initials(memberInfo.full_name) : <span className="capitalize">{locker.status === 'available' ? 'Free' : locker.status}</span>}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    )}
                    {filteredLockers.length === 0 && (
                      <div className="text-center text-muted-foreground py-12">
                        <Lock className="h-10 w-10 mx-auto mb-3 opacity-30" />
                        <p>{searchQuery || filterStatus !== 'all' ? 'No lockers match these filters' : `No lockers in ${zoneLabel(activeRoom)} yet`}</p>
                        {canManage && !searchQuery && filterStatus === 'all' && (
                          <Button variant="outline" className="mt-4 gap-2" onClick={() => setArrangeOpen(true)}><Shuffle className="h-4 w-4" />Arrange rooms</Button>
                        )}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-4 mt-6 text-sm">
                      <div className="flex items-center gap-2"><div className="w-4 h-4 rounded-md bg-success/15 border-2 border-success/30" /><span className="text-muted-foreground">Available</span></div>
                      <div className="flex items-center gap-2"><div className="w-4 h-4 rounded-md bg-primary/15 border-2 border-primary/30" /><span className="text-muted-foreground">Assigned</span></div>
                      <div className="flex items-center gap-2"><div className="w-4 h-4 rounded-md bg-warning/15 border-2 border-warning/30" /><span className="text-muted-foreground">Maintenance</span></div>
                      <div className="flex items-center gap-2"><div className="w-4 h-4 rounded-md bg-info/15 border-2 border-info/30" /><span className="text-muted-foreground">Reserved</span></div>
                    </div>
                  </>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Locker</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead>Area / Location</TableHead>
                        <TableHead>Zone</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Assigned To</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLockers.map((locker: any) => {
                        const activeAssignment = locker.locker_assignments?.find((a: any) => a.is_active);
                        const area = getLockerArea(locker);

                        const memberInfo = activeAssignment ? memberProfiles[activeAssignment.member_id] : null;
                        return (
                          <TableRow key={locker.id}>
                            <TableCell className="font-bold">{locker.locker_number}</TableCell>
                            <TableCell className="capitalize">{locker.size || 'Medium'}</TableCell>
                            <TableCell>{area || '—'}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="rounded-full text-xs">{zoneLabel(locker.gender_zone)}</Badge>
                            </TableCell>

                            <TableCell>{getStatusBadge(locker.status)}</TableCell>
                            <TableCell>
                              {memberInfo ? (
                                <div>
                                  <p className="font-medium text-sm">{memberInfo.full_name}</p>
                                  <p className="text-xs text-muted-foreground">{memberInfo.member_code}</p>
                                </div>
                              ) : '—'}
                            </TableCell>
                            <TableCell>
                              {locker.status === 'available' ? (
                                <Button size="sm" variant="outline" onClick={() => openAssignDialog(locker)} className="rounded-lg">Assign</Button>
                              ) : activeAssignment ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => handleReleaseClick(activeAssignment.id, locker.id, memberInfo?.full_name || 'Unknown', locker.locker_number)}
                                >
                                  Release
                                </Button>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="assigned" className="mt-4">
            <Card className="border-border/50 shadow-lg rounded-2xl">
              <CardHeader><CardTitle className="text-lg">Assigned Lockers</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Locker</TableHead>
                      <TableHead>Member</TableHead>
                      <TableHead>Start Date</TableHead>
                      <TableHead>End Date</TableHead>
                      <TableHead>Fee</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lockers.data?.filter(l => l.status === 'assigned').map((locker) => {
                      const activeAssignment = locker.locker_assignments?.find(a => a.is_active);
                      if (!activeAssignment) return null;
                      const memberInfo = memberProfiles[activeAssignment.member_id];
                      return (
                        <TableRow key={locker.id}>
                          <TableCell className="font-bold">{locker.locker_number}</TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium text-sm">{memberInfo?.full_name || 'Unknown'}</p>
                              <p className="text-xs text-muted-foreground">{memberInfo?.member_code || activeAssignment.member_id.slice(0, 8)}</p>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{activeAssignment.start_date}</TableCell>
                          <TableCell className="text-sm">{activeAssignment.end_date || '—'}</TableCell>
                          <TableCell>
                            {activeAssignment.fee_amount ? (
                              <span className="font-medium">₹{activeAssignment.fee_amount}</span>
                            ) : (
                              <Badge variant="outline" className="text-success border-success/30">Free</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive rounded-lg"
                              onClick={() => handleReleaseClick(activeAssignment.id, locker.id, memberInfo?.full_name || 'Unknown', locker.locker_number)}
                            >
                              Release
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {stats.assigned === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No lockers currently assigned</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Create Locker Drawer */}
        <Sheet open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Add New Locker</SheetTitle>
              <SheetDescription>Create a new locker for the branch</SheetDescription>
            </SheetHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onCreateSubmit)} className="space-y-4 mt-6">
                <FormField control={form.control} name="locker_number" render={({ field }) => (
                  <FormItem><FormLabel>Locker Number</FormLabel><FormControl><Input placeholder="A-001" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="size" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Size</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select size" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="small">Small</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="large">Large</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="area" render={({ field }) => (
                  <FormItem><FormLabel>Area / Location</FormLabel><FormControl><Input placeholder="e.g. Men's Changing Room" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="gender_zone" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Zone</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select zone" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {ZONE_OPTIONS.map((z) => (
                          <SelectItem key={z.value} value={z.value}>{z.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="notes" render={({ field }) => (
                  <FormItem><FormLabel>Notes (Optional)</FormLabel><FormControl><Input placeholder="Any notes..." {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <Button type="submit" className="w-full rounded-xl" disabled={isCreating}>{isCreating ? 'Creating...' : 'Create Locker'}</Button>
              </form>
            </Form>
          </SheetContent>
        </Sheet>

        {/* Release Confirmation Drawer */}
        <Sheet open={releaseConfirmOpen} onOpenChange={setReleaseConfirmOpen}>
          <SheetContent className="w-full sm:max-w-md">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                Release Locker
              </SheetTitle>
              <SheetDescription>
                This action will release the locker and remove the member's access. This is logged in the audit trail.
              </SheetDescription>
            </SheetHeader>
            {releaseTarget && (
              <div className="space-y-4 mt-6">
                <div className="p-4 rounded-xl bg-destructive/5 border border-destructive/20">
                  <p className="text-sm font-medium text-foreground">
                    Locker <span className="font-bold">#{releaseTarget.lockerNumber}</span> assigned to <span className="font-bold">{releaseTarget.memberName}</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    If this member's plan includes a locker benefit, releasing it may need manual re-assignment later.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Reason for Release *</Label>
                  <Textarea
                    value={releaseReason}
                    onChange={(e) => setReleaseReason(e.target.value)}
                    placeholder="e.g., Member requested release, membership expired, locker maintenance needed..."
                    rows={3}
                  />
                </div>
                <SheetFooter className="gap-2">
                  <Button variant="outline" onClick={() => setReleaseConfirmOpen(false)}>Cancel</Button>
                  <Button variant="destructive" onClick={confirmRelease} disabled={!releaseReason.trim()}>
                    Confirm Release
                  </Button>
                </SheetFooter>
              </div>
            )}
          </SheetContent>
        </Sheet>

        <ArrangeRoomsSheet open={arrangeOpen} onOpenChange={setArrangeOpen} branchId={branchId || ''} lockers={(lockers.data || []) as any[]} />
        <LockerDetailSheet
          locker={detail}
          branchId={branchId || ''}
          canManage={canManage}
          onOpenChange={(o) => { if (!o) setDetail(null); }}
          onAssign={() => { const l = lockers.data?.find((x: any) => x.id === detail?.id); setDetail(null); if (l) openAssignDialog(l); }}
          onRelease={() => { if (detail?.assignmentId) handleReleaseClick(detail.assignmentId, detail.id, detail.member?.full_name || 'Unknown', detail.locker_number); setDetail(null); }}
        />
        <AssignLockerDrawer open={isAssignOpen} onOpenChange={setIsAssignOpen} locker={selectedLocker} branchId={branchId || ''} />
        <BulkCreateLockersDrawer open={isBulkCreateOpen} onOpenChange={setIsBulkCreateOpen} branchId={branchId || ''} />
        {branchId && <LockerPricingSheet open={pricingOpen} onOpenChange={setPricingOpen} branchId={branchId} />}
      </div>
    </AppLayout>
  );
}
