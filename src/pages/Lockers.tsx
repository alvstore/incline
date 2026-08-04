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
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { exportToCSV } from '@/lib/csvExport';

const createLockerSchema = z.object({
  locker_number: z.string().min(1, 'Locker number required'),
  size: z.string().optional(),
  area: z.string().optional(),
  gender_zone: z.enum(['male', 'female', 'common']).default('common'),
  notes: z.string().optional(),
});

export const ZONE_OPTIONS = [
  { value: 'male', label: 'Male room' },
  { value: 'female', label: 'Female room' },
  { value: 'common', label: 'Common area' },
] as const;

export const zoneLabel = (z?: string | null) =>
  ZONE_OPTIONS.find((o) => o.value === z)?.label ?? 'Common area';


type CreateLockerData = z.infer<typeof createLockerSchema>;

export default function LockersPage() {
  const { effectiveBranchId: branchId, isLoading: branchLoading } = useBranchContext();
  const { roles } = useAuth();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isBulkCreateOpen, setIsBulkCreateOpen] = useState(false);
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [selectedLocker, setSelectedLocker] = useState<any>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterZone, setFilterZone] = useState<string>('all');

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
    form.reset();
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

  const filteredLockers = lockers.data?.filter((l: any) => {
    if (filterStatus !== 'all' && l.status !== filterStatus) return false;
    if (filterZone !== 'all' && (l.gender_zone || 'common') !== filterZone) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const area = getLockerArea(l);
      return l.locker_number.toLowerCase().includes(q) || (area && area.toLowerCase().includes(q));
    }
    return true;
  }) || [];


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
              <Button variant="outline" onClick={() => setIsBulkCreateOpen(true)} className="gap-2 rounded-xl">
                <Package className="w-4 h-4" />
                Bulk Create
              </Button>
              <Button onClick={() => setIsCreateOpen(true)} className="gap-2 rounded-xl shadow-lg shadow-primary/20">
                <Plus className="w-4 h-4" />
                Add Locker
              </Button>
            </div>
          )}
        </div>

        {/* Stats Row */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="bg-card border border-border/50 shadow-lg shadow/50 rounded-2xl">
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

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative max-w-xs flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search lockers..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9 rounded-xl" />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-36 rounded-xl"><SelectValue placeholder="Filter" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="available">Available</SelectItem>
                <SelectItem value="assigned">Assigned</SelectItem>
                <SelectItem value="maintenance">Maintenance</SelectItem>
                <SelectItem value="reserved">Reserved</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterZone} onValueChange={setFilterZone}>
              <SelectTrigger className="w-40 rounded-xl" aria-label="Filter by zone"><SelectValue placeholder="Zone" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Zones</SelectItem>
                {ZONE_OPTIONS.map((z) => (
                  <SelectItem key={z.value} value={z.value}>{z.label}</SelectItem>
                ))}
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
                  <CardTitle className="text-lg">Locker Map</CardTitle>
                  <p className="text-sm text-muted-foreground">{filteredLockers.length} lockers</p>
                </div>
              </CardHeader>
              <CardContent>
                {viewMode === 'grid' ? (
                  <>
                    <div className="grid gap-3 grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
                      {filteredLockers.map((locker) => {
                        const activeAssignment = locker.locker_assignments?.find(a => a.is_active);
                        const area = getLockerArea(locker);

                        const memberInfo = activeAssignment ? memberProfiles[activeAssignment.member_id] : null;
                        return (
                          <div
                            key={locker.id}
                            onClick={() => openAssignDialog(locker)}
                            className={`relative p-3 rounded-xl border-2 text-center transition-all duration-200 ${locker.status === 'available' ? 'cursor-pointer hover:scale-105 hover:shadow-md' : 'cursor-default'} ${getStatusColor(locker.status)}`}
                            title={memberInfo ? `${memberInfo.full_name} (${memberInfo.member_code})` : area ? `Area: ${area}` : 'Click to assign'}
                          >
                            <div className="font-bold text-sm">{locker.locker_number}</div>
                            <div className="text-[10px] opacity-70 capitalize">{locker.size || 'M'}</div>
                            {area && (
                              <div className="text-[10px] mt-0.5 flex items-center justify-center gap-0.5 opacity-60">
                                <MapPin className="h-2 w-2" />
                                {area.length > 6 ? area.slice(0, 6) + '…' : area}
                              </div>
                            )}
                            {activeAssignment && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="absolute -top-1.5 -right-1.5 w-5 h-5 p-0 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleReleaseClick(
                                    activeAssignment.id,
                                    locker.id,
                                    memberInfo?.full_name || 'Unknown',
                                    locker.locker_number
                                  );
                                }}
                              >
                                ×
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {filteredLockers.length === 0 && (
                      <div className="text-center text-muted-foreground py-12">
                        <Lock className="h-10 w-10 mx-auto mb-3 opacity-30" />
                        <p>No lockers found</p>
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

        <AssignLockerDrawer open={isAssignOpen} onOpenChange={setIsAssignOpen} locker={selectedLocker} branchId={branchId || ''} />
        <BulkCreateLockersDrawer open={isBulkCreateOpen} onOpenChange={setIsBulkCreateOpen} branchId={branchId || ''} />
      </div>
    </AppLayout>
  );
}
