import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Verify the calling user is admin/owner/manager/staff
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user: callingUser }, error: authError } = await supabaseClient.auth.getUser()
    if (authError || !callingUser) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if calling user has permission to create members
    const { data: callerRoles } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', callingUser.id)
      .in('role', ['owner', 'admin', 'manager', 'staff'])

    if (!callerRoles || callerRoles.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Insufficient permissions' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Tag admin client with actor identity so audit trigger records real user
    const { data: actorProf } = await supabaseAdmin
      .from('profiles').select('full_name').eq('id', callingUser.id).maybeSingle()
    const actorName = (actorProf?.full_name as string | undefined) || callingUser.email || null
    supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { global: { headers: {
        'x-actor-id': callingUser.id,
        ...(actorName ? { 'x-actor-name': actorName } : {}),
        'x-actor-source': 'create-member-user',
      } } }
    )

    const body = await req.json();
    const { 
      email, 
      fullName, 
      phone, 
      branchId,
      gender,
      dateOfBirth,
      address,
      emergencyContactName,
      emergencyContactPhone,
      source,
      fitnessGoals,
      healthConditions,
      referredBy,
      createdBy,
      avatarUrl,
      governmentIdType,
      governmentIdNumber,
      dietaryPreference,
      cuisinePreference,
      allergies,
      fitnessLevel,
      activityLevel,
      equipmentAvailability,
      injuriesLimitations,
      password: suppliedPasswordRaw,
    } = body;
    const suppliedPassword = typeof suppliedPasswordRaw === 'string' ? suppliedPasswordRaw.trim() : '';
    if (suppliedPassword && suppliedPassword.length < 8) {
      return new Response(
        JSON.stringify({ error: 'Password must be at least 8 characters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!email || !fullName || !branchId) {
      return new Response(
        JSON.stringify({ error: 'Email, fullName, and branchId are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if user with this email already exists
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers()
    const existingUser = existingUsers?.users?.find(
      (u: any) => u.email?.toLowerCase() === email.toLowerCase()
    )

    let userId: string
    let createdTempPassword: string | null = null

    if (existingUser) {
      // Check if a member record already exists for this auth user
      const { data: existingMember } = await supabaseAdmin
        .from('members')
        .select('id')
        .eq('user_id', existingUser.id)
        .maybeSingle()

      if (existingMember) {
        return new Response(
          JSON.stringify({ error: 'A member with this email already exists', code: 'email_exists' }),
          { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Orphaned auth user (no member record) -- reuse it
      console.log('Reusing orphaned auth user:', existingUser.id)
      userId = existingUser.id

      // Update their profile (include avatar if provided)
      await supabaseAdmin
        .from('profiles')
        .update({
          full_name: fullName,
          phone: phone || null,
          gender: gender || null,
          date_of_birth: dateOfBirth || null,
          address: address || null,
          emergency_contact_name: emergencyContactName || null,
          emergency_contact_phone: emergencyContactPhone || null,
          must_set_password: true,
          ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
        })
        .eq('id', userId)

      // Ensure member role exists
      await supabaseAdmin
        .from('user_roles')
        .upsert(
          { user_id: userId, role: 'member' },
          { onConflict: 'user_id,role' }
        )

      // If admin supplied a password, reset it on the orphan auth user too
      if (suppliedPassword) {
        await supabaseAdmin.auth.admin.updateUserById(userId, { password: suppliedPassword })
        createdTempPassword = suppliedPassword
      }

    } else {
      // Create new auth user
      // Fixed default password for all new members — must_set_password forces a change on first login.
      const tempPassword = suppliedPassword || 'Incline@123'
      createdTempPassword = tempPassword

      const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      })

      if (createError) {
        console.error('Auth create error:', createError)
        throw createError
      }

      console.log('User created:', authData.user.id)
      userId = authData.user.id

      // Update profile with all details (include avatar if provided)
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .update({
          full_name: fullName,
          phone: phone || null,
          gender: gender || null,
          date_of_birth: dateOfBirth || null,
          address: address || null,
          emergency_contact_name: emergencyContactName || null,
          emergency_contact_phone: emergencyContactPhone || null,
          must_set_password: true,
          ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
        })
        .eq('id', userId)

      if (profileError) {
        console.error('Profile update error:', profileError)
      }

      // Assign member role
      const { error: roleError } = await supabaseAdmin
        .from('user_roles')
        .insert({ user_id: userId, role: 'member' })

      if (roleError) {
        console.error('Role insert error:', roleError)
        throw roleError
      }
    }

    // Route through the authoritative onboard_member RPC. It atomically:
    //  - Creates the member row (DB trigger generates member_code)
    //  - Updates profile with sanitized fields
    //  - Creates/updates the referral record in the correct lifecycle state
    //    ('joined' — NOT 'converted'). Conversion only happens on a qualifying
    //    purchase, via purchase_member_membership / settle_payment.
    //  - Logs the lifecycle event and evaluates access state.
    const { data: onboardResult, error: onboardError } = await supabaseAdmin.rpc('onboard_member', {
      p_user_id: userId,
      p_branch_id: branchId,
      p_full_name: fullName,
      p_email: email,
      p_phone: phone || null,
      p_source: source || 'walk-in',
      p_fitness_goals: fitnessGoals || null,
      p_health_conditions: healthConditions || null,
      p_referred_by: referredBy || null,
      p_created_by: createdBy || callingUser.id,
      p_avatar_storage_path: null,
      p_government_id_type: governmentIdType || null,
      p_government_id_number: governmentIdNumber || null,
      p_dietary_preference: dietaryPreference || null,
      p_cuisine_preference: cuisinePreference || null,
      p_allergies: Array.isArray(allergies) ? allergies : null,
      p_fitness_level: fitnessLevel || null,
      p_activity_level: activityLevel || null,
      p_equipment_availability: Array.isArray(equipmentAvailability) ? equipmentAvailability : null,
      p_injuries_limitations: injuriesLimitations || null,
      // v1.1.0 — `onboard_member` only wrote a `pending` communication_logs row
      // that nothing ever dispatched, so staff-created members never received a
      // welcome. Scheduling is now done below through dispatch-communication.
      p_schedule_welcome: false,
      p_welcome_channels: [],

    })

    if (onboardError) {
      console.error('onboard_member RPC error:', onboardError)
      throw onboardError
    }

    const result = (onboardResult ?? {}) as { success?: boolean; member_id?: string; member_code?: string; error?: string }
    if (!result.success) {
      console.error('onboard_member returned error:', result)
      return new Response(
        JSON.stringify({ error: result.error || 'Onboarding failed' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Persist non-onboarding profile fields (address, emergency contact, avatar)
    // that aren't part of the onboard_member contract.
    if (
      gender || dateOfBirth || address || emergencyContactName ||
      emergencyContactPhone || avatarUrl
    ) {
      await supabaseAdmin
        .from('profiles')
        .update({
          ...(gender ? { gender } : {}),
          ...(dateOfBirth ? { date_of_birth: dateOfBirth } : {}),
          ...(address ? { address } : {}),
          ...(emergencyContactName ? { emergency_contact_name: emergencyContactName } : {}),
          ...(emergencyContactPhone ? { emergency_contact_phone: emergencyContactPhone } : {}),
          ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
        })
        .eq('id', userId)
    }

    console.log('Member onboarded:', result.member_id)

    return new Response(
      JSON.stringify({
        success: true,
        userId: userId,
        memberId: result.member_id,
        memberCode: result.member_code,
        tempPassword: createdTempPassword,
        message: 'Member created successfully. They will set their password on first login.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: unknown) {
    console.error('Error in create-member-user:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
