import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-setup-token',
}

// Input validation helpers
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 255;
const MAX_NAME_LENGTH = 100;
const MIN_PASSWORD_LENGTH = 8;

function sanitizeString(str: string, maxLength: number): string {
  return str
    .trim()
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control chars
    .slice(0, maxLength);
}

function validateEmail(email: string): { valid: boolean; error?: string } {
  if (!email) return { valid: false, error: 'Email is required' };
  if (email.length > MAX_EMAIL_LENGTH) return { valid: false, error: 'Email too long' };
  if (!EMAIL_REGEX.test(email)) return { valid: false, error: 'Invalid email format' };
  return { valid: true };
}

function validatePassword(password: string): { valid: boolean; error?: string } {
  if (!password) return { valid: false, error: 'Password is required' };
  if (password.length < MIN_PASSWORD_LENGTH) return { valid: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  return { valid: true };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // SECURITY FIX: Require setup token for owner creation
    const setupToken = Deno.env.get('SETUP_TOKEN');
    const providedToken = req.headers.get('X-Setup-Token') || req.headers.get('x-setup-token');

    if (!setupToken) {
      console.error('SETUP_TOKEN environment variable not configured');
      return new Response(
        JSON.stringify({ error: 'Server configuration error. Contact administrator.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!providedToken || providedToken !== setupToken) {
      console.warn('Invalid or missing setup token attempt');
      return new Response(
        JSON.stringify({ error: 'Invalid setup token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { global: { headers: {
        'x-actor-source': 'create-owner',
        'x-actor-name': 'System (initial setup)',
      } } }
    )

    // First check if owner already exists
    const { data: existingOwner } = await supabase
      .from('user_roles')
      .select('id')
      .eq('role', 'owner')
      .limit(1)

    if (existingOwner && existingOwner.length > 0) {
      console.log('Owner creation attempted but owner already exists');
      return new Response(
        JSON.stringify({ error: 'Owner already exists' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse and validate request body
    const body = await req.json();
    const email = sanitizeString(body.email || '', MAX_EMAIL_LENGTH);
    const password = body.password || '';
    const fullName = sanitizeString(body.fullName || '', MAX_NAME_LENGTH);

    // Validate email
    const emailValidation = validateEmail(email);
    if (!emailValidation.valid) {
      return new Response(
        JSON.stringify({ error: emailValidation.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate password
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return new Response(
        JSON.stringify({ error: passwordValidation.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create the user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName }
    })

    if (authError) throw authError

    // Update profile with full name
    await supabase
      .from('profiles')
      .update({ full_name: fullName, must_set_password: false })
      .eq('id', authData.user.id)

    // Assign owner role
    const { error: roleError } = await supabase
      .from('user_roles')
      .insert({ user_id: authData.user.id, role: 'owner' })

    if (roleError) throw roleError

    console.log('Owner created successfully:', authData.user.id);

    return new Response(
      JSON.stringify({ success: true, userId: authData.user.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Error in create-owner:', message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})