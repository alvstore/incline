import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Users,
  Shield,
  Search,
  Loader2,
  AlertCircle,
  MoreHorizontal,
  UserPlus,
  UserX,
  Eye,
  Building2,
  KeyRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { CreateMemberLoginDrawer, type MemberWithoutLogin } from '@/components/members/CreateMemberLoginDrawer';
import { provisionMemberLogin } from '@/services/memberLoginService';


type AppRole = Database['public']['Enums']['app_role'];

const ROLE_OPTIONS: AppRole[] = ['owner', 'admin', 'manager', 'staff', 'trainer', 'member'];

const ROLE_COLORS: Record<AppRole, string> = {
  owner: 'bg-primary/10 text-primary border-primary/20',
  admin: 'bg-destructive/10 text-destructive border-destructive/20',
  manager: 'bg-warning/10 text-warning border-warning/20',
  staff: 'bg-info/10 text-info border-info/20',
  trainer: 'bg-success/10 text-success border-success/20',
  member: 'bg-muted-foreground/10 text-muted-foreground border-border/20',
};

const TAB_FILTERS: Record<string, AppRole | null> = {
  all: null,
  admins: 'admin',
  trainers: 'trainer',
  staff: 'staff',
};

export default function AdminRoles() {
  const { hasAnyRole } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [newRole, setNewRole] = useState<AppRole | ''>('');
  const [newBranchId, setNewBranchId] = useState<string>('');
  const [assignReason, setAssignReason] = useState('');
  const [removeConfirm, setRemoveConfirm] = useState<{ userId: string; role: AppRole } | null>(null);
  const [removeReason, setRemoveReason] = useState('');

  const canManageRoles = hasAnyRole(['owner', 'admin']);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-for-role-assign'],
    queryFn: async () => {
      const { data } = await supabase.from('branches').select('id, name').order('name');
      return data || [];
    },
  });

  const { data: usersWithRoles = [], isLoading } = useQuery({
    queryKey: ['users-with-roles'],
    queryFn: async () => {
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, email, full_name, avatar_url, phone')
        .order('full_name');
      if (profilesError) throw profilesError;

      const { data: roles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role');
      if (rolesError) throw rolesError;

      const { data: staffBranches } = await supabase
        .from('staff_branches')
        .select('user_id, branch_id, branches(name)');

      return profiles?.map(profile => ({
        ...profile,
        roles: roles?.filter(r => r.user_id === profile.id).map(r => r.role as AppRole) || [],
        branch: (staffBranches as any[])?.find(sb => sb.user_id === profile.id)?.branches?.name || null,
      })) || [];
    },
  });

  const { data: pendingRequests = [] } = useQuery({
    queryKey: ['role-change-requests'],
    queryFn: async () => {
      const { data } = await supabase
        .from('role_change_requests' as any)
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      return (data as any[]) || [];
    },
  });

  const addRoleMutation = useMutation({
    mutationFn: async ({ userId, role, branchId, reason }: { userId: string; role: AppRole; branchId: string | null; reason: string }) => {
      const { data, error } = await supabase.rpc('assign_user_role', {
        p_target_user_id: userId,
        p_role: role,
        p_branch_id: branchId,
        p_reason: reason,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['users-with-roles'] });
      queryClient.invalidateQueries({ queryKey: ['role-change-requests'] });
      if (data?.status === 'pending_approval') {
        toast.info('Role change submitted for owner approval');
      } else {
        toast.success('Role assigned');
      }
      setSheetOpen(false);
      setSelectedUserId(null);
      setNewRole('');
      setNewBranchId('');
      setAssignReason('');
    },
    onError: (error: any) => toast.error(error.message || 'Failed to assign role'),
  });

  const removeRoleMutation = useMutation({
    mutationFn: async ({ userId, role, reason }: { userId: string; role: AppRole; reason: string }) => {
      const { data, error } = await supabase.rpc('remove_user_role', {
        p_target_user_id: userId,
        p_role: role,
        p_reason: reason,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['users-with-roles'] });
      queryClient.invalidateQueries({ queryKey: ['role-change-requests'] });
      if (data?.status === 'pending_approval') {
        toast.info('Removal submitted for owner approval');
      } else {
        toast.success('Role removed');
      }
      setRemoveConfirm(null);
      setRemoveReason('');
    },
    onError: (error: any) => toast.error(error.message || 'Failed to remove role'),
  });

  const filteredUsers = usersWithRoles.filter(user => {
    const matchesSearch =
      user.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.phone?.toLowerCase().includes(searchQuery.toLowerCase());
    const tabRole = TAB_FILTERS[activeTab];
    const matchesTab = !tabRole || user.roles.includes(tabRole);
    return matchesSearch && matchesTab;
  });

  const selectedUser = usersWithRoles.find(u => u.id === selectedUserId);
  const availableRoles = selectedUser
    ? ROLE_OPTIONS.filter(r => !selectedUser.roles.includes(r))
    : ROLE_OPTIONS;

  if (!canManageRoles) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
          <AlertCircle className="h-12 w-12 text-warning" />
          <h2 className="text-xl font-semibold">Access Denied</h2>
          <p className="text-muted-foreground">Only owners and admins can manage user roles.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="rounded-2xl bg-gradient-to-r from-primary to-primary p-6 text-primary-foreground shadow-lg">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-card/10">
              <Shield className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">User Roles Management</h1>
              <p className="text-primary-foreground/70 text-sm">Manage access, assign roles, and control permissions</p>
            </div>
          </div>
        </div>

        {/* Role Summary Cards */}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-6">
          {ROLE_OPTIONS.map((role) => {
            const count = usersWithRoles.filter(u => u.roles.includes(role)).length;
            return (
              <Card
                key={role}
                className={`rounded-xl shadow-md cursor-pointer transition-all hover:shadow-lg ${activeTab === role ? 'ring-2 ring-primary' : ''}`}
                onClick={() => setActiveTab(activeTab === role ? 'all' : role)}
              >
                <CardContent className="pt-4 pb-4 text-center">
                  <p className="text-2xl font-bold">{count}</p>
                  <p className="text-sm text-muted-foreground capitalize">{role}s</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Search + Tabs */}
        <Card className="rounded-xl shadow-lg shadow/50">
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, email, or phone..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                  <TabsTrigger value="all">All Users</TabsTrigger>
                  <TabsTrigger value="admins">Admins</TabsTrigger>
                  <TabsTrigger value="trainers">Trainers</TabsTrigger>
                  <TabsTrigger value="staff">Staff</TabsTrigger>
                  <TabsTrigger value="logins" className="gap-2">
                    Members without login
                    {membersWithoutLogin.length > 0 && (
                      <Badge variant="secondary" className="rounded-full px-1.5 text-[10px]">
                        {membersWithoutLogin.length}
                      </Badge>
                    )}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </CardHeader>
          <CardContent>
            {activeTab === 'logins' ? (
              loadingNoLogin ? (
                <div className="space-y-2 py-4">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-14 animate-pulse rounded-xl bg-muted/60" />
                  ))}
                </div>
              ) : filteredNoLogin.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <KeyRound className="h-8 w-8 text-muted-foreground" />
                  <p className="font-medium">Every member has a login</p>
                  <p className="text-sm text-muted-foreground">
                    Members converted from leads are provisioned automatically.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {canManageRoles && (
                    <div className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2">
                      <p className="text-sm text-muted-foreground">
                        {filteredNoLogin.length} member{filteredNoLogin.length === 1 ? '' : 's'} cannot sign in or upload a photo.
                      </p>
                      <Button size="sm" onClick={handleBulkProvision} disabled={bulkRunning}>
                        {bulkRunning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Create logins for all
                      </Button>
                    </div>
                  )}
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Member</TableHead>
                          <TableHead className="hidden md:table-cell">Email</TableHead>
                          <TableHead className="hidden md:table-cell">Phone</TableHead>
                          <TableHead className="hidden md:table-cell">Branch</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredNoLogin.map((m) => (
                          <TableRow key={m.id} className="hover:bg-muted/50">
                            <TableCell>
                              <p className="text-sm font-medium">{m.full_name || 'Unnamed member'}</p>
                              <p className="font-mono text-xs text-muted-foreground">{m.member_code || '—'}</p>
                            </TableCell>
                            <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                              {m.email || <span className="text-destructive">missing</span>}
                            </TableCell>
                            <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                              {m.phone || '—'}
                            </TableCell>
                            <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                              {m.branch_name || '—'}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => { setLoginTarget(m); setLoginDrawerOpen(true); }}
                              >
                                <KeyRound className="mr-2 h-4 w-4" /> Create login
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )
            ) : isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : filteredUsers.length === 0 ? (
              <p className="text-muted-foreground text-center py-12">No users found</p>
            ) : (

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Roles</TableHead>
                      <TableHead className="hidden md:table-cell">Branch</TableHead>
                      <TableHead className="hidden md:table-cell">Phone</TableHead>
                      <TableHead className="hidden md:table-cell">Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((user) => (
                      <TableRow key={user.id} className="hover:bg-muted/50">
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">
                              {(user.full_name || 'U')[0].toUpperCase()}
                            </div>
                            <div>
                              <p className="font-medium text-sm">{user.full_name || 'Unnamed'}</p>
                              <p className="text-xs text-muted-foreground">{user.email}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {user.roles.length === 0 ? (
                              <span className="text-muted-foreground text-xs">No roles</span>
                            ) : (
                              user.roles.map((role) => (
                                <Badge key={role} variant="outline" className={`capitalize text-xs ${ROLE_COLORS[role]}`}>
                                  {role}
                                </Badge>
                              ))
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                          {user.branch || '—'}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                          {user.phone || '—'}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <Badge variant={user.roles.length > 0 ? 'default' : 'secondary'} className="text-xs">
                            {user.roles.length > 0 ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { setSelectedUserId(user.id); setSheetOpen(true); }}>
                                <UserPlus className="h-4 w-4 mr-2" /> Assign Role
                              </DropdownMenuItem>
                              {user.roles.map(role => (
                                <DropdownMenuItem
                                  key={role}
                                  className="text-destructive"
                                  onClick={() => setRemoveConfirm({ userId: user.id, role })}
                                >
                                  <UserX className="h-4 w-4 mr-2" /> Remove {role}
                                </DropdownMenuItem>
                              ))}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => navigate(`/members`)}>
                                <Eye className="h-4 w-4 mr-2" /> View Profile
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Assign Role Sheet */}
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Assign Role</SheetTitle>
              <SheetDescription>
                Add a new role to {selectedUser?.full_name || selectedUser?.email}
              </SheetDescription>
            </SheetHeader>
            <div className="py-6 space-y-4">
              <div className="space-y-2">
                <Label>Select Role</Label>
                <Select value={newRole} onValueChange={(v) => setNewRole(v as AppRole)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRoles.map((role) => (
                      <SelectItem key={role} value={role} className="capitalize">{role}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {newRole && ['owner', 'admin'].includes(newRole) && (
                  <p className="text-xs text-warning flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> Owner/Admin assignments require approval unless you are owner.
                  </p>
                )}
              </div>
              {newRole && ['manager', 'staff', 'trainer'].includes(newRole) && (
                <div className="space-y-2">
                  <Label>Branch <span className="text-destructive">*</span></Label>
                  <Select value={newBranchId} onValueChange={setNewBranchId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a branch" />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map((b: any) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label>Reason <span className="text-destructive">*</span></Label>
                <Input
                  placeholder="Why are you assigning this role?"
                  value={assignReason}
                  onChange={(e) => setAssignReason(e.target.value)}
                />
              </div>
              {selectedUser && selectedUser.roles.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Current Roles</Label>
                  <div className="flex flex-wrap gap-1">
                    {selectedUser.roles.map(r => (
                      <Badge key={r} variant="outline" className={`capitalize text-xs ${ROLE_COLORS[r]}`}>{r}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {pendingRequests.length > 0 && (
                <div className="rounded-lg border border-warning/25 bg-warning/10 p-3 text-xs text-warning">
                  <strong>{pendingRequests.length} pending</strong> role change request(s) awaiting owner approval.
                </div>
              )}
            </div>
            <SheetFooter>
              <Button variant="outline" onClick={() => setSheetOpen(false)}>Cancel</Button>
              <Button
                onClick={() => {
                  if (!selectedUserId || !newRole || !assignReason.trim()) return;
                  const requiresBranch = ['manager','staff','trainer'].includes(newRole);
                  if (requiresBranch && !newBranchId) { toast.error('Branch is required'); return; }
                  addRoleMutation.mutate({
                    userId: selectedUserId,
                    role: newRole,
                    branchId: requiresBranch ? newBranchId : null,
                    reason: assignReason.trim(),
                  });
                }}
                disabled={!newRole || !assignReason.trim() || addRoleMutation.isPending}
              >
                {addRoleMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Add Role
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        {/* Remove Role Confirm */}
        <AlertDialog open={!!removeConfirm} onOpenChange={(open) => { if (!open) { setRemoveConfirm(null); setRemoveReason(''); } }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove Role</AlertDialogTitle>
              <AlertDialogDescription>
                Remove the "{removeConfirm?.role}" role? Owner/Admin removals are blocked if it would leave none, and may require approval.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="py-2">
              <Label>Reason <span className="text-destructive">*</span></Label>
              <Input
                placeholder="Reason for removal"
                value={removeReason}
                onChange={(e) => setRemoveReason(e.target.value)}
                className="mt-1"
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (!removeConfirm || !removeReason.trim()) { toast.error('Reason required'); return; }
                  removeRoleMutation.mutate({ ...removeConfirm, reason: removeReason.trim() });
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppLayout>
  );
}
