import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CreateContractDrawer } from '@/components/hrm/CreateContractDrawer';
import { AddEmployeeDrawer } from '@/components/employees/AddEmployeeDrawer';
import { EditEmployeeDrawer } from '@/components/employees/EditEmployeeDrawer';
import { EditTrainerDrawer } from '@/components/trainers/EditTrainerDrawer';
import { SignedContractViewer } from '@/components/hrm/SignedContractViewer';
import { PayrollRunPanel } from '@/components/hrm/PayrollRunPanel';
import HrSettingsTab from '@/components/hrm/HrSettingsTab';
import PoliciesTab from '@/components/hrm/PoliciesTab';
import { FileBadge, BookOpen, Settings as SettingsIcon } from 'lucide-react';
import {
  Plus, 
  Users, 
  FileText, 
  DollarSign, 
  TrendingUp,
  Calendar,
  CheckCircle,
  Clock,
  Search,
  Download,
  Edit,
  Mail,
  Dumbbell,
  Printer,
  Eye,
  ExternalLink,
  Link,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchEmployees, fetchEmployeeContracts, calculatePayroll, fetchAllPayrollStaff, calculatePayrollForStaff, type PayrollStaffItem } from '@/services/hrmService';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { buildPayslipPdf, buildContractPdf, downloadBlob } from '@/utils/pdfBlob';
import { useBrandContext } from '@/lib/brand/useBrandContext';

const MONTH_VALUE_RE = /^\d{4}-\d{2}$/;

function parseDateSafe(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateSafe(value: unknown, pattern: string, fallback = '-'): string {
  const date = parseDateSafe(value);
  if (!date) return fallback;
  return format(date, pattern);
}

function getDurationHours(checkIn: unknown, checkOut: unknown): number | null {
  const inDate = parseDateSafe(checkIn);
  const outDate = parseDateSafe(checkOut);
  if (!inDate || !outDate) return null;

  const diff = (outDate.getTime() - inDate.getTime()) / 3600000;
  if (!Number.isFinite(diff) || diff < 0) return null;
  return diff;
}

function getPayrollMonthLabel(payrollMonth: string): string {
  if (!MONTH_VALUE_RE.test(payrollMonth)) {
    return format(new Date(), 'MMMM yyyy');
  }

  const [yearText, monthText] = payrollMonth.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const date = new Date(year, month - 1, 1);

  if (Number.isNaN(date.getTime())) {
    return format(new Date(), 'MMMM yyyy');
  }

  return format(date, 'MMMM yyyy');
}

export default function HRMPage() {
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const [contractDrawerOpen, setContractDrawerOpen] = useState(false);
  const [addEmployeeOpen, setAddEmployeeOpen] = useState(false);
  const [editEmployeeOpen, setEditEmployeeOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<any>(null);
  const [editTrainerOpen, setEditTrainerOpen] = useState(false);
  const [editingTrainer, setEditingTrainer] = useState<any>(null);
  const [payrollMonth, setPayrollMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [searchTerm, setSearchTerm] = useState('');
  const [signedViewerOpen, setSignedViewerOpen] = useState(false);
  const [viewingSignedContract, setViewingSignedContract] = useState<any>(null);
  const queryClient = useQueryClient();
  const { data: brandData } = useBrandContext(null);
  const brand = brandData || { companyName: 'Incline', tagline: 'Rise. Reflect. Repeat.', legalName: 'The Incline Life by Incline', website: 'theincline.in', supportEmail: 'hello@theincline.in', branch: { name: 'Incline' } };

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ['hrm-employees'],
    queryFn: () => fetchEmployees(),
  });

  // Fetch all contracts
  const { data: allContracts = [] } = useQuery({
    queryKey: ['all-contracts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contracts')
        .select(`
          *,
          employees!contracts_employee_id_fkey(id, employee_code, user_id, position, department, branch_id),
          trainers!contracts_trainer_id_fkey(id, user_id, specializations, pt_share_percentage)
        `)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;

      const userIds = Array.from(new Set(
        (data || [])
          .flatMap((c: any) => [c.employees?.user_id, c.trainers?.user_id])
          .filter(Boolean)
      ));

      let profiles: any[] = [];
      if (userIds.length > 0) {
        const { data: pr } = await supabase
          .from('profiles')
          .select('id, full_name, email, phone')
          .in('id', userIds);
        profiles = pr || [];
      }
      const findProfile = (uid?: string | null) =>
        uid ? profiles.find((p) => p.id === uid) || null : null;

      return (data || []).map((c: any) => {
        const isTrainer = !!c.trainer_id && !c.employee_id;
        const empProfile = findProfile(c.employees?.user_id);
        const trainerProfile = findProfile(c.trainers?.user_id);
        const profile = isTrainer ? trainerProfile : empProfile;
        return {
          ...c,
          trainerProfile,
          _resolvedName: profile?.full_name || null,
          _resolvedCode: c.employees?.employee_code || (isTrainer ? 'Trainer' : null),
          _resolvedEmail: profile?.email || null,
          _resolvedPhone: profile?.phone || null,
          _resolvedPosition: c.employees?.position || (isTrainer ? 'Trainer' : null),
          _resolvedDepartment: c.employees?.department || (isTrainer ? 'Training' : null),
          _isTrainer: isTrainer,
        };
      });
    },
  });

  // Fetch staff attendance for HRM tab
  const { data: staffAttendance = [] } = useQuery({
    queryKey: ['hrm-staff-attendance', payrollMonth],
    queryFn: async () => {
      if (!MONTH_VALUE_RE.test(payrollMonth)) {
        return [];
      }

      const [yearText, monthText] = payrollMonth.split('-');
      const year = Number(yearText);
      const month = Number(monthText);
      if (!Number.isFinite(year) || !Number.isFinite(month)) {
        return [];
      }

      const startDate = `${payrollMonth}-01T00:00:00`;
      const endDate = new Date(year, month, 0).toISOString();
      const { data, error } = await supabase
        .from('staff_attendance')
        .select('*')
        .gte('check_in', startDate)
        .lte('check_in', endDate)
        .order('check_in', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch unified payroll staff (employees + trainers, deduped by user_id)
  const { data: payrollStaff = [], isLoading: isLoadingStaff } = useQuery({
    queryKey: ['hrm-payroll-staff'],
    queryFn: () => fetchAllPayrollStaff(),
  });

  // Quick lookup of user_ids that ALSO hold a trainer record — used to render a
  // "Trainer" role chip on dual-role employees (the trainer row is hidden by the
  // payroll dedupe to prevent double-counting salary).
  const { data: trainerUserIds = new Set<string>() } = useQuery<Set<string>>({
    queryKey: ['hrm-trainer-user-ids'],
    queryFn: async () => {
      const { data } = await supabase.from('trainers').select('user_id').eq('is_active', true);
      return new Set((data || []).map((t: any) => t.user_id).filter(Boolean));
    },
  });

  // Payroll calculations per unified staff
  const { data: payrollData = {} } = useQuery({
    queryKey: ['hrm-payroll', payrollMonth, payrollStaff.length],
    queryFn: async () => {
      const results: Record<string, any> = {};
      for (const staff of payrollStaff) {
        try {
          const calc = await calculatePayrollForStaff(staff, payrollMonth);
          results[staff.id] = calc;
        } catch {
          results[staff.id] = { baseSalary: staff.salary || 0, proRatedPay: staff.salary || 0, ptCommission: 0, grossPay: staff.salary || 0, pfDeduction: 0, netPay: staff.salary || 0, daysPresent: 0, workingDays: 26 };
        }
      }
      return results;
    },
    enabled: payrollStaff.length > 0,
  });

  // Filter unified staff by search
  const filteredStaff = payrollStaff.filter((s: PayrollStaffItem) => {
    const term = searchTerm.toLowerCase();
    return (s.name || '').toLowerCase().includes(term) ||
      (s.code || '').toLowerCase().includes(term) ||
      (s.department || '').toLowerCase().includes(term);
  });

  // Stats from unified staff list (already deduped by user_id in fetchAllPayrollStaff:
  // a person who is both employee + trainer counts as 1 person; their PT commissions
  // are added on top of their single base salary, never doubled).
  const stats = {
    total: payrollStaff.length,
    active: payrollStaff.length, // fetchAllPayrollStaff already filters active
    totalSalary: payrollStaff.reduce((sum: number, s: PayrollStaffItem) => sum + (s.salary || 0), 0),
    activeContracts: allContracts.filter((c: any) => c.status === 'active').length,
    trainers: payrollStaff.filter((s: PayrollStaffItem) => s.staff_type === 'trainer').length,
    employees: payrollStaff.filter((s: PayrollStaffItem) => s.staff_type === 'employee').length,
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      active: 'bg-success/10 text-success border-success/20',
      draft: 'bg-muted text-muted-foreground border-border',
      pending: 'bg-warning/10 text-warning border-warning/20',
      expired: 'bg-destructive/10 text-destructive border-destructive/20',
      terminated: 'bg-destructive/10 text-destructive border-destructive/20',
    };
    return colors[status] || 'bg-muted text-muted-foreground border-border';
  };

  const getInitials = (name: string | null) => {
    if (!name) return 'E';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const getStaffTypeBadge = (staff: PayrollStaffItem) => {
    const alsoTrainer = staff.staff_type === 'employee' && staff.user_id && trainerUserIds.has(staff.user_id);
    if (staff.staff_type === 'trainer') {
      return <Badge className="border bg-info/10 text-info border-info/20"><Dumbbell className="mr-1 h-3 w-3 inline" />Trainer</Badge>;
    }
    const primary = staff.department === 'Management'
      ? <Badge className="border bg-accent/10 text-accent border-accent/20">Manager</Badge>
      : <Badge className="border bg-muted text-muted-foreground border-border">Staff</Badge>;
    return (
      <div className="flex flex-wrap gap-1">
        {primary}
        {alsoTrainer && (
          <Badge className="border bg-purple-500/10 text-purple-600 border-purple-500/30" title="Also holds a trainer record — PT commissions added on top of base salary">
            <Dumbbell className="mr-1 h-3 w-3 inline" />Trainer
          </Badge>
        )}
      </div>
    );
  };

  const openContractPdf = (contract: any) => {
    const employeeName = contract._resolvedName || 'Employee';
    const employeeCode = contract._resolvedCode || '-';
    const termsRaw = contract.terms;
    const termsString = typeof termsRaw === 'string'
      ? termsRaw
      : (termsRaw && typeof termsRaw === 'object'
          ? (typeof (termsRaw as any).conditions === 'string' ? (termsRaw as any).conditions : JSON.stringify(termsRaw, null, 2))
          : '');

    const blob = buildContractPdf({
      contract_number: contract.contract_number || contract.id,
      employee_name: employeeName,
      employee_code: employeeCode,
      position: contract._resolvedPosition || undefined,
      department: contract._resolvedDepartment || undefined,
      contract_type: String(contract.contract_type || '').replace('_', ' '),
      start_date: contract.start_date,
      end_date: contract.end_date || null,
      salary: Number(contract.base_salary || contract.salary || 0),
      salary_type: 'Monthly',
      terms: termsString,
    }, brand);
    downloadBlob(blob, `Contract-${employeeCode}.pdf`);
  };

  const createContractSignLink = async (
    contract: any,
    role: 'employee' | 'witness_1' | 'witness_2' | 'hr' = 'employee',
  ) => {
    try {
      const { data, error } = await supabase.functions.invoke('contract-signing', {
        body: { action: 'create_link', contract_id: contract.id, role },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const link = data?.sign_url as string | undefined;
      if (!link) throw new Error('No sign URL returned');

      await navigator.clipboard.writeText(link);
      const label =
        role === 'employee' ? 'Employee signing link'
        : role === 'hr' ? 'HR override link'
        : role === 'witness_1' ? 'Witness 1 link'
        : 'Witness 2 link';
      toast.success(`${label} copied to clipboard`);

      queryClient.invalidateQueries({ queryKey: ['all-contracts'] });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to generate link');
    }
  };

  // Payroll processing
  const processPayroll = useMutation({
    mutationFn: async (staffId: string) => {
      const staff = payrollStaff.find((s: PayrollStaffItem) => s.id === staffId);
      if (!staff) throw new Error('Staff not found');
      toast.success(`Payroll processed for ${staff.name}`);
    },
  });

  const processAllPayroll = useMutation({
    mutationFn: async () => {
      toast.success(`Payroll processed for ${payrollStaff.length} staff members`);
    },
  });

  // Get attendance summary per staff member
  const getStaffAttendanceSummary = (userId: string) => {
    const records = staffAttendance.filter((a: any) => a.user_id === userId);
    const totalDays = records.length;
    const totalHours = records.reduce((sum: number, a: any) => {
      const duration = getDurationHours(a.check_in, a.check_out);
      return duration !== null ? sum + duration : sum;
    }, 0);
    return { totalDays, totalHours: Math.round(totalHours * 10) / 10, records };
  };

  // Total payroll summary
  const totalPayrollSummary = Object.values(payrollData as Record<string, any>).reduce(
    (acc: any, p: any) => ({
      totalBase: acc.totalBase + (p.proRatedPay || 0),
      totalBaseSalary: acc.totalBaseSalary + (p.baseSalary || 0),
      totalCommission: acc.totalCommission + (p.ptCommission || 0),
      totalGross: acc.totalGross + (p.grossPay || 0),
      totalDeductions: acc.totalDeductions + (p.pfDeduction || 0),
      totalNet: acc.totalNet + (p.netPay || 0),
    }),
    { totalBase: 0, totalBaseSalary: 0, totalCommission: 0, totalGross: 0, totalDeductions: 0, totalNet: 0 }
  );

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Human Resources</h1>
            <p className="text-muted-foreground mt-1">Manage employees, contracts, attendance & payroll</p>
          </div>
          <Button onClick={() => setAddEmployeeOpen(true)} className="bg-accent hover:bg-accent/90">
            <Plus className="mr-2 h-4 w-4" />
            Add Employee
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="border-0 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-80">Total Staff</p>
                  <h3 className="text-3xl font-bold mt-1">{stats.total}</h3>
                  <p className="text-xs opacity-70 mt-1">
                    {stats.employees} Managers/Staff · {stats.trainers} Trainer-only
                    {(() => {
                      const dual = (payrollStaff as PayrollStaffItem[]).filter(s => s.staff_type === 'employee' && s.user_id && trainerUserIds.has(s.user_id)).length;
                      return dual > 0 ? ` · ${dual} dual-role` : '';
                    })()}
                  </p>
                </div>
                <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center">
                  <Users className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 bg-gradient-to-br from-success to-success/80 text-success-foreground">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-80">Active</p>
                  <h3 className="text-3xl font-bold mt-1">{stats.active}</h3>
                </div>
                <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center">
                  <CheckCircle className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 bg-gradient-to-br from-info to-info/80 text-info-foreground">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-80">Active Contracts</p>
                  <h3 className="text-3xl font-bold mt-1">{stats.activeContracts}</h3>
                </div>
                <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center">
                  <FileText className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 bg-gradient-to-br from-accent to-accent/80 text-accent-foreground">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-80">Monthly Payroll</p>
                  <h3 className="text-3xl font-bold mt-1">₹{stats.totalSalary.toLocaleString()}</h3>
                </div>
                <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center">
                  <DollarSign className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="employees">
          <TabsList className="bg-muted/50">
            <TabsTrigger value="employees">Employees</TabsTrigger>
            <TabsTrigger value="contracts">Contracts</TabsTrigger>
            <TabsTrigger value="attendance">Attendance</TabsTrigger>
            <TabsTrigger value="payroll">Payroll</TabsTrigger>
            <TabsTrigger value="policies"><BookOpen className="h-3.5 w-3.5 mr-1" />Policies</TabsTrigger>
            <TabsTrigger value="settings"><SettingsIcon className="h-3.5 w-3.5 mr-1" />HR Settings</TabsTrigger>
          </TabsList>

          {/* Employees Tab - NOW UNIFIED */}
          <TabsContent value="employees" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <CardTitle>All Staff ({filteredStaff.length})</CardTitle>
                  <div className="relative w-full sm:w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search staff..."
                      className="pl-10"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {isLoadingStaff ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Staff Member</TableHead>
                        <TableHead>Code</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead>Position</TableHead>
                        <TableHead>Salary</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredStaff.map((staff: PayrollStaffItem) => (
                        <TableRow key={staff.id} className="group">
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <Avatar className="h-10 w-10">
                                <AvatarFallback className="bg-accent/10 text-accent font-semibold">
                                  {getInitials(staff.name)}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="font-medium">{staff.name || 'N/A'}</p>
                                <p className="text-sm text-muted-foreground">{staff.email}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-sm">{staff.code}</span>
                          </TableCell>
                          <TableCell>{getStaffTypeBadge(staff)}</TableCell>
                          <TableCell>{staff.department || '-'}</TableCell>
                          <TableCell>{staff.position || '-'}</TableCell>
                          <TableCell className="font-semibold">
                            ₹{(staff.salary || 0).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {/* Contract button for all staff types */}
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => {
                                  if (staff.staff_type === 'trainer' && staff.trainerRecord) {
                                    setSelectedEmployee({ ...staff.trainerRecord, id: staff.source_id, staff_type: 'trainer', salary: staff.salary });
                                  } else if (staff.employeeRecord) {
                                    setSelectedEmployee(staff.employeeRecord);
                                  }
                                  setContractDrawerOpen(true);
                                }}
                              >
                                <FileText className="mr-1 h-3 w-3" />
                                Contract
                              </Button>
                              {/* Edit button */}
                              <Button 
                                size="sm" 
                                variant="ghost"
                                onClick={() => {
                                  if (staff.staff_type === 'trainer' && staff.trainerRecord) {
                                    setEditingTrainer(staff.trainerRecord);
                                    setEditTrainerOpen(true);
                                  } else if (staff.employeeRecord) {
                                    setEditingEmployee(staff.employeeRecord);
                                    setEditEmployeeOpen(true);
                                  }
                                }}
                              >
                                <Edit className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {filteredStaff.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                            <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>No staff found</p>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Contracts Tab */}
          <TabsContent value="contracts" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>All Contracts</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Start Date</TableHead>
                      <TableHead>End Date</TableHead>
                      <TableHead>Base Salary</TableHead>
                      <TableHead>Commission %</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allContracts.map((contract: any) => (
                      <TableRow key={contract.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarFallback className="bg-accent/10 text-accent text-xs">
                                {getInitials(contract._resolvedName)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium">{contract._resolvedName || 'N/A'}</p>
                              <p className="text-xs text-muted-foreground">
                                {contract._isTrainer && <Badge className="border bg-info/10 text-info border-info/20 mr-1 text-[10px] px-1 py-0">Trainer</Badge>}
                                {contract._resolvedCode}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="capitalize">{contract.contract_type.replace('_', ' ')}</TableCell>
                        <TableCell>{formatDateSafe(contract.start_date, 'dd MMM yyyy')}</TableCell>
                        <TableCell>
                          {contract.end_date 
                            ? formatDateSafe(contract.end_date, 'dd MMM yyyy') 
                            : <span className="text-muted-foreground">Ongoing</span>
                          }
                        </TableCell>
                        <TableCell className="font-semibold">₹{(contract.base_salary || contract.salary).toLocaleString()}</TableCell>
                        <TableCell>
                          {contract.commission_percentage > 0 
                            ? <Badge className="bg-accent/10 text-accent border-accent/20 border">{contract.commission_percentage}%</Badge>
                            : <span className="text-muted-foreground">-</span>
                          }
                        </TableCell>
                        <TableCell>
                          <Badge className={`border ${getStatusColor(contract.status)}`}>
                            {contract.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openContractPdf(contract)}
                              title="Preview / Print Contract"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openContractPdf(contract)}
                              title="Print or Save as PDF"
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openContractPdf(contract)}
                              title="Download Contract PDF"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                            {contract.document_url && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => window.open(contract.document_url, '_blank', 'noopener,noreferrer')}
                                title="Open uploaded contract"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {contract.signature_status === 'signed' ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="default"
                                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                                  onClick={() => {
                                    setViewingSignedContract(contract);
                                    setSignedViewerOpen(true);
                                  }}
                                  title="View signed contract"
                                >
                                  <CheckCircle className="h-3.5 w-3.5 mr-1" />
                                  View Signed
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={async () => {
                                    const t = toast.loading('Generating stamped PDF...');
                                    try {
                                      const { data, error } = await supabase.functions.invoke('contract-signing', {
                                        body: { action: 'get_pdf', contract_id: contract.id, copy: 'employee_copy' },
                                      });
                                      if (error) throw error;
                                      if (data?.error) throw new Error(data.error);
                                      if (data?.signed_url) window.open(data.signed_url, '_blank', 'noopener,noreferrer');
                                      toast.success('Stamped PDF ready', { id: t });
                                    } catch (e: any) {
                                      toast.error(e?.message || 'Failed to generate stamped PDF', { id: t });
                                    }
                                  }}
                                  title="Download stamped, branded PDF copy"
                                >
                                  <FileBadge className="h-3.5 w-3.5 mr-1" />
                                  Stamped PDF
                                </Button>
                              </>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => createContractSignLink(contract)}
                                title="Generate signing link"
                              >
                                <Link className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {allContracts.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                          <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                          <p>No contracts found</p>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Attendance Tab - NOW UNIFIED */}
          <TabsContent value="attendance" className="mt-4">
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="h-5 w-5 text-accent" />
                    Staff Attendance
                  </CardTitle>
                  <Input
                    type="month"
                    value={payrollMonth}
                    onChange={(e) => setPayrollMonth(e.target.value)}
                    className="w-[180px]"
                  />
                </div>
              </CardHeader>
              <CardContent>
                {/* Summary per unified staff */}
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 mb-6">
                  {payrollStaff.map((staff: PayrollStaffItem) => {
                    const summary = getStaffAttendanceSummary(staff.user_id);
                    return (
                      <Card key={staff.id} className="border">
                        <CardContent className="p-4">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-10 w-10">
                              <AvatarFallback className="bg-accent/10 text-accent text-sm font-semibold">
                                {getInitials(staff.name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{staff.name}</p>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">{staff.code}</span>
                                {getStaffTypeBadge(staff)}
                              </div>
                            </div>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <div className="bg-muted/50 rounded-lg p-2 text-center">
                              <p className="text-lg font-bold text-foreground">{summary.totalDays}</p>
                              <p className="text-xs text-muted-foreground">Days Present</p>
                            </div>
                            <div className="bg-muted/50 rounded-lg p-2 text-center">
                              <p className="text-lg font-bold text-foreground">{summary.totalHours}h</p>
                              <p className="text-xs text-muted-foreground">Total Hours</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                {/* Detailed log */}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Staff Member</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Check In</TableHead>
                      <TableHead>Check Out</TableHead>
                      <TableHead>Duration</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {staffAttendance.slice(0, 50).map((record: any) => {
                      const staff = payrollStaff.find((s: PayrollStaffItem) => s.user_id === record.user_id);
                      const duration = getDurationHours(record.check_in, record.check_out);
                      return (
                        <TableRow key={record.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Avatar className="h-7 w-7">
                                <AvatarFallback className="bg-accent/10 text-accent text-xs">
                                  {getInitials(staff?.name || null)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="text-sm font-medium">{staff?.name || 'Unknown'}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {staff ? getStaffTypeBadge(staff) : <span className="text-muted-foreground">-</span>}
                          </TableCell>
                          <TableCell>{formatDateSafe(record.check_in, 'dd MMM yyyy')}</TableCell>
                          <TableCell>{formatDateSafe(record.check_in, 'hh:mm a')}</TableCell>
                          <TableCell>
                            {record.check_out ? formatDateSafe(record.check_out, 'hh:mm a') : <Badge variant="outline" className="text-warning">Active</Badge>}
                          </TableCell>
                          <TableCell>{duration !== null ? `${duration.toFixed(1)}h` : '-'}</TableCell>
                        </TableRow>
                      );
                    })}
                    {staffAttendance.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                          <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                          <p>No attendance records for this month</p>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Payroll Tab */}
          <TabsContent value="payroll" className="mt-4 space-y-4">
            <PayrollRunPanel
              periodStart={`${payrollMonth}-01`}
              periodEnd={(() => {
                const [y, m] = payrollMonth.split('-').map(Number);
                return new Date(y, m, 0).toISOString().split('T')[0];
              })()}
            />
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <CardTitle>Payroll Processing</CardTitle>
                  <div className="flex items-center gap-3">
                    <Input
                      type="month"
                      value={payrollMonth}
                      onChange={(e) => setPayrollMonth(e.target.value)}
                      className="w-[180px]"
                    />
                    <Button 
                      onClick={() => processAllPayroll.mutate()}
                      disabled={processAllPayroll.isPending}
                      className="bg-accent hover:bg-accent/90"
                    >
                      <DollarSign className="mr-2 h-4 w-4" />
                      Process All
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Staff Member</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Days</TableHead>
                      <TableHead>Base Salary</TableHead>
                      <TableHead>Pro-rated</TableHead>
                      <TableHead>PT Commission</TableHead>
                      <TableHead>Gross</TableHead>
                      <TableHead>PF (12%)</TableHead>
                      <TableHead>Net Pay</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payrollStaff.map((staff: PayrollStaffItem) => {
                      const p = (payrollData as Record<string, any>)[staff.id] || {};
                      
                      return (
                        <TableRow key={staff.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <Avatar className="h-8 w-8">
                                <AvatarFallback className="bg-accent/10 text-accent text-xs">
                                  {getInitials(staff.name)}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="font-medium">{staff.name}</p>
                                <p className="text-xs text-muted-foreground">{staff.code}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>{getStaffTypeBadge(staff)}</TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <span className="font-mono text-sm">
                                {(p.payableDays ?? p.daysPresent ?? 0)}/{p.workingDays || 26}
                              </span>
                              <div className="flex flex-wrap gap-1">
                                {(p.halfDays || 0) > 0 && (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0 bg-amber-500/10 text-amber-700 border-amber-500/30">
                                    {p.halfDays} half
                                  </Badge>
                                )}
                                {(p.lateDays || 0) > 0 && (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0 bg-orange-500/10 text-orange-700 border-orange-500/30">
                                    {p.lateDays} late
                                  </Badge>
                                )}
                                {(p.missingCheckoutDays || 0) > 0 && (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0 bg-red-500/10 text-red-700 border-red-500/30">
                                    {p.missingCheckoutDays} no-out
                                  </Badge>
                                )}
                                {(p.otHours || 0) > 0 && (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0 bg-blue-500/10 text-blue-700 border-blue-500/30">
                                    +{Math.round(p.otHours)}h OT
                                  </Badge>
                                )}
                                {(p.leaveDays || 0) > 0 && (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0 bg-violet-500/10 text-violet-700 border-violet-500/30">
                                    {p.leaveDays} leave
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">₹{(staff.salary || 0).toLocaleString()}</TableCell>
                          <TableCell>₹{(p.proRatedPay || 0).toLocaleString()}</TableCell>
                          <TableCell>
                            {(p.ptCommission || 0) > 0 
                              ? <span className="text-success font-medium">+₹{p.ptCommission.toLocaleString()}</span>
                              : <span className="text-muted-foreground">-</span>
                            }
                          </TableCell>
                          <TableCell className="font-semibold">₹{(p.grossPay || 0).toLocaleString()}</TableCell>
                          <TableCell className="text-destructive">-₹{(p.pfDeduction || 0).toLocaleString()}</TableCell>
                          <TableCell className="font-semibold text-success">₹{(p.netPay || 0).toLocaleString()}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => {
                                  toast.success(`Payroll processed for ${staff.name}`);
                                }}
                              >
                                <CheckCircle className="mr-1 h-3 w-3" />
                                Process
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  const blob = buildPayslipPdf({
                                    employee_name: staff.name,
                                    employee_code: staff.code,
                                    designation: staff.position,
                                    period_label: getPayrollMonthLabel(payrollMonth),
                                    period_start: `${payrollMonth}-01`,
                                    period_end: `${payrollMonth}-${String(p.workingDays || 28).padStart(2,'0')}`,
                                    attendance: {
                                      present: p.daysPresent ?? 0,
                                      half_day: p.halfDays ?? 0,
                                      late: p.lateDays ?? 0,
                                      missing_checkout: p.missingCheckoutDays ?? 0,
                                      leave: p.leaveDays ?? 0,
                                      holiday: p.holidayDays ?? 0,
                                      weekly_off: p.weeklyOffDays ?? 0,
                                      absent: 0,
                                      payable_days: p.payableDays ?? 0,
                                      total_days: p.workingDays ?? 0,
                                      monthly_salary: staff.salary || 0,
                                    },
                                    earnings: { base: p.proRatedPay || 0, pt_commission: p.ptCommission || 0, ot: 0, bonus: 0 },
                                    deductions: { deductions: p.pfDeduction || 0, advance: 0, penalty: 0 },
                                    gross: p.grossPay || 0,
                                    net: p.netPay || 0,
                                  }, brand);
                                  downloadBlob(blob, `Payslip_${staff.code}_${payrollMonth}.pdf`);
                                  toast.success('Payslip downloaded');
                                }}
                                title="Download Payslip"
                              >
                                <Download className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => toast.info('Email payslip feature coming soon')}
                                title="Send Payslip via Email"
                              >
                                <Mail className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {payrollStaff.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                          <DollarSign className="h-12 w-12 mx-auto mb-4 opacity-50" />
                          <p>No active staff for payroll</p>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>

                {/* Payroll Summary */}
                <div className="mt-6 p-4 rounded-lg bg-muted/50">
                  <h4 className="font-semibold mb-3">Payroll Summary - {getPayrollMonthLabel(payrollMonth)}</h4>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Pro-rated Base</p>
                      <p className="text-lg font-bold">₹{Math.round(totalPayrollSummary.totalBase).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">PT Commission</p>
                      <p className="text-lg font-bold text-success">
                        +₹{Math.round(totalPayrollSummary.totalCommission).toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Gross Pay</p>
                      <p className="text-lg font-bold">₹{Math.round(totalPayrollSummary.totalGross).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Total Deductions</p>
                      <p className="text-lg font-bold text-destructive">
                        -₹{Math.round(totalPayrollSummary.totalDeductions).toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Net Payable</p>
                      <p className="text-lg font-bold text-success">
                        ₹{Math.round(totalPayrollSummary.totalNet).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Policies Tab */}
          <TabsContent value="policies" className="mt-4">
            <PoliciesTab />
          </TabsContent>

          {/* HR Settings Tab */}
          <TabsContent value="settings" className="mt-4">
            <HrSettingsTab />
          </TabsContent>
        </Tabs>
      </div>

      {/* Contract Drawer */}
      <CreateContractDrawer
        open={contractDrawerOpen}
        onOpenChange={setContractDrawerOpen}
        employee={selectedEmployee}
      />

      {/* Add Employee Drawer */}
      <AddEmployeeDrawer
        open={addEmployeeOpen}
        onOpenChange={setAddEmployeeOpen}
      />

      {/* Edit Employee Drawer */}
      <EditEmployeeDrawer
        open={editEmployeeOpen}
        onOpenChange={setEditEmployeeOpen}
        employee={editingEmployee}
      />

      {/* Edit Trainer Drawer */}
      <EditTrainerDrawer
        open={editTrainerOpen}
        onOpenChange={setEditTrainerOpen}
        trainer={editingTrainer}
      />

      {/* Signed Contract Viewer */}
      <SignedContractViewer
        open={signedViewerOpen}
        onOpenChange={setSignedViewerOpen}
        contract={viewingSignedContract}
      />
    </AppLayout>
  );
}
