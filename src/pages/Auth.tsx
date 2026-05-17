import { useState, useEffect } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { LoginForm } from '@/components/auth/LoginForm';
import { AuthVisualPanel } from '@/components/auth/AuthVisualPanel';
import { supabase } from '@/integrations/supabase/client';
import { GymLoader } from '@/components/ui/gym-loader';
import { getHomePath } from '@/lib/roleRedirect';
import SEO from '@/components/seo/SEO';

export default function AuthPage() {
  const { user, isLoading, mustSetPassword, roles } = useAuth();
  const [checkingSetup, setCheckingSetup] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const refCode = searchParams.get('ref');
    if (refCode) sessionStorage.setItem('referral_code', refCode);
  }, [searchParams]);

  useEffect(() => {
    // Cache result for the session — avoids a 1–3s blocking edge-fn call
    // on every Auth mount (and works fine offline / when the fn is blocked).
    const CACHE_KEY = '__incline_setup_check';
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached !== null) {
      if (cached === '1') setNeedsSetup(true);
      setCheckingSetup(false);
      return;
    }
    const checkSetup = async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const { data, error } = await supabase.functions.invoke('check-setup', {
          signal: controller.signal as any,
        });
        clearTimeout(timeout);
        if (error) throw error;
        const needs = !!data?.needsSetup;
        sessionStorage.setItem(CACHE_KEY, needs ? '1' : '0');
        if (needs) setNeedsSetup(true);
      } catch (error) {
        // Non-fatal: assume no setup needed so the user isn't blocked.
        sessionStorage.setItem(CACHE_KEY, '0');
        console.warn('Setup check skipped:', error);
      } finally {
        setCheckingSetup(false);
      }
    };
    checkSetup();
  }, []);

  if (isLoading || checkingSetup) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <GymLoader text="Warming up..." />
      </div>
    );
  }

  if (needsSetup) return <Navigate to="/setup" replace />;
  if (user && !mustSetPassword) return <Navigate to={getHomePath(roles)} replace />;
  if (user && mustSetPassword) return <Navigate to="/auth/set-password" replace />;

  const handleLoginSuccess = () => navigate('/home');

  return (
    <div className="incline-auth min-h-dvh w-full bg-slate-50 lg:grid lg:grid-cols-2">
      <SEO
        title="Sign in | The Incline Life"
        description="Sign in to your Incline membership portal to book classes, manage your plan, view invoices and access recovery sessions."
        path="/auth"
        noindex
      />

      {/* LEFT — Visual panel (desktop full height, mobile compact hero) */}
      <div className="hidden lg:block relative min-h-dvh">
        <AuthVisualPanel />
      </div>

      {/* Mobile compact hero */}
      <div className="lg:hidden relative h-[280px] overflow-hidden">
        <AuthVisualPanel />
      </div>

      {/* RIGHT — Auth card */}
      <div className="relative flex flex-col items-center justify-center px-4 py-10 sm:px-8 lg:px-12">
        {/* Soft decorative bg blobs (right side, behind card) */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-blue-100/60 blur-3xl" />
          <div className="absolute bottom-0 -left-20 h-72 w-72 rounded-full bg-cyan-100/50 blur-3xl" />
        </div>

        <div className="relative w-full max-w-[440px] space-y-6">
          <div className="glass-card rounded-3xl p-6 sm:p-8">
            <LoginForm onSuccess={handleLoginSuccess} />
          </div>

          <nav className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <Link to="/privacy-policy" className="hover:text-slate-900 transition-colors">Privacy Policy</Link>
            <span aria-hidden className="text-slate-300">·</span>
            <Link to="/terms" className="hover:text-slate-900 transition-colors">Terms of Service</Link>
            <span aria-hidden className="text-slate-300">·</span>
            <Link to="/data-deletion" className="hover:text-slate-900 transition-colors">Data Deletion</Link>
          </nav>
          <p className="text-center text-[11px] text-slate-400">
            © {new Date().getFullYear()} The Incline Life by Incline
          </p>
        </div>
      </div>
    </div>
  );
}
