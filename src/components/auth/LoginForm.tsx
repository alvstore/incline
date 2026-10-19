import { useState } from 'react';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { Eye, EyeOff, Loader2, AtSign, Lock, ArrowRight, AlertCircle } from 'lucide-react';
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

export interface LoginFormProps {
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
    form.clearErrors('root');
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
      form.setError('root', { message: error instanceof Error ? error.message : 'Unable to sign in. Please try again.' });
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
    <div className="space-y-7">
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase text-muted-foreground">
          Member & team access
        </p>
        <h1 className="text-3xl font-semibold text-foreground">Welcome back.</h1>
        <p className="text-sm text-muted-foreground">
          Sign in with your email or mobile number to continue.
        </p>
      </div>


      <Form {...form}>
        <form onSubmit={form.handleSubmit(handlePasswordSubmit)} className="space-y-5">
          <FormField
            control={form.control}
            name="identifier"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-foreground font-medium text-sm">Email or mobile <span aria-hidden="true">*</span></FormLabel>
                <FormControl>
                  <div className="relative">
                    <AtSign className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input
                      type="text"
                      placeholder="you@example.com  or  9876543210"
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      aria-required="true"
                      data-testid="input-identifier"
                      className="h-12 pl-10 text-base rounded-xl bg-card border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/30 focus:border-primary"
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
                <FormLabel className="text-foreground font-medium text-sm">Password <span aria-hidden="true">*</span></FormLabel>
                <FormControl>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      aria-required="true"
                      data-testid="input-password"
                      className="h-12 pl-10 pr-11 text-base rounded-xl bg-card border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/30 focus:border-primary"
                      {...field}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-1 top-1/2 h-11 w-11 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground transition-colors duration-200 focus-visible:ring-ring"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {form.formState.errors.root?.message && (
            <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{form.formState.errors.root.message}
            </p>
          )}
          <Button
            type="submit"
            data-testid="btn-sign-in"
            className="w-full h-12 cursor-pointer rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-base transition-colors duration-200"
            disabled={isLoading}
          >
            {isLoading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in...</>
            ) : (
              <>Sign in <ArrowRight className="ml-2 h-4 w-4" /></>
            )}
          </Button>
        </form>
      </Form>

      <div className="flex items-center justify-center">
        <Link
          to="/auth/forgot-password"
          data-testid="link-forgot-password"
          className="flex min-h-11 items-center rounded-sm cursor-pointer text-sm text-muted-foreground hover:text-primary font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Forgot your password?
        </Link>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        First time signing in? Use the temporary password your gym admin shared with you. You'll be asked to set a new password right after.
      </p>
    </div>
  );
}
