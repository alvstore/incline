import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Validation constants
const MAX_EMAIL_LENGTH = 255;
const MAX_NAME_LENGTH = 100;
const MAX_PHONE_LENGTH = 20;
const MAX_BIO_LENGTH = 1000;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+?[0-9\s\-\(\)]{10,20}$/;
const ALLOWED_ROLES = ['trainer', 'staff', 'manager', 'admin', 'owner'];
const ALLOWED_SALARY_TYPES = ['hourly', 'monthly', 'fixed', 'commission'];
const ALLOWED_ID_TYPES = ['aadhaar', 'pan', 'passport', 'driving_license', 'voter_id'];

// Sanitize string input
function sanitizeString(str: string | undefined | null, maxLength: number): string {
  if (!str) return '';
  return str
    .toString()
    .trim()
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .slice(0, maxLength);
}

// Validate email
function validateEmail(email: string): { valid: boolean; error?: string } {
  if (!email) return { valid: false, error: 'Email is required' };
  if (email.length > MAX_EMAIL_LENGTH) return { valid: false, error: 'Email is too long' };
  if (!EMAIL_REGEX.test(email)) return { valid: false, error: 'Invalid email format' };
  return { valid: true };
}

// Validate UUID
function isValidUUID(value: string): boolean {
  return UUID_REGEX.test(value);
}

// Validate phone (optional)
function validatePhone(phone: string | undefined): { valid: boolean; error?: string } {
  if (!phone) return { valid: true };
  if (!PHONE_REGEX.test(phone)) return { valid: false, error: 'Invalid phone number format' };
  return { valid: true };
}

// Validate role
function validateRole(role: string): { valid: boolean; error?: string } {
  if (!role) return { valid: false, error: 'Role is required' };
  if (!ALLOWED_ROLES.includes(role)) {
    return { valid: false, error: `Valid role is required (${ALLOWED_ROLES.join(', ')})` };
  }
  return { valid: true };
}

// Validate numeric fields
function validateNumeric(value: unknown, fieldName: string, min?: number, max?: number): { valid: boolean; error?: string; value?: number } {
  if (value === undefined || value === null || value === '') return { valid: true };
  const num = Number(value);
  if (isNaN(num)) return { valid: false, error: `${fieldName} must be a number` };
  if (min !== undefined && num < min) return { valid: false, error: `${fieldName} must be at least ${min}` };
  if (max !== undefined && num > max) return { valid: false, error: `${fieldName} must be at most ${max}` };
  return { valid: true, value: num };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Check request size
    const contentLength = parseInt(req.headers.get('content-length') || '0');
    if (contentLength > 51200) { // 50KB max
      return new Response(
        JSON.stringify({ error: 'Request too large' }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      console.log('No authorization header provided')
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Verify the calling user is admin/owner
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user: callingUser }, error: authError } = await supabaseClient.auth.getUser()
    if (authError || !callingUser) {
      console.log('Auth error:', authError)
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if calling user has admin/owner/manager role
    const { data: callerRoles } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', callingUser.id)
      .in('role', ['owner', 'admin', 'manager'])

    if (!callerRoles || callerRoles.length === 0) {
      console.log('Insufficient permissions for user:', callingUser.id)
      return new Response(
        JSON.stringify({ error: 'Insufficient permissions' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const body = await req.json()
    
    // Sanitize and extract inputs
    const email = sanitizeString(body.email, MAX_EMAIL_LENGTH);
    const fullName = sanitizeString(body.fullName || body.full_name, MAX_NAME_LENGTH);
    const phone = sanitizeString(body.phone, MAX_PHONE_LENGTH);
    const role = sanitizeString(body.role, 20).toLowerCase();
    const branchId = sanitizeString(body.branchId || body.branch_id, 36);
    const gender = sanitizeString(body.gender, 10);
    const dateOfBirth = sanitizeString(body.dateOfBirth || body.date_of_birth, 10);
    const address = sanitizeString(body.address, 500);
    const city = sanitizeString(body.city, 100);
    const state = sanitizeString(body.state, 100);
    const postalCode = sanitizeString(body.postalCode || body.postal_code, 20);
    const emergencyContactName = sanitizeString(body.emergencyContactName || body.emergency_contact_name, MAX_NAME_LENGTH);
    const emergencyContactPhone = sanitizeString(body.emergencyContactPhone || body.emergency_contact_phone, MAX_PHONE_LENGTH);
    const bio = sanitizeString(body.bio, MAX_BIO_LENGTH);

    // Trainer-specific fields
    const salaryType = sanitizeString(body.salaryType || body.salary_type, 20);
    const fixedSalary = body.fixedSalary || body.fixed_salary;
    const hourlyRate = body.hourlyRate || body.hourly_rate;
    const ptSharePercentage = body.ptSharePercentage || body.pt_share_percentage;
    const maxClients = body.maxClients || body.max_clients;
    const governmentIdType = sanitizeString(body.governmentIdType || body.government_id_type, 20);
    const governmentIdNumber = sanitizeString(body.governmentIdNumber || body.government_id_number, 50);
    const specializations = Array.isArray(body.specializations)
      ? body.specializations.slice(0, 20).map((s: unknown) => sanitizeString(String(s), 50)).filter(Boolean)
      : [];
    const certifications = Array.isArray(body.certifications)
      ? body.certifications.slice(0, 20).map((s: unknown) => sanitizeString(String(s), 100)).filter(Boolean)
      : [];

    // Validate required fields
    const emailValidation = validateEmail(email);
    if (!emailValidation.valid) {
      return new Response(
        JSON.stringify({ error: emailValidation.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const roleValidation = validateRole(role);
    if (!roleValidation.valid) {
      return new Response(
        JSON.stringify({ error: roleValidation.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!branchId || !isValidUUID(branchId)) {
      return new Response(
        JSON.stringify({ error: 'Valid Branch ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify branch exists
    const { data: branchExists } = await supabaseAdmin
      .from('branches')
      .select('id')
      .eq('id', branchId)
      .single();

    if (!branchExists) {
      return new Response(
        JSON.stringify({ error: 'Branch not found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const phoneValidation = validatePhone(phone);
    if (!phoneValidation.valid) {
      return new Response(
        JSON.stringify({ error: phoneValidation.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate numeric fields for trainers
    if (role === 'trainer') {
      if (salaryType && !ALLOWED_SALARY_TYPES.includes(salaryType)) {
        return new Response(
          JSON.stringify({ error: `Invalid salary type. Allowed: ${ALLOWED_SALARY_TYPES.join(', ')}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const fixedSalaryValidation = validateNumeric(fixedSalary, 'Fixed salary', 0, 10000000);
      if (!fixedSalaryValidation.valid) {
        return new Response(
          JSON.stringify({ error: fixedSalaryValidation.error }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const hourlyRateValidation = validateNumeric(hourlyRate, 'Hourly rate', 0, 100000);
      if (!hourlyRateValidation.valid) {
        return new Response(
          JSON.stringify({ error: hourlyRateValidation.error }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const ptShareValidation = validateNumeric(ptSharePercentage, 'PT share percentage', 0, 100);
      if (!ptShareValidation.valid) {
        return new Response(
          JSON.stringify({ error: ptShareValidation.error }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (governmentIdType && !ALLOWED_ID_TYPES.includes(governmentIdType)) {
        return new Response(
          JSON.stringify({ error: `Invalid ID type. Allowed: ${ALLOWED_ID_TYPES.join(', ')}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Use admin-supplied password if provided (min 8 chars), else auto-generate
    const suppliedPassword = typeof body.password === 'string' ? body.password.trim() : '';
    if (suppliedPassword && suppliedPassword.length < 8) {
      return new Response(
        JSON.stringify({ error: 'Password must be at least 8 characters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    // Fixed default password for all staff/trainer/manager users — they must change it on first login.
    const tempPassword = suppliedPassword || 'Incline@123'
    console.log('Creating user with email:', email)

    // Create the user with email confirmed (they'll set password on first login)
    const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: fullName }
    })

    if (createError) {
      console.log('User creation error:', createError.message)
      throw createError
    }

    console.log('User created successfully:', authData.user.id)

    // Update profile with additional fields
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({
        full_name: fullName,
        phone: phone || null,
        gender: gender || null,
        date_of_birth: dateOfBirth || null,
        address: address || null,
        city: city || null,
        state: state || null,
        postal_code: postalCode || null,
        emergency_contact_name: emergencyContactName || null,
        emergency_contact_phone: emergencyContactPhone || null,
        must_set_password: true,
      })
      .eq('id', authData.user.id)

    if (profileError) {
      console.log('Profile update error:', profileError.message)
    }

    // Assign role
    const { error: roleError } = await supabaseAdmin
      .from('user_roles')
      .insert({ user_id: authData.user.id, role })

    if (roleError) {
      console.log('Role assignment error:', roleError.message)
      throw roleError
    }

    // Assign to branch
    const { error: branchError } = await supabaseAdmin
      .from('staff_branches')
      .insert({ user_id: authData.user.id, branch_id: branchId })

    if (branchError) {
      console.log('Branch assignment error:', branchError.message)
      // Don't throw - this might fail if table doesn't exist
    }

    // If role is trainer, create trainer record
    let trainerId = null
    if (role === 'trainer') {
      const trainerCode = 'TR-' + Date.now().toString(36).toUpperCase()
      const { data: trainerData, error: trainerError } = await supabaseAdmin
        .from('trainers')
        .insert({
          user_id: authData.user.id,
          branch_id: branchId,
          specializations: specializations,
          salary_type: salaryType || 'hourly',
          fixed_salary: fixedSalary || null,
          hourly_rate: hourlyRate || null,
          pt_share_percentage: ptSharePercentage || 40,
          government_id_type: governmentIdType || null,
          government_id_number: governmentIdNumber || null,
          is_active: true,
        })
        .select('id')
        .single()

      if (trainerError) {
        console.log('Trainer creation error:', trainerError.message)
        throw trainerError
      }
      trainerId = trainerData?.id
      console.log('Trainer created with ID:', trainerId)
    }

    // Extract employee-specific fields from request body
    const department = sanitizeString(body.department, 50);
    const position = sanitizeString(body.position, 50);
    const salary = body.salary !== undefined ? Number(body.salary) || 0 : 0;
    const empSalaryType = sanitizeString(body.salary_type || body.salaryType, 20);
    const bankName = sanitizeString(body.bank_name || body.bankName, 100);
    const bankAccount = sanitizeString(body.bank_account || body.bankAccount, 50);
    const taxId = sanitizeString(body.tax_id || body.taxId, 50);

    // If role is staff or manager, create employee record
    let employeeId = null
    if (role === 'staff' || role === 'manager') {
      const employeeCode = 'EMP-' + Date.now().toString(36).toUpperCase()
      const { data: employeeData, error: employeeError } = await supabaseAdmin
        .from('employees')
        .insert({
          user_id: authData.user.id,
          branch_id: branchId,
          employee_code: employeeCode,
          hire_date: new Date().toISOString().split('T')[0],
          position: position || (role === 'manager' ? 'Branch Manager' : 'Staff'),
          department: department || null,
          salary: salary,
          salary_type: empSalaryType || 'monthly',
          bank_name: bankName || null,
          bank_account: bankAccount || null,
          tax_id: taxId || null,
          is_active: true,
        })
        .select('id')
        .single()

      if (employeeError) {
        console.log('Employee creation error:', employeeError.message)
        // Don't throw - trainer/employee creation is secondary
      } else {
        employeeId = employeeData?.id
        console.log('Employee created with ID:', employeeId)
      }

      // If role is manager, also insert into branch_managers
      if (role === 'manager') {
        const { error: bmError } = await supabaseAdmin
          .from('branch_managers')
          .insert({
            user_id: authData.user.id,
            branch_id: branchId,
            is_primary: true,
          })
        if (bmError) {
          console.log('Branch manager assignment error:', bmError.message)
        } else {
          console.log('Branch manager assignment created for branch:', branchId)
        }
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        userId: authData.user.id,
        trainerId,
        employeeId,
        tempPassword,
        message: `${role} user created successfully. They will set their password on first login.`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Error in create-staff-user function:', message)
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})