import { useState } from 'react';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { Eye, EyeOff, Loader2, AtSign, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { classifyIdentifier } from '@/lib/auth/identifier';

const passwordLoginSchema = z.object({
  identifier: z
    .string()
    .min(1, 'Enter your email or mobile number')
    .refine((v) => classifyIdentifier(v).kind !== 'invalid', {
      message: 'Enter a valid email or 10-digit Indian mobile number',
    }),
  password: z.string().min(1, 'Password is required'),
});

type PasswordLoginData = z.infer<typeof passwordLoginSchema>;

interface LoginFormProps {
  onSuccess?: () => void;
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { toast: shadToast } = useToast();

  const form = useForm<PasswordLoginData>({
    resolver: zodResolver(passwordLoginSchema),
    defaultValues: { identifier: '', password: '' },
  });

  const handlePasswordSubmit = async (data: PasswordLoginData) => {
    setIsLoading(true);
    try {
      const id = classifyIdentifier(data.identifier);

      if (id.kind === 'email') {
        const { error } = await supabase.auth.signInWithPassword({
          email: id.value,
          password: data.password,
        });
        if (error) throw new Error('Invalid credentials');
      } else if (id.kind === 'phone') {
        // Server-side phone+password sign-in (never exposes email)
        const { data: resolved, error: resolveErr } = await supabase.functions.invoke(
          'resolve-login-identifier',
          { body: { phone: id.value, password: data.password } },
        );
        if (resolveErr || !resolved?.session) {
          throw new Error('Invalid credentials');
        }
        const { error: setErr } = await supabase.auth.setSession({
          access_token: resolved.session.access_token,
          refresh_token: resolved.session.refresh_token,
        });
        if (setErr) throw new Error('Invalid credentials');
      } else {
        throw new Error('Enter a valid email or mobile number');
      }

      shadToast({ title: 'Welcome back!', description: 'Successfully signed in.' });
      onSuccess?.();
    } catch (error) {
      shadToast({
        title: 'Sign in failed',
        description: error instanceof Error ? error.message : 'Invalid credentials',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };


  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Welcome back</h2>
        <p className="text-sm text-slate-500">Sign in to your Incline account to continue</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(handlePasswordSubmit)} className="space-y-3.5">
          <FormField
            control={form.control}
            name="identifier"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-slate-700 font-medium text-sm">Email or mobile</FormLabel>
                <FormControl>
                  <div className="relative">
                    <AtSign className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                    <Input
                      type="text"
                      placeholder="you@example.com  or  9876543210"
                      autoComplete="username"
                      data-testid="input-identifier"
                      className="h-12 pl-10 text-base rounded-xl bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-primary/30 focus:border-primary"
                      {...field}
                    />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-slate-700 font-medium text-sm">Password</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      data-testid="input-password"
                      className="h-12 pl-10 pr-11 text-base rounded-xl bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-primary/30 focus:border-primary"
                      {...field}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button
            type="submit"
            data-testid="btn-sign-in"
            className="w-full h-12 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-base shadow-[0_10px_30px_-10px_hsl(217_91%_50%/0.6)] hover:shadow-[0_14px_36px_-12px_hsl(217_91%_50%/0.7)] transition-all"
            disabled={isLoading}
          >
            {isLoading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in...</>
            ) : (
              'Sign In'
            )}
          </Button>
        </form>
      </Form>

      <div className="flex items-center justify-center">
        <Link
          to="/auth/forgot-password"
          data-testid="link-forgot-password"
          className="text-sm text-slate-500 hover:text-primary font-medium transition-colors"
        >
          Forgot your password?
        </Link>
      </div>

      <p className="text-center text-xs text-slate-400">
        First time signing in? Use the temporary password your gym admin shared with you. You'll be asked to set a new password right after.
      </p>
    </div>
  );
}
