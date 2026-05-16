import { useEffect, useRef, useCallback } from 'react';

const STORAGE_KEY = 'incline:chat-sound-enabled';

export function isChatSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  const v = localStorage.getItem(STORAGE_KEY);
  return v === null ? true : v === 'true';
}

export function setChatSoundEnabled(enabled: boolean) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent('chat-sound-pref-change'));
}

/**
 * Lightweight inline notification sound (WebAudio synthesized "ping").
 * Avoids shipping an audio file and works offline.
 *
 * Exported so callers can offer a "Test sound" button (browsers gate
 * WebAudio behind a user gesture; the first invocation must be user-driven).
 */
export function playPing() {
  try {
    const AudioCtx =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.32);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
    setTimeout(() => ctx.close().catch(() => {}), 500);
  } catch {
    // ignore
  }
}

/**
 * Plays a notification sound when `trigger` increases (e.g. unread count).
 *
 * Bug fix: the previous implementation used `useRef(trigger)` which captures
 * the value at first render — but the effect runs *after* mount and also fires
 * whenever `trigger` changes from 0 → N (e.g., when a contact is opened and the
 * messages query resolves). That produced a false ping on contact open.
 *
 * The new implementation:
 *   - Skips the very first effect run (mount baseline), regardless of value
 *   - Optionally re-baselines when `resetKey` changes (e.g., switching contacts)
 */
export function useChatSound(trigger: number, resetKey?: string | number | null) {
  const prev = useRef<number | null>(null);
  const lastResetKey = useRef<string | number | null | undefined>(resetKey);

  useEffect(() => {
    // Re-baseline when caller signals (e.g., switched conversation)
    if (resetKey !== lastResetKey.current) {
      lastResetKey.current = resetKey;
      prev.current = trigger;
      return;
    }

    // First-ever observation: baseline only, no ping
    if (prev.current === null) {
      prev.current = trigger;
      return;
    }

    if (trigger > prev.current && isChatSoundEnabled()) {
      playPing();
    }
    prev.current = trigger;
  }, [trigger, resetKey]);
}

export function useChatSoundPreference() {
  const get = useCallback(isChatSoundEnabled, []);
  const set = useCallback(setChatSoundEnabled, []);
  return { get, set };
}

/**
 * Globally subscribes to inbound WhatsApp messages via Supabase Realtime
 * and plays the ping sound — independent of which page the user is on.
 *
 * RLS handles branch scoping server-side: the realtime stream will only
 * deliver INSERT events for rows the authenticated user is permitted to
 * SELECT (members see their own thread; staff see their branch's threads;
 * owners see all). So we don't need to filter on branch_id client-side.
 *
 * Mount once in a top-level layout (e.g. AppHeader).
 */
export function useGlobalChatSound(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    let cancelled = false;
    let channel: any = null;
    const mountedAt = Date.now();

    import('@/integrations/supabase/client').then(({ supabase }) => {
      if (cancelled) return;
      const channelName = `global-chat-sound-${Math.random().toString(36).slice(2, 8)}`;
      channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'whatsapp_messages',
            filter: 'direction=eq.inbound',
          },
          (payload: any) => {
            // Only ping for messages that arrived *after* this hook mounted —
            // avoids playing for any backlog the realtime channel may replay
            // on (re)connect.
            try {
              const created = payload?.new?.created_at
                ? new Date(payload.new.created_at).getTime()
                : Date.now();
              if (created < mountedAt - 1000) return;
            } catch {
              // fall through
            }
            // Skip "internal notes" — they aren't real inbound customer messages
            if (payload?.new?.is_internal_note) return;
            if (isChatSoundEnabled()) playPing();
          }
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      if (channel) {
        import('@/integrations/supabase/client').then(({ supabase }) => {
          supabase.removeChannel(channel);
        });
      }
    };
  }, [enabled]);
}
