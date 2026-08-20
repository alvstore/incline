import { createContext, useContext, useEffect, useState, useRef, useCallback, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import type { Database } from '@/integrations/supabase/types';
import { reportError } from '@/lib/errorReporter';


type AppRole = Database['public']['Enums']['app_role'];

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  must_set_password: boolean;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  updated_at?: string | null;
}

interface UserRoleInfo {
  role: AppRole;
  branch_id?: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  roles: UserRoleInfo[];
  isLoading: boolean;
  mustSetPassword: boolean;
  showTimeoutWarning: boolean;
  sessionExpiresIn: number | null;
  signInWithOtp: (email: string) => Promise<{ error: Error | null }>;
  verifyOtp: (email: string, token: string) => Promise<{ error: Error | null }>;
  setPassword: (password: string) => Promise<{ error: Error | null }>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  updatePassword: (password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  hasRole: (role: AppRole) => boolean;
  hasAnyRole: (roles: AppRole[]) => boolean;
  refreshProfile: () => Promise<void>;
  extendSession: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const WARNING_THRESHOLD_MS = 5 * 60 * 1000; // Show warning at 5 minutes remaining

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [roles, setRoles] = useState<UserRoleInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showTimeoutWarning, setShowTimeoutWarning] = useState(false);
  const [sessionExpiresIn, setSessionExpiresIn] = useState<number | null>(null);

  // Cached timeout duration — fetched once, not on every event
  const timeoutMsRef = useRef<number | null>(null);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const warningIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Safari/iOS aborts in-flight fetches when the tab is backgrounded or the
  // network flips; supabase-js surfaces that as `TypeError: Load failed` with an
  // empty `code`. Those are transient, so retry briefly and log at warning level
  // instead of polluting error_logs with a false failure.
  const isTransientNetworkError = (error: any): boolean => {
    if (!error) return false;
    if (error.code) return false; // real PostgREST/permission error
    return /load failed|failed to fetch|network|aborted/i.test(String(error.message || ''));
  };

  const withRetry = async <T,>(
    label: string,
    run: () => Promise<{ data: T | null; error: any }>,
  ): Promise<T | null> => {
    const delays = [300, 900];
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      const { data, error } = await run();
      if (!error) return data;
      if (!isTransientNetworkError(error) || attempt === delays.length) {
        if (isTransientNetworkError(error)) {
          reportError(`${label}: transient network failure after retries`, {
            severity: 'warning',
            context: { message: String(error?.message || '') },
          });
        } else {
          console.error(`${label}:`, error);
        }
        return null;
      }
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
    return null;
  };

  const fetchProfile = async (userId: string) => {
    const data = await withRetry<UserProfile>('Error fetching profile', () =>
      supabase
        .from('profiles')
        .select('id, email, full_name, avatar_url, phone, must_set_password, emergency_contact_name, emergency_contact_phone, updated_at')
        .eq('id', userId)
        .single() as any,
    );
    return data;
  };

  const fetchRoles = async (userId: string) => {
    const data = await withRetry<{ role: AppRole }[]>('Error fetching roles', () =>
      supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId) as any,
    );
    return (data || []).map((r) => ({ role: r.role as AppRole }));
  };


  const refreshProfile = async () => {
    if (user) {
      const profileData = await fetchProfile(user.id);
      if (profileData) setProfile(profileData);
      const rolesData = await fetchRoles(user.id);
      setRoles(rolesData);
    }
  };

  // Fetch timeout value once and cache it
  const fetchTimeoutValue = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('organization_settings')
        .select('session_timeout_hours')
        .limit(1)
        .maybeSingle();
      const hours = data?.session_timeout_hours;
      timeoutMsRef.current = hours && hours > 0 ? hours * 60 * 60 * 1000 : null;
    } catch {
      timeoutMsRef.current = null;
    }
  }, []);

  const clearAllTimers = useCallback(() => {
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (warningIntervalRef.current) clearInterval(warningIntervalRef.current);
    setShowTimeoutWarning(false);
    setSessionExpiresIn(null);
  }, []);

  const resetInactivityTimer = useCallback(() => {
    const timeoutMs = timeoutMsRef.current;
    if (!timeoutMs) return;

    clearAllTimers();
    lastActivityRef.current = Date.now();

    // Set the warning timer (fires WARNING_THRESHOLD_MS before timeout)
    const warningDelay = Math.max(0, timeoutMs - WARNING_THRESHOLD_MS);
    warningTimerRef.current = setTimeout(() => {
      setShowTimeoutWarning(true);
      // Update countdown every 30s
      warningIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - lastActivityRef.current;
        const remaining = Math.max(0, timeoutMs - elapsed);
        setSessionExpiresIn(remaining);
        if (remaining <= 0) {
          clearAllTimers();
        }
      }, 30000);
      setSessionExpiresIn(WARNING_THRESHOLD_MS);
    }, warningDelay);

    // Set the actual sign-out timer
    inactivityTimerRef.current = setTimeout(async () => {
      clearAllTimers();
      try {
        await supabase.auth.signOut();
      } catch {
        // ignore
      }
      try { queryClient.clear(); } catch { /* ignore */ }
      // Hard redirect to /auth so any in-flight queries that lost their session
      // don't trigger the global ErrorBoundary.
      if (typeof window !== 'undefined') {
        window.location.href = '/auth?reason=timeout';
      }
    }, timeoutMs);
  }, [clearAllTimers, queryClient]);

  const extendSession = useCallback(() => {
    setShowTimeoutWarning(false);
    setSessionExpiresIn(null);
    resetInactivityTimer();
  }, [resetInactivityTimer]);

  // Session inactivity timer — uses cached timeout value
  useEffect(() => {
    if (!user) {
      clearAllTimers();
      return;
    }

    // Fetch timeout once on user login
    fetchTimeoutValue().then(() => {
      resetInactivityTimer();
    });

    // Lightweight event listener — only resets timers, no DB calls
    const handleActivity = () => {
      if (!showTimeoutWarning) {
        resetInactivityTimer();
      }
    };

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach(e => window.addEventListener(e, handleActivity, { passive: true }));

    return () => {
      clearAllTimers();
      events.forEach(e => window.removeEventListener(e, handleActivity));
    };
  }, [user, showTimeoutWarning, fetchTimeoutValue, resetInactivityTimer, clearAllTimers]);

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          Promise.all([
            fetchProfile(session.user.id),
            fetchRoles(session.user.id)
          ]).then(([profileData, rolesData]) => {
            setProfile(profileData);
            setRoles(rolesData || []);
          });
        } else {
          setProfile(null);
          setRoles([]);
        }
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        Promise.all([
          fetchProfile(session.user.id),
          fetchRoles(session.user.id)
        ]).then(([profileData, rolesData]) => {
          setProfile(profileData);
          setRoles(rolesData || []);
          setIsLoading(false);
        }).catch(() => {
          setIsLoading(false);
        });
      } else {
        setIsLoading(false);
      }
    });

    // Safety timeout: never stay loading forever
    const safetyTimeout = setTimeout(() => {
      setIsLoading(false);
    }, 8000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(safetyTimeout);
    };
  }, []);

  // Realtime profile refresh — pick up avatar / name changes made elsewhere
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`profile-realtime-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` },
        (payload) => {
          const next = payload.new as Partial<UserProfile>;
          setProfile((prev) => (prev ? { ...prev, ...next } as UserProfile : prev));
        },
      )
      .subscribe();

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchProfile(user.id).then((p) => p && setProfile(p));
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user?.id]);

  const signInWithOtp = async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({ email });
    return { error: error as Error | null };
  };

  const verifyOtp = async (email: string, token: string) => {
    const { error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    });
    return { error: error as Error | null };
  };

  const setPassword = async (password: string) => {
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) return { error: updateError as Error };

    const { error: profileError } = await supabase
      .from('profiles')
      .update({ must_set_password: false })
      .eq('id', user?.id);

    if (profileError) return { error: profileError as Error };
    
    await refreshProfile();
    return { error: null };
  };

  const resetPassword = async (email: string) => {
    const redirectTo = `${window.location.origin}/auth/reset-password`;

    // Primary: our own mail engine. The built-in auth mailer reports success
    // even when the message is silently dropped, so it can't be trusted as the
    // first attempt — and our engine records the send in the email log.
    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        'request-password-reset',
        { body: { email, redirect_to: redirectTo } },
      );
      if (!fnError && data?.ok) return { error: null };
    } catch {
      /* fall through to the built-in mailer */
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    return { error: (error as Error) ?? null };
  };



  const updatePassword = async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    clearAllTimers();
    await supabase.auth.signOut();
    queryClient.clear();
    setUser(null);
    setSession(null);
    setProfile(null);
    setRoles([]);
  };

  const hasRole = (role: AppRole) => {
    return roles.some(r => r.role === role);
  };

  const hasAnyRole = (checkRoles: AppRole[]) => {
    return roles.some(r => checkRoles.includes(r.role));
  };

  const mustSetPassword = profile?.must_set_password ?? false;

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        roles,
        isLoading,
        mustSetPassword,
        showTimeoutWarning,
        sessionExpiresIn,
        signInWithOtp,
        verifyOtp,
        setPassword,
        resetPassword,
        updatePassword,
        signOut,
        hasRole,
        hasAnyRole,
        refreshProfile,
        extendSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
