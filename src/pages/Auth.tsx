import { useEffect } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { LoginForm } from '@/components/auth/LoginForm';
import { AuthVisualPanel } from '@/components/auth/AuthVisualPanel';
import { supabase } from '@/integrations/supabase/client';
import { getHomePath } from '@/lib/roleRedirect';
import SEO from '@/components/seo/SEO';

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

  return (
    <div className="incline-auth isolate min-h-dvh w-full bg-card lg:grid lg:grid-cols-2">
      <SEO
        title="Sign in | The Incline Life"
        description="Sign in to your Incline membership portal to book classes, manage your plan, view invoices and access recovery sessions."
        path="/auth"
        noindex
      />

      {/* Visual panel — mounted ONCE (desktop full height, mobile compact hero).
          Two copies doubled the animated layers and caused repaint flicker. */}
      <div className="relative isolate h-24 overflow-hidden sm:h-28 lg:h-auto lg:min-h-dvh">
        <AuthVisualPanel />
      </div>

      {/* RIGHT — Auth card */}
      <main className="relative isolate flex min-w-0 flex-col items-center justify-center px-6 py-10 sm:px-10 lg:px-12">
        <div className="relative w-full max-w-sm space-y-8">
          <div className="auth-form-surface bg-card">
            <LoginForm />
          </div>

          <nav aria-label="Legal" className="flex flex-wrap items-center justify-center gap-x-3 text-xs text-muted-foreground">
            <Link to="/privacy-policy" className="flex min-h-11 items-center rounded-sm cursor-pointer hover:text-foreground transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Privacy Policy</Link>
            <span aria-hidden className="text-muted-foreground">·</span>
            <Link to="/terms" className="flex min-h-11 items-center rounded-sm cursor-pointer hover:text-foreground transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Terms of Service</Link>
            <span aria-hidden className="text-muted-foreground">·</span>
            <Link to="/data-deletion" className="flex min-h-11 items-center rounded-sm cursor-pointer hover:text-foreground transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Data Deletion</Link>
          </nav>
          <p className="text-center text-[11px] text-muted-foreground">
            © {new Date().getFullYear()} The Incline Life by Incline
          </p>
        </div>
      </main>

    </div>
  );
}
