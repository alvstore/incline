import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, ShieldCheck, Eye, EyeOff, CheckCircle2, Circle } from 'lucide-react';
import { z } from 'zod';
import { cn } from '@/lib/utils';
import { getHomePath } from '@/lib/roleRedirect';

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

export function SetPasswordForm() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { setPassword: updatePassword, profile, roles } = useAuth();
  const navigate = useNavigate();

  const passwordValidation = passwordSchema.safeParse(password);
  const requirements = [
    { met: password.length >= 8, text: 'At least 8 characters' },
    { met: /[A-Z]/.test(password), text: 'One uppercase letter' },
    { met: /[a-z]/.test(password), text: 'One lowercase letter' },
    { met: /[0-9]/.test(password), text: 'One number' },
  ];
  const metCount = requirements.filter((r) => r.met).length;
  const strengthColors = ['bg-muted', 'bg-destructive', 'bg-warning', 'bg-warning', 'bg-success'];
  const strengthLabel = ['', 'Weak', 'Fair', 'Good', 'Strong'][metCount];

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
    const { error } = await updatePassword(password);
    setIsLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Password set successfully!');
    navigate(getHomePath(roles), { replace: true });
  };

  return (
    <div className="w-full max-w-md rounded-3xl bg-card p-6 sm:p-8 shadow-xl shadow-primary/5">
      <div className="text-center mb-6">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <ShieldCheck className="h-7 w-7" />
        </div>
        <h2 className="text-2xl font-bold text-foreground">Welcome{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}!</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Secure your account by setting a password to continue.
        </p>
      </div>

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
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {/* Strength meter */}
          {password.length > 0 && (
            <div className="pt-1">
              <div className="flex gap-1.5">
                {[1, 2, 3, 4].map((seg) => (
                  <div
                    key={seg}
                    className={cn(
                      'h-1.5 flex-1 rounded-full transition-colors',
                      seg <= metCount ? strengthColors[metCount] : 'bg-muted'
                    )}
                  />
                ))}
              </div>
              {strengthLabel && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  Strength: <span className="font-medium text-foreground">{strengthLabel}</span>
                </p>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm Password</Label>
          <div className="relative">
            <Input
              id="confirmPassword"
              type={showConfirm ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={isLoading}
              autoComplete="new-password"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowConfirm(!showConfirm)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label={showConfirm ? 'Hide password' : 'Show password'}
            >
              {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {confirmPassword.length > 0 && password !== confirmPassword && (
            <p className="text-xs text-destructive">Passwords don't match yet</p>
          )}
        </div>

        <div className="rounded-xl bg-muted/40 p-3.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2.5">
            Password requirements
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5">
            {requirements.map((req, i) => (
              <li
                key={i}
                className={cn(
                  'flex items-center gap-2 text-sm transition-colors',
                  req.met ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {req.met ? (
                  <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 opacity-40" />
                )}
                {req.text}
              </li>
            ))}
          </ul>
        </div>

        <Button
          type="submit"
          className="w-full h-11 rounded-xl text-base font-medium"
          disabled={isLoading || !passwordValidation.success || password !== confirmPassword}
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Setting password...
            </>
          ) : (
            'Set Password & Continue'
          )}
        </Button>
      </form>
    </div>
  );
}
