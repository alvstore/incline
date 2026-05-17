import { useEffect, useCallback } from 'react';
import {
  isChatSoundEnabled,
  setChatSoundEnabled,
  notifyInbound,
  playTest,
  playPing,
  setActiveConversation,
} from '@/lib/audio/chatAudio';

export {
  isChatSoundEnabled,
  setChatSoundEnabled,
  playPing,
  playTest,
  setActiveConversation,
  notifyInbound,
};

export function useChatSoundPreference() {
  const get = useCallback(isChatSoundEnabled, []);
  const set = useCallback(setChatSoundEnabled, []);
  return { get, set };
}

/**
 * Sets the currently-open conversation key so the global subscription can
 * decide whether to play a full ping or a barely-audible pop for inbound
 * messages on that thread. Pass `null` (or unmount) to clear.
 */
export function useActiveConversation(key: string | null | undefined) {
  useEffect(() => {
    setActiveConversation(key ?? null);
    return () => setActiveConversation(null);
  }, [key]);
}

/**
 * Globally subscribes to inbound WhatsApp/Meta messages via Supabase Realtime
 * and routes them through the singleton `notifyInbound` decision matrix.
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
            // Skip backlog the realtime channel may replay on reconnect.
            try {
              const created = payload?.new?.created_at
                ? new Date(payload.new.created_at).getTime()
                : Date.now();
              if (created < mountedAt - 1000) return;
            } catch {
              /* fall through */
            }
            const row = payload?.new ?? {};
            if (row.is_internal_note) return;
            notifyInbound({
              conversationKey: row.phone_number ?? null,
              isInternalNote: false,
            });
          },
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
