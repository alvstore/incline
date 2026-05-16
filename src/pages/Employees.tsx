import { useMemo, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Plus, Search, Users, UserMinus, UserCheck, FileText, Filter, Dumbbell, Pencil, Briefcase, ChevronDown } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { AddEmployeeDrawer } from '@/components/employees/AddEmployeeDrawer';
import { EditEmployeeDrawer } from '@/components/employees/EditEmployeeDrawer';
import { EditTrainerDrawer } from '@/components/trainers/EditTrainerDrawer';
import { CreateContractDrawer } from '@/components/hrm/CreateContractDrawer';
import { toast } from 'sonner';

type RoleFilter = 'all' | 'manager' | 'trainer' | 'staff';
type Role = 'manager' | 'trainer' | 'staff';

interface StaffPerson {
  key: string;                 // user_id (or fallback record id)
  user_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  profile: any;
  roles: Role[];               // sorted, unique
  employee?: any;              // raw employees row (when role manager/staff)
  trainer?: any;               // raw trainers row (when role trainer)
  code: string | null;         // employee_code preferred, else trainer code
  department: string | null;
  position: string | null;
  specialization: string | null;
  branch_id: string | null;
  branch_name: string | null;
  is_active: boolean;
  hire_date: string;
}

const roleClass: Record<Role, string> = {
  manager: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/30',
  trainer: 'bg-purple-500/10 text-purple-600 border-purple-500/30',
  staff:   'bg-blue-500/10 text-blue-600 border-blue-500/30',
};

function detectEmployeeRole(emp: any): Role {
  const dept = String(emp?.department || '').toLowerCase();
  const pos = String(emp?.position || '').toLowerCase();
  if (dept.includes('management') || pos.includes('manager')) return 'manager';
  return 'staff';
}

export default function EmployeesPage() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [contractOpen, setContractOpen] = useState(false);
  const [contractTarget, setContractTarget] = useState<any>(null);
  const [contractDefaultRole, setContractDefaultRole] = useState<'trainer' | 'manager' | 'staff' | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');

  const [editEmpOpen, setEditEmpOpen] = useState(false);
  const [editTrainerOpen, setEditTrainerOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<any>(null);

  const { data: people = [], isLoading } = useQuery<StaffPerson[]>({
    queryKey: ['unified-staff-people'],
    queryFn: async () => {
      const [{ data: employees, error: empError }, { data: trainers, error: trainerError }] = await Promise.all([
        supabase.from('employees').select(`*, branches:branch_id(name)`).order('created_at', { ascending: false }),
        supabase.from('trainers').select(`*, branches:branch_id(name)`).order('created_at', { ascending: false }),
      ]);
      if (empError) throw empError;
      if (trainerError) throw trainerError;

      const allUserIds = [
        ...(employees || []).map(e => e.user_id),
        ...(trainers || []).map(t => t.user_id),
      ].filter(Boolean) as string[];

      let profileMap = new Map<string, any>();
      if (allUserIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, email, phone, avatar_url, gender, date_of_birth, address, city, state, postal_code, emergency_contact_name, emergency_contact_phone, government_id_type, government_id_number')
          .in('id', allUserIds);
        profileMap = new Map((profiles || []).map(p => [p.id, p]));
      }

      // Aggregate by user_id
      const map = new Map<string, StaffPerson>();
      const upsert = (key: string, base: Partial<StaffPerson>) => {
        const existing = map.get(key);
        if (!existing) {
          map.set(key, base as StaffPerson);
        } else {
          map.set(key, {
            ...existing,
            ...base,
            roles: Array.from(new Set([...existing.roles, ...(base.roles || [])])) as Role[],
            employee: base.employee || existing.employee,
            trainer: base.trainer || existing.trainer,
            code: existing.code || base.code || null,
            department: existing.department || base.department || null,
            position: existing.position || base.position || null,
            specialization: existing.specialization || base.specialization || null,
            branch_id: existing.branch_id || base.branch_id || null,
            branch_name: existing.branch_name || base.branch_name || null,
            is_active: (existing.is_active || !!base.is_active),
            hire_date: existing.hire_date || base.hire_date || new Date().toISOString(),
            profile: existing.profile || base.profile,
            name: existing.name || base.name || 'Unknown',
            email: existing.email || base.email || null,
            phone: existing.phone || base.phone || null,
            avatar_url: existing.avatar_url || base.avatar_url || null,
          });
        }
      };

      (employees || []).forEach((emp: any) => {
        const key = emp.user_id || `emp-${emp.id}`;
        const p = emp.user_id ? profileMap.get(emp.user_id) : null;
        upsert(key, {
          key,
          user_id: emp.user_id,
          name: p?.full_name || 'Unknown',
          email: p?.email || null,
          phone: p?.phone || null,
          avatar_url: p?.avatar_url || null,
          profile: p || null,
          roles: [detectEmployeeRole(emp)],
          employee: emp,
          code: emp.employee_code,
          department: emp.department,
          position: emp.position,
          specialization: null,
          branch_id: emp.branch_id,
          branch_name: (emp.branches as any)?.name || null,
          is_active: !!emp.is_active,
          hire_date: emp.hire_date,
        });
      });

      (trainers || []).forEach((t: any) => {
        const key = t.user_id || `tr-${t.id}`;
        const p = t.user_id ? profileMap.get(t.user_id) : null;
        upsert(key, {
          key,
          user_id: t.user_id,
          name: p?.full_name || 'Unknown',
          email: p?.email || null,
          phone: p?.phone || null,
          avatar_url: p?.avatar_url || null,
          profile: p || null,
          roles: ['trainer'],
          trainer: t,
          code: t.trainer_code || null, // employee_code wins if both (upsert preserves earlier value)
          department: 'Training',
          position: 'Trainer',
          specialization: t.specializations?.join(', ') || null,
          branch_id: t.branch_id,
          branch_name: (t.branches as any)?.name || null,
          is_active: !!t.is_active,
          hire_date: t.created_at,
        });
      });

      return Array.from(map.values());
    },
  });

  const departments = useMemo(
    () => Array.from(new Set(people.map(p => p.department).filter(Boolean))) as string[],
    [people],
  );

  const filteredPeople = people.filter((p) => {
    const term = search.toLowerCase();
    const matchesSearch = !term ||
      p.name?.toLowerCase().includes(term) ||
      p.code?.toLowerCase().includes(term) ||
      p.email?.toLowerCase().includes(term) ||
      (p.phone || '').includes(search);
    const matchesDept = departmentFilter === 'all' || p.department === departmentFilter;
    const matchesStatus = statusFilter === 'all' ||
      (statusFilter === 'active' && p.is_active) ||
      (statusFilter === 'inactive' && !p.is_active);
    const matchesRole = roleFilter === 'all' || p.roles.includes(roleFilter);
    return matchesSearch && matchesDept && matchesStatus && matchesRole;
  });

  // People-centric stats; sum of role counts may exceed people (1 person, 2 roles).
  const stats = useMemo(() => ({
    people: people.length,
    managers: people.filter(p => p.roles.includes('manager')).length,
    trainers: people.filter(p => p.roles.includes('trainer')).length,
    otherStaff: people.filter(p => p.roles.includes('staff')).length,
    active: people.filter(p => p.is_active).length,
    dualRole: people.filter(p => p.roles.length > 1).length,
  }), [people]);

  const toggleActive = async (person: StaffPerson, role: Role) => {
    try {
      if (role === 'trainer' && person.trainer) {
        const { error } = await supabase.from('trainers').update({ is_active: !person.trainer.is_active }).eq('id', person.trainer.id);
        if (error) throw error;
      } else if (person.employee) {
        const { error } = await supabase.from('employees').update({ is_active: !person.employee.is_active }).eq('id', person.employee.id);
        if (error) throw error;
      }
      toast.success('Status updated');
      queryClient.invalidateQueries({ queryKey: ['unified-staff-people'] });
    } catch {
      toast.error('Failed to update status');
    }
  };

  const openContractFor = (person: StaffPerson, role: Role) => {
    if (role === 'trainer' && person.trainer) {
      setContractTarget({
        id: person.trainer.id,
        user_id: person.user_id,
        staff_type: 'trainer',
        branch_id: person.trainer.branch_id,
        employee_code: null,
        department: 'Training',
        position: 'Trainer',
        salary: person.trainer.fixed_salary || 0,
        profile: person.profile || { full_name: person.name, email: person.email, phone: person.phone },
        full_name: person.name,
      });
      setContractDefaultRole('trainer');
    } else if (person.employee) {
      setContractTarget({
        ...person.employee,
        user_id: person.user_id,
        staff_type: 'employee',
        profile: person.profile || { full_name: person.name, email: person.email, phone: person.phone },
        full_name: person.name,
      });
      setContractDefaultRole(role === 'manager' ? 'manager' : 'staff');
    }
    setContractOpen(true);
  };

  const openEditFor = (person: StaffPerson, role: Role) => {
    if (role === 'trainer' && person.trainer) {
      setEditingRow({ ...person.trainer, profile: person.profile, profile_name: person.name });
      setEditTrainerOpen(true);
    } else if (person.employee) {
      setEditingRow({
        ...person.employee,
        profile: person.profile,
        branch: { name: person.branch_name },
      });
      setEditEmpOpen(true);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">All Staff</h1>
            <p className="text-muted-foreground">One person, all roles. Managers, trainers and staff unified.</p>
          </div>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Employee
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-5">
          <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Users className="h-4 w-4" />
                People
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.people}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats.dualRole > 0 ? `${stats.dualRole} hold multiple roles` : 'unique humans'}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-indigo-500/10 to-indigo-500/5 border-indigo-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-indigo-600" />
                Managers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-indigo-600">{stats.managers}</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-purple-500/10 to-purple-500/5 border-purple-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Dumbbell className="h-4 w-4 text-purple-600" />
                Trainers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-purple-600">{stats.trainers}</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-blue-500/10 to-blue-500/5 border-blue-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Other Staff</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-blue-600">{stats.otherStaff}</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-success/10 to-success/5 border-success/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-success">{stats.active}</div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-4">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, code, email, or phone..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as RoleFilter)}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  <SelectItem value="manager">Managers</SelectItem>
                  <SelectItem value="trainer">Trainers</SelectItem>
                  <SelectItem value="staff">Other Staff</SelectItem>
                </SelectContent>
              </Select>
              <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                <SelectTrigger className="w-[180px]">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {departments.map((dept) => (
                    <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Staff Table */}
        <Card>
          <CardHeader>
            <CardTitle>All Staff ({filteredPeople.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Staff Member</TableHead>
                    <TableHead>Roles</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Hire Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPeople.map((person) => (
                    <TableRow key={person.key}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-10 w-10">
                            <AvatarImage src={person.avatar_url || undefined} />
                            <AvatarFallback className="bg-primary/10 text-primary">
                              {person.name?.[0] || 'S'}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium">{person.name || 'N/A'}</div>
                            <div className="text-sm text-muted-foreground">{person.email}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {person.roles.map((r) => (
                            <Badge key={r} className={roleClass[r]}>
                              {r === 'trainer' && <Dumbbell className="h-3 w-3 mr-1" />}
                              {r === 'manager' && <Briefcase className="h-3 w-3 mr-1" />}
                              {r.charAt(0).toUpperCase() + r.slice(1)}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{person.code || '-'}</TableCell>
                      <TableCell>{person.department || '-'}</TableCell>
                      <TableCell>
                        {person.position || '-'}
                        {person.specialization && (
                          <span className="block text-xs text-muted-foreground">{person.specialization}</span>
                        )}
                      </TableCell>
                      <TableCell>{person.branch_name || '-'}</TableCell>
                      <TableCell>
                        <Badge className={person.is_active ? 'bg-success/10 text-success border-success/30' : 'bg-muted text-muted-foreground'}>
                          {person.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell>{new Date(person.hire_date).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {/* Edit */}
                          {person.roles.length > 1 ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" title="Edit">
                                  <Pencil className="h-4 w-4" />
                                  <ChevronDown className="h-3 w-3 ml-0.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel>Edit role</DropdownMenuLabel>
                                {person.roles.map((r) => (
                                  <DropdownMenuItem key={r} onClick={() => openEditFor(person, r)}>
                                    {r === 'trainer' ? 'Trainer profile & commission' : r === 'manager' ? 'Manager profile & salary' : 'Staff profile & salary'}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            <Button variant="ghost" size="sm" onClick={() => openEditFor(person, person.roles[0])} title="Edit">
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}

                          {/* Contract */}
                          {person.roles.length > 1 ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" title="Contracts">
                                  <FileText className="h-4 w-4" />
                                  <ChevronDown className="h-3 w-3 ml-0.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel>New contract for…</DropdownMenuLabel>
                                {person.roles.map((r) => (
                                  <DropdownMenuItem key={r} onClick={() => openContractFor(person, r)}>
                                    {r.charAt(0).toUpperCase() + r.slice(1)} role
                                  </DropdownMenuItem>
                                ))}
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                                  Each role gets its own contract.
                                </DropdownMenuLabel>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            <Button variant="ghost" size="sm" onClick={() => openContractFor(person, person.roles[0])} title="Create Contract">
                              <FileText className="h-4 w-4" />
                            </Button>
                          )}

                          {/* Toggle active */}
                          {person.roles.length > 1 ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" title="Toggle active">
                                  {person.is_active ? <UserMinus className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel>Toggle role status</DropdownMenuLabel>
                                {person.roles.map((r) => (
                                  <DropdownMenuItem key={r} onClick={() => toggleActive(person, r)}>
                                    {r.charAt(0).toUpperCase() + r.slice(1)}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            <Button variant="ghost" size="sm" onClick={() => toggleActive(person, person.roles[0])} title={person.is_active ? 'Deactivate' : 'Activate'}>
                              {person.is_active ? <UserMinus className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredPeople.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                        {search || departmentFilter !== 'all' || statusFilter !== 'all' || roleFilter !== 'all'
                          ? 'No staff match your filters'
                          : 'No staff found'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <AddEmployeeDrawer open={addOpen} onOpenChange={setAddOpen} />
        <CreateContractDrawer
          open={contractOpen}
          onOpenChange={(o) => { setContractOpen(o); if (!o) setContractDefaultRole(undefined); }}
          employee={contractTarget}
          defaultRole={contractDefaultRole}
        />
        <EditEmployeeDrawer
          open={editEmpOpen}
          onOpenChange={(o) => { setEditEmpOpen(o); if (!o) queryClient.invalidateQueries({ queryKey: ['unified-staff-people'] }); }}
          employee={editingRow}
        />
        <EditTrainerDrawer
          open={editTrainerOpen}
          onOpenChange={(o) => { setEditTrainerOpen(o); if (!o) queryClient.invalidateQueries({ queryKey: ['unified-staff-people'] }); }}
          trainer={editingRow}
        />
      </div>
    </AppLayout>
  );
}
