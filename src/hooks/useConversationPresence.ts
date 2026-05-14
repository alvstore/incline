import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type ConversationPresence = {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  status: 'viewing' | 'typing';
  ts: string;
};

const TYPING_IDLE_MS = 4000;
const THROTTLE_MS = 1000;

/**
 * Multi-device agent presence for a single WhatsApp conversation.
 *
 * - Joins the realtime channel `whatsapp:conv:<conversationKey>` (we key on the
 *   contact phone number to keep it stable across devices).
 * - Tracks `{ user_id, full_name, avatar_url, status: 'viewing'|'typing', ts }`.
 * - Returns the merged list of OTHER agents currently viewing/typing,
 *   plus a throttled `setTyping(true|false)` setter and a `broadcastReplied()`
 *   helper to notify other agents the conversation just got an outbound reply.
 */
export function useConversationPresence(conversationKey: string | null) {
  const { user, profile } = useAuth();
  const [others, setOthers] = useState<ConversationPresence[]>([]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTrackRef = useRef<number>(0);
  const typingClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentStatusRef = useRef<'viewing' | 'typing'>('viewing');

  const track = useCallback(
    async (status: 'viewing' | 'typing') => {
      const ch = channelRef.current;
      if (!ch || !user) return;
      const now = Date.now();
      if (now - lastTrackRef.current < THROTTLE_MS && status === currentStatusRef.current) return;
      lastTrackRef.current = now;
      currentStatusRef.current = status;
      try {
        await ch.track({
          user_id: user.id,
          full_name: profile?.full_name ?? null,
          avatar_url: profile?.avatar_url ?? null,
          status,
          ts: new Date().toISOString(),
        });
      } catch { /* ignore */ }
    },
    [user, profile?.full_name, profile?.avatar_url],
  );

  useEffect(() => {
    if (!conversationKey || !user) {
      setOthers([]);
      return;
    }
    const channelName = `whatsapp:conv:${conversationKey}`;
    const ch = supabase.channel(channelName, { config: { presence: { key: user.id } } });
    channelRef.current = ch;

    const sync = () => {
      const state = ch.presenceState() as Record<string, ConversationPresence[]>;
      const flat: ConversationPresence[] = [];
      const seen = new Set<string>();
      for (const arr of Object.values(state)) {
        for (const p of arr) {
          if (!p?.user_id || p.user_id === user.id || seen.has(p.user_id)) continue;
          seen.add(p.user_id);
          flat.push(p);
        }
      }
      setOthers(flat);
    };

    ch.on('presence', { event: 'sync' }, sync)
      .on('presence', { event: 'join' }, sync)
      .on('presence', { event: 'leave' }, sync)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await track('viewing');
          sync();
        }
      });

    return () => {
      try { supabase.removeChannel(ch); } catch { /* ignore */ }
      channelRef.current = null;
      if (typingClearRef.current) clearTimeout(typingClearRef.current);
      typingClearRef.current = null;
      setOthers([]);
      lastTrackRef.current = 0;
      currentStatusRef.current = 'viewing';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationKey, user?.id]);

  const setTyping = useCallback(
    (typing: boolean) => {
      if (!channelRef.current) return;
      if (typing) {
        track('typing');
        if (typingClearRef.current) clearTimeout(typingClearRef.current);
        typingClearRef.current = setTimeout(() => {
          track('viewing');
        }, TYPING_IDLE_MS);
      } else {
        if (typingClearRef.current) clearTimeout(typingClearRef.current);
        typingClearRef.current = null;
        track('viewing');
      }
    },
    [track],
  );

  const broadcastReplied = useCallback(() => {
    const ch = channelRef.current;
    if (!ch || !user) return;
    try {
      ch.send({
        type: 'broadcast',
        event: 'agent_replied',
        payload: { user_id: user.id, ts: new Date().toISOString() },
      });
    } catch { /* ignore */ }
  }, [user]);

  // Subscribe to broadcast `agent_replied` from peers
  const [lastPeerReplyAt, setLastPeerReplyAt] = useState<string | null>(null);
  useEffect(() => {
    const ch = channelRef.current;
    if (!ch) return;
    ch.on('broadcast', { event: 'agent_replied' }, (msg: any) => {
      if (msg?.payload?.user_id && msg.payload.user_id !== user?.id) {
        setLastPeerReplyAt(msg.payload.ts ?? new Date().toISOString());
      }
    });
  }, [conversationKey, user?.id]);

  const typingOthers = useMemo(() => others.filter((o) => o.status === 'typing'), [others]);
  const viewingOthers = useMemo(() => others.filter((o) => o.status === 'viewing'), [others]);

  return { others, typingOthers, viewingOthers, setTyping, broadcastReplied, lastPeerReplyAt };
}
