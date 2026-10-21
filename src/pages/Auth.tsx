import { useEffect } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { LoginForm } from '@/components/auth/LoginForm';
import { AuthVisualPanel } from '@/components/auth/AuthVisualPanel';
import { supabase } from '@/integrations/supabase/client';
import { getHomePath } from '@/lib/roleRedirect';
import SEO from '@/components/seo/SEO';
import inclineLogo from '@/assets/incline-logo.png';

export default function AuthPage() {
  const { user, isLoading, mustSetPassword, roles } = useAuth();
  const [searchParams] = useSearchParams();

  // Public form paints independently; session hydration only gates redirects.
  const { data: needsSetup } = useQuery({
    queryKey: ['auth-setup-check'],
    queryFn: async () => {
      const cacheKey = '__incline_setup_check';
      const cached = sessionStorage.getItem(cacheKey);
      if (cached !== null) return cached === '1';
      const { data, error } = await supabase.functions.invoke<{ needsSetup?: boolean }>('check-setup', {
        signal: AbortSignal.timeout(3000),
      });
      if (error) throw error;
      const needs = data?.needsSetup === true;
      sessionStorage.setItem(cacheKey, needs ? '1' : '0');
      return needs;
    },
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    const refCode = searchParams.get('ref');
    if (refCode) sessionStorage.setItem('referral_code', refCode);
  }, [searchParams]);

  if (needsSetup) return <Navigate to="/setup" replace />;
  const refParam = searchParams.get('ref');
  if (!isLoading && refParam && !user) return <Navigate to={`/register?ref=${encodeURIComponent(refParam)}`} replace />;
  if (!isLoading && user && !mustSetPassword) return <Navigate to={getHomePath(roles)} replace />;
  if (!isLoading && user && mustSetPassword) return <Navigate to="/auth/set-password" replace />;

  const legal = 'flex min-h-11 items-center rounded-sm cursor-pointer hover:text-foreground transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className="incline-auth relative isolate flex min-h-dvh w-full items-center justify-center overflow-hidden bg-background p-0 sm:p-6 lg:p-10">
      <SEO
        title="Sign in | The Incline Life"
        description="Sign in to your Incline membership portal to book classes, manage your plan, view invoices and access recovery sessions."
        path="/auth"
        noindex
      />
      {/* Soft warm backdrop glow */}
      <div className="pointer-events-none absolute -bottom-40 left-1/2 -z-10 h-[480px] w-[900px] -translate-x-1/2 rounded-full bg-accent/20 blur-3xl" aria-hidden="true" />

      {/* Framed card — forced dark tokens so logo/text never flip on load */}
      <div className="dark w-full max-w-6xl animate-fade-in">
        <div className="grid min-h-dvh grid-cols-1 gap-4 bg-card p-3 pb-safe text-foreground sm:min-h-0 sm:rounded-[2rem] sm:border sm:border-border sm:p-4 lg:grid-cols-2">
          <div className="order-1 lg:order-2">
            <AuthVisualPanel />
          </div>

          <main className="order-2 flex min-w-0 flex-col px-3 py-4 sm:px-6 lg:order-1 lg:px-10 lg:py-6">
            <header className="flex items-center justify-between gap-4">
              <img src={inclineLogo} alt="Incline — Rise. Reflect. Repeat." width={200} height={100} className="h-10 w-auto object-contain lg:h-12" />
              <p className="text-xs text-muted-foreground">
                New here?{' '}
                <Link to="/register" className="inline-flex min-h-11 items-center font-semibold text-foreground hover:text-primary transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">Join Incline</Link>
              </p>
            </header>

            <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-8">
              <h1 className="text-4xl font-semibold tracking-tight lg:text-5xl">Welcome back.</h1>
              <p className="mt-2 text-sm text-muted-foreground">Rise. Reflect. Repeat. — sign in to your club.</p>
              <div className="auth-form-surface mt-8">
                <LoginForm />
              </div>
            </div>

            <footer className="space-y-1">
              <nav aria-label="Legal" className="flex flex-wrap items-center justify-center gap-x-3 text-xs text-muted-foreground lg:justify-start">
                <Link to="/privacy-policy" className={legal}>Privacy Policy</Link>
                <span aria-hidden>·</span>
                <Link to="/terms" className={legal}>Terms of Service</Link>
                <span aria-hidden>·</span>
                <Link to="/data-deletion" className={legal}>Data Deletion</Link>
              </nav>
              <p className="text-center text-[11px] text-muted-foreground lg:text-left">© {new Date().getFullYear()} The Incline Life by Incline</p>
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
}
