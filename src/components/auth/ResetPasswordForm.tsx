import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2, Lock, Eye, EyeOff, Check, AlertCircle, ArrowLeft } from 'lucide-react';
import { z } from 'zod';

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

type LinkState = 'verifying' | 'ready' | 'invalid';

export function ResetPasswordForm() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [linkState, setLinkState] = useState<LinkState>('verifying');
  const { setPassword: completeSetup } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const passwordValidation = passwordSchema.safeParse(password);
  const passwordRequirements = [
    { met: password.length >= 8, text: 'At least 8 characters' },
    { met: /[A-Z]/.test(password), text: 'One uppercase letter' },
    { met: /[a-z]/.test(password), text: 'One lowercase letter' },
    { met: /[0-9]/.test(password), text: 'One number' },
  ];

  // Detect URL-level errors (Supabase appends ?error=... or #error=... when
  // the recovery token is invalid/expired) and listen for the recovery session.
  useEffect(() => {
    const hash = window.location.hash || '';
    const urlErr =
      searchParams.get('error') ||
      searchParams.get('error_code') ||
      (hash.includes('error') ? 'invalid' : null);

    if (urlErr) {
      setLinkState('invalid');
      return;
    }

    let resolved = false;
    const finishReady = () => {
      resolved = true;
      setLinkState('ready');
    };

    // If a session is already present, we're good.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user && !resolved) finishReady();
    });

    // Otherwise wait briefly for the PASSWORD_RECOVERY auth event.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session?.user) {
        finishReady();
      }
    });

    const timeout = setTimeout(() => {
      if (!resolved) setLinkState('invalid');
    }, 4000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordValidation.success) {
      toast.error(passwordValidation.error.errors[0].message);
      return;
    }
    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setIsLoading(true);
    // Uses the setup path so a pending "must set password" flag is cleared too —
    // otherwise the app forces the set-password screen again after a reset.
    const { error } = await completeSetup(password);
    setIsLoading(false);
    if (error) {
      if (/different from the old password/i.test(error.message || '')) {
        toast.error('This is already your current password. Choose a new one, or go back and sign in with it.');
        setPassword('');
        setConfirmPassword('');
        return;
      }
      toast.error(error.message || 'Could not update your password. Please try again.');
      return;
    }
    toast.success('Password updated successfully!');
    navigate('/auth', { replace: true });
  };

  if (linkState === 'verifying') {
    return (
      <Card className="w-full max-w-md glass animate-in">
        <CardContent className="py-12 flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Verifying reset link…</p>
        </CardContent>
      </Card>
    );
  }

  if (linkState === 'invalid') {
    return (
      <Card className="w-full max-w-md glass animate-in">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <AlertCircle className="h-7 w-7" />
          </div>
          <CardTitle className="text-2xl font-bold">Reset link invalid or expired</CardTitle>
          <CardDescription>
            For security, password reset links can only be used once and expire after a short time. Request a new link to try again.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Link to="/auth/forgot-password">
            <Button className="w-full">Request a new reset link</Button>
          </Link>
          <Link to="/auth">
            <Button variant="outline" className="w-full">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Sign In
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md glass animate-in">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <Lock className="h-7 w-7" />
        </div>
        <CardTitle className="text-2xl font-bold">Set New Password</CardTitle>
        <CardDescription>Enter your new password below</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">New Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                autoComplete="new-password"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input
              id="confirmPassword"
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={isLoading}
              autoComplete="new-password"
            />
          </div>

          <div className="rounded-lg border border-border bg-muted/50 p-3">
            <p className="text-sm font-medium text-foreground mb-2">Password requirements:</p>
            <ul className="space-y-1">
              {passwordRequirements.map((req, i) => (
                <li
                  key={i}
                  className={`flex items-center gap-2 text-sm ${
                    req.met ? 'text-success' : 'text-muted-foreground'
                  }`}
                >
                  <Check className={`h-3 w-3 ${req.met ? 'opacity-100' : 'opacity-30'}`} />
                  {req.text}
                </li>
              ))}
            </ul>
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={isLoading || !passwordValidation.success || password !== confirmPassword}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating...
              </>
            ) : (
              'Update Password'
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
