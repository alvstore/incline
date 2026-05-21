import { supabase } from '@/integrations/supabase/client';

export interface Employee {
  id: string;
  user_id: string;
  branch_id: string;
  employee_code: string;
  department: string | null;
  position: string | null;
  hire_date: string;
  salary: number | null;
  salary_type: string | null;
  bank_name: string | null;
  bank_account: string | null;
  tax_id: string | null;
  is_active: boolean | null;
  created_at: string;
}

export interface Contract {
  id: string;
  employee_id: string;
  trainer_id?: string;
  contract_type: string;
  start_date: string;
  end_date: string | null;
  salary: number;
  base_salary: number;
  commission_percentage: number;
  terms: any;
  document_url: string | null;
  status: 'draft' | 'pending' | 'active' | 'expired' | 'terminated';
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export async function fetchEmployees(branchId?: string) {
  let query = supabase
    .from('employees')
    .select('*')
    .order('created_at', { ascending: false });

  if (branchId) {
    query = query.eq('branch_id', branchId);
  }

  const { data, error } = await query;
  if (error) throw error;

  const userIds = data?.map(e => e.user_id).filter(Boolean) || [];
  let profiles: any[] = [];
  
  if (userIds.length > 0) {
    const { data: profileData } = await supabase
      .from('profiles')
      .select('id, full_name, email, phone, avatar_url, gender, date_of_birth, address, city, state, postal_code, emergency_contact_name, emergency_contact_phone, government_id_type, government_id_number')
      .in('id', userIds);
    profiles = profileData || [];
  }

  return data?.map(emp => ({
    ...emp,
    profile: profiles.find(p => p.id === emp.user_id) || null
  })) || [];
}

export async function getEmployee(id: string) {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;

  let profile = null;
  if (data?.user_id) {
    const { data: profileData } = await supabase
      .from('profiles')
      .select('id, full_name, email, phone, avatar_url, gender, date_of_birth, address, city, state, postal_code, emergency_contact_name, emergency_contact_phone, government_id_type, government_id_number')
      .eq('id', data.user_id)
      .single();
    profile = profileData;
  }

  return { ...data, profile };
}

export async function createEmployee(employee: {
  userId: string;
  branchId: string;
  department?: string;
  position?: string;
  hireDate: string;
  salary?: number;
  salaryType?: string;
}) {
  const { count } = await supabase
    .from('employees')
    .select('*', { count: 'exact', head: true })
    .eq('branch_id', employee.branchId);

  const employeeCode = `EMP-${String((count || 0) + 1).padStart(4, '0')}`;

  const { data, error } = await supabase
    .from('employees')
    .insert({
      user_id: employee.userId,
      branch_id: employee.branchId,
      employee_code: employeeCode,
      department: employee.department,
      position: employee.position,
      hire_date: employee.hireDate,
      salary: employee.salary,
      salary_type: employee.salaryType,
      is_active: true,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateEmployee(id: string, updates: Partial<Employee>) {
  const { data, error } = await supabase
    .from('employees')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function fetchEmployeeContracts(employeeId: string) {
  const { data, error } = await supabase
    .from('contracts')
    .select('*')
    .eq('employee_id', employeeId)
    .order('start_date', { ascending: false });

  if (error) throw error;
  return data as Contract[];
}

export async function createContract(contract: {
  employeeId?: string;
  trainerId?: string;
  branchId?: string;
  contractType: string;
  startDate: string;
  endDate?: string;
  salary: number;
  baseSalary?: number;
  commissionPercentage?: number;
  terms?: any;
  documentUrl?: string;
}) {
  const { data, error } = await supabase
    .from('contracts')
    .insert({
      employee_id: contract.employeeId || null,
      trainer_id: contract.trainerId || null,
      branch_id: contract.branchId || null,
      contract_type: contract.contractType,
      start_date: contract.startDate,
      end_date: contract.endDate,
      salary: contract.salary,
      base_salary: contract.baseSalary || contract.salary,
      commission_percentage: contract.commissionPercentage || 0,
      terms: contract.terms,
      document_url: contract.documentUrl || null,
      status: 'draft',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function approveContract(contractId: string, approvedBy: string) {
  const { data, error } = await supabase
    .from('contracts')
    .update({
      status: 'active',
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
    })
    .eq('id', contractId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function cancelContract(contractId: string) {
  const { data, error } = await supabase
    .from('contracts')
    .update({ status: 'cancelled' })
    .eq('id', contractId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function fetchEmployeeAttendance(employeeId: string, startDate?: string, endDate?: string) {
  const { data: employee } = await supabase
    .from('employees')
    .select('user_id')
    .eq('id', employeeId)
    .single();

  if (!employee) throw new Error('Employee not found');

  let query = supabase
    .from('staff_attendance')
    .select('*')
    .eq('user_id', employee.user_id)
    .order('check_in', { ascending: false });

  if (startDate) query = query.gte('check_in', startDate);
  if (endDate) query = query.lte('check_in', endDate);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export interface PayrollStaffItem {
  id: string;
  user_id: string;
  code: string;
  name: string;
  email: string | null;
  department: string | null;
  position: string | null;
  salary: number;
  staff_type: 'employee' | 'trainer';
  source_id: string; // original employee or trainer id
  is_active: boolean;
  avatar_url: string | null;
  employeeRecord?: any; // raw employee record for contract/edit actions
  trainerRecord?: any; // raw trainer record for contract/edit actions
}

export function getDaysInMonth(month: string): number {
  const [year, m] = month.split('-').map(Number);
  return new Date(year, m, 0).getDate();
}

// Keep old name as alias for backward compatibility
export const getWorkingDaysInMonth = (month: string, _includeSundays?: boolean, _weeklyOffDay?: number) => getDaysInMonth(month);

export async function fetchAllPayrollStaff(branchId?: string): Promise<PayrollStaffItem[]> {
  // Fetch employees
  let empQuery = supabase.from('employees').select('*').eq('is_active', true);
  if (branchId) empQuery = empQuery.eq('branch_id', branchId);
  const { data: emps } = await empQuery;

  // Fetch trainers
  let trainerQuery = supabase.from('trainers').select('*').eq('is_active', true);
  if (branchId) trainerQuery = trainerQuery.eq('branch_id', branchId);
  const { data: trainers } = await trainerQuery;

  // Collect all user_ids for profile lookup
  const allUserIds = [
    ...(emps?.map(e => e.user_id) || []),
    ...(trainers?.map(t => t.user_id) || []),
  ].filter(Boolean);

  let profiles: any[] = [];
  if (allUserIds.length > 0) {
    const { data: pData } = await supabase
      .from('profiles')
      .select('id, full_name, email, phone, avatar_url, gender, date_of_birth, address, city, state, postal_code, emergency_contact_name, emergency_contact_phone, government_id_type, government_id_number')
      .in('id', allUserIds);
    profiles = pData || [];
  }

  const getProfile = (uid: string) => profiles.find(p => p.id === uid);

  // Track employee user_ids to avoid duplicating trainers who also have employee records
  const empUserIds = new Set(emps?.map(e => e.user_id) || []);

  const staffList: PayrollStaffItem[] = [
    ...(emps || []).map(emp => {
      const p = getProfile(emp.user_id);
      return {
        id: `emp-${emp.id}`,
        user_id: emp.user_id,
        code: emp.employee_code,
        name: p?.full_name || 'N/A',
        email: p?.email || null,
        department: emp.department,
        position: emp.position,
        salary: emp.salary || 0,
        staff_type: 'employee' as const,
        source_id: emp.id,
        is_active: emp.is_active ?? true,
        avatar_url: p?.avatar_url || null,
        employeeRecord: { ...emp, profile: p },
      };
    }),
    ...(trainers || []).filter(t => !empUserIds.has(t.user_id)).map(t => {
      const p = getProfile(t.user_id);
      return {
        id: `trainer-${t.id}`,
        user_id: t.user_id,
        code: (t as any).trainer_code || `TR-${t.id.slice(0, 6).toUpperCase()}`,
        name: p?.full_name || 'N/A',
        email: p?.email || null,
        department: 'Training',
        position: (t as any).specialization || 'Trainer',
        salary: (t as any).fixed_salary || 0,
        staff_type: 'trainer' as const,
        source_id: t.id,
        is_active: t.is_active ?? true,
        avatar_url: p?.avatar_url || null,
        trainerRecord: { ...t, profile: p, profile_name: p?.full_name, profile_avatar: p?.avatar_url },
      };
    }),
  ];

  return staffList;
}

export async function calculatePayrollForStaff(staff: PayrollStaffItem, month: string, _includeSundays: boolean = false) {
  const startDate = `${month}-01`;
  const endDate = new Date(parseInt(month.split('-')[0]), parseInt(month.split('-')[1]), 0).toISOString().split('T')[0];

  // --- Authoritative per-day breakdown via the new compute_payroll RPC.
  // It accounts for shifts, late/early-out, half-day, missing checkout,
  // weekly off, holidays, approved leave and OT — collapsing duplicate
  // attendance rows. We still gracefully fall back to a simple count if
  // the RPC fails for any reason (e.g. brand-new env).
  let payableDays = 0;
  let halfDays = 0;
  let lateDays = 0;
  let earlyOutDays = 0;
  let missingCheckoutDays = 0;
  let otHours = 0;
  let leaveDays = 0;
  let holidayDays = 0;
  let weeklyOffDays = 0;
  let dailyBreakdown: Array<Record<string, unknown>> = [];

  try {
    const { data: payrollRows, error: rpcError } = await supabase.rpc('compute_payroll', {
      p_user_id: staff.user_id,
      p_period_start: startDate,
      p_period_end: endDate,
    });
    if (rpcError) throw rpcError;
    const rows = (payrollRows ?? []) as Array<any>;
    dailyBreakdown = rows;
    for (const r of rows) {
      if (r.payable) payableDays += r.is_half_day ? 0.5 : 1;
      if (r.is_half_day) halfDays += 1;
      if (r.is_late) lateDays += 1;
      if (r.is_early_out) earlyOutDays += 1;
      if (r.is_missing_checkout) missingCheckoutDays += 1;
      if (r.ot_hours) otHours += Number(r.ot_hours) || 0;
      if (r.leave_type) leaveDays += 1;
      if (r.is_holiday) holidayDays += 1;
      if (r.is_weekly_off) weeklyOffDays += 1;
    }
  } catch (e) {
    // Fallback: legacy attendance count
    const { data: attendance } = await supabase
      .from('staff_attendance')
      .select('id')
      .eq('user_id', staff.user_id)
      .gte('check_in', `${startDate}T00:00:00`)
      .lte('check_in', `${endDate}T23:59:59`);
    payableDays = attendance?.length || 0;
  }

  const workingDays = getDaysInMonth(month);
  const baseSalary = staff.salary || 0;
  // Pro-rate by payable days (compute_payroll already handles half-days as 0.5)
  const proRatedPay = Math.round((baseSalary / workingDays) * payableDays);

  // Fetch PT commissions (unchanged)
  let ptCommission = 0;
  if (staff.staff_type === 'trainer') {
    const { data: commissions } = await supabase
      .from('trainer_commissions')
      .select('amount')
      .eq('trainer_id', staff.source_id)
      .gte('release_date', startDate)
      .lte('release_date', endDate);
    ptCommission = commissions?.reduce((s, c) => s + (c.amount || 0), 0) || 0;
  } else {
    const { data: trainerLink } = await supabase
      .from('trainers')
      .select('id')
      .eq('user_id', staff.user_id)
      .maybeSingle();
    if (trainerLink) {
      const { data: commissions } = await supabase
        .from('trainer_commissions')
        .select('amount')
        .eq('trainer_id', trainerLink.id)
        .gte('release_date', startDate)
        .lte('release_date', endDate);
      ptCommission = commissions?.reduce((s, c) => s + (c.amount || 0), 0) || 0;
    }
  }

  const grossPay = proRatedPay + ptCommission;
  const pfDeduction = Math.round(proRatedPay * 0.12);
  const netPay = grossPay - pfDeduction;

  return {
    staffId: staff.id,
    month,
    baseSalary,
    // Existing keys preserved for back-compat with current UI
    daysPresent: Math.floor(payableDays),
    workingDays,
    proRatedPay,
    ptCommission,
    grossPay,
    pfDeduction,
    netPay,
    // New, richer fields from compute_payroll
    payableDays,
    halfDays,
    lateDays,
    earlyOutDays,
    missingCheckoutDays,
    otHours,
    leaveDays,
    holidayDays,
    weeklyOffDays,
    dailyBreakdown,
  };
}

export async function calculatePayroll(employeeId: string, month: string) {
  const employee = await getEmployee(employeeId);
  if (!employee) throw new Error('Employee not found');

  const startDate = `${month}-01`;
  const endDate = new Date(parseInt(month.split('-')[0]), parseInt(month.split('-')[1]), 0).toISOString().split('T')[0];

  const attendance = await fetchEmployeeAttendance(employeeId, startDate, endDate);
  
  const workingDays = getDaysInMonth(month);
  const daysPresent = attendance.length;
  const baseSalary = employee.salary || 0;
  const proRatedPay = Math.round((baseSalary / workingDays) * daysPresent);

  let ptCommission = 0;
  const { data: trainerLink } = await supabase
    .from('trainers')
    .select('id, pt_share_percentage')
    .eq('user_id', employee.user_id)
    .maybeSingle();
  
  if (trainerLink) {
    const { data: commissions } = await supabase
      .from('trainer_commissions')
      .select('amount')
      .eq('trainer_id', trainerLink.id)
      .gte('release_date', startDate)
      .lte('release_date', endDate);
    ptCommission = commissions?.reduce((s, c) => s + (c.amount || 0), 0) || 0;
  }

  const grossPay = proRatedPay + ptCommission;
  const pfDeduction = Math.round(proRatedPay * 0.12);
  const netPay = grossPay - pfDeduction;

  return {
    employee,
    month,
    baseSalary,
    daysPresent,
    workingDays,
    proRatedPay,
    ptCommission,
    grossPay,
    pfDeduction,
    netPay,
  };
}
