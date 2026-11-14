export type AppPlatform = 'ios' | 'android' | 'web_pwa' | 'web_browser';
export type ActivityLevel = 'online' | 'active' | 'inactive' | 'never';

export const HEARTBEAT_MS = 2 * 60 * 1000;
export const ONLINE_WINDOW_MS = 5 * 60 * 1000;
export const ACTIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Detect where the app is running. Native wrappers can set window.__INCLINE_NATIVE__ = 'ios' | 'android'. */
export function detectPlatform(ua: string, standalone: boolean, nativeHint?: string | null): AppPlatform {
  if (nativeHint === 'ios' || nativeHint === 'android') return nativeHint;
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  if (standalone && isIOS) return 'ios';
  if (standalone && isAndroid) return 'android';
  if (standalone) return 'web_pwa';
  return 'web_browser';
}

export function detectOs(ua: string): string | null {
  const ios = ua.match(/OS (\d+)[_.](\d+)/);
  if (/iPhone|iPad|iPod/i.test(ua) && ios) return `iOS ${ios[1]}.${ios[2]}`;
  const an = ua.match(/Android (\d+(?:\.\d+)?)/);
  if (an) return `Android ${an[1]}`;
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS X/i.test(ua)) return 'macOS';
  return null;
}

export function activityLevel(lastSeen: string | null | undefined, now = Date.now()): ActivityLevel {
  if (!lastSeen) return 'never';
  const age = now - new Date(lastSeen).getTime();
  if (age <= ONLINE_WINDOW_MS) return 'online';
  if (age <= ACTIVE_WINDOW_MS) return 'active';
  return 'inactive';
}

export function shouldBeat(lastBeatAt: number | null, now: number, visible: boolean): boolean {
  if (!visible) return false;
  return lastBeatAt === null || now - lastBeatAt >= HEARTBEAT_MS;
}

export const PLATFORM_LABEL: Record<AppPlatform, string> = {
  ios: 'iPhone app', android: 'Android app', web_pwa: 'Installed web app', web_browser: 'Web browser',
};
