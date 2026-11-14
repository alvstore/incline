import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { detectPlatform, detectOs, shouldBeat, HEARTBEAT_MS } from '@/lib/appUsage/platform';

const KEY = 'incline:install_id';
function installId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(KEY, id); }
    return id;
  } catch { return 'no-storage-install'; }
}

/** Records that this person is using the app (web or installed), at most every 2 minutes while on screen. */
export function useAppHeartbeat() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user?.id) return;
    let last: number | null = null;
    const beat = () => {
      const now = Date.now();
      if (!shouldBeat(last, now, document.visibilityState === 'visible')) return;
      last = now;
      const ua = navigator.userAgent;
      const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
      const platform = detectPlatform(ua, standalone, (window as any).__INCLINE_NATIVE__ ?? null);
      supabase.rpc('register_app_device', {
        p_install_id: installId(), p_platform: platform, p_app: 'web',
        p_os_version: detectOs(ua) ?? undefined,
        p_push_enabled: typeof Notification !== 'undefined' ? Notification.permission === 'granted' : undefined,
      }).then(({ error }) => { if (error) last = null; });
    };
    beat();
    const t = window.setInterval(beat, HEARTBEAT_MS / 4);
    document.addEventListener('visibilitychange', beat);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', beat); };
  }, [user?.id]);
}
