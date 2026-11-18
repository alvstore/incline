import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Bell, CheckCheck, Info, AlertTriangle, AlertCircle, CheckCircle2, Volume2, VolumeX, BellOff } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { fetchNotifications, fetchUnreadCount, markAsRead, markAllAsRead } from '@/services/notificationService';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { isChatSoundEnabled, setChatSoundEnabled } from '@/hooks/useChatSound';
import { cn } from '@/lib/utils';

const typeIcons = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: AlertCircle, reminder: Bell };
const typeTone = {
  info: 'bg-info/10 text-info',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  error: 'bg-destructive/10 text-destructive',
  reminder: 'bg-primary/10 text-primary',
};

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
type Filter = 'all' | 'unread';

export function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [soundOn, setSoundOn] = useState(isChatSoundEnabled());
  const iconRef = useRef<SVGSVGElement>(null);
  const badgeRef = useRef<HTMLSpanElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const prevCount = useRef<number | null>(null);

  useEffect(() => {
    const handler = () => setSoundOn(isChatSoundEnabled());
    window.addEventListener('chat-sound-pref-change', handler);
    return () => window.removeEventListener('chat-sound-pref-change', handler);
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`user-notifications-${user.id}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['notification-count', user.id] });
        queryClient.invalidateQueries({ queryKey: ['notifications', user.id] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, queryClient]);

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['notification-count', user?.id],
    queryFn: () => fetchUnreadCount(user!.id),
    enabled: !!user?.id,
    refetchInterval: 5 * 60 * 1000,
    refetchIntervalInBackground: false,
  });

  const { data: notifications = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: () => fetchNotifications(user!.id),
    enabled: !!user?.id && open,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['notification-count'] });
  };
  const markReadMutation = useMutation({ mutationFn: markAsRead, onSuccess: invalidate });
  const markAllReadMutation = useMutation({ mutationFn: () => markAllAsRead(user!.id), onSuccess: invalidate });

  // Bell swing + badge pop only when a NEW unread arrives (not on first load).
  useEffect(() => {
    const prev = prevCount.current;
    prevCount.current = unreadCount;
    if (prev === null || unreadCount <= prev || reduced()) return;
    if (iconRef.current) {
      gsap.fromTo(iconRef.current, { rotation: 0 }, {
        keyframes: { rotation: [0, 16, -12, 8, -4, 0] }, duration: 0.9, ease: 'power2.out', transformOrigin: '50% 0%',
      });
    }
    if (badgeRef.current) gsap.fromTo(badgeRef.current, { scale: 0.4 }, { scale: 1, duration: 0.55, ease: 'back.out(3)' });
  }, [unreadCount]);

  const handleTap = () => {
    if (reduced() || !iconRef.current) return;
    gsap.fromTo(iconRef.current, { scale: 0.7 }, { scale: 1, duration: 0.55, ease: 'back.out(3)', overwrite: 'auto' });
  };

  const visible = filter === 'unread' ? notifications.filter((n: any) => !n.is_read) : notifications;

  // Row entrance when opened / filter switched.
  useLayoutEffect(() => {
    if (!open || !listRef.current || reduced()) return;
    const rows = listRef.current.querySelectorAll('[data-row]');
    if (!rows.length) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(rows, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out', stagger: 0.04, delay: 0.08, clearProps: 'transform,opacity' });
    }, listRef);
    return () => ctx.revert();
  }, [open, filter, isLoading, visible.length]);

  // Sliding segmented pill (dock-style); tabs are equal width so the pill moves by its own width.
  useLayoutEffect(() => {
    if (!pillRef.current) return;
    const x = filter === 'unread' ? '100%' : '0%';
    if (reduced()) gsap.set(pillRef.current, { x });
    else gsap.to(pillRef.current, { x, duration: 0.45, ease: 'power3.out' });
  }, [filter]);

  const openItem = (n: any) => {
    if (!n.is_read) markReadMutation.mutate(n.id);
    if (n.action_url) {
      setOpen(false);
      if (/^https?:\/\//.test(n.action_url)) window.location.href = n.action_url;
      else navigate(n.action_url);
    }
  };

  const label = unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          onClick={handleTap}
          className={cn('relative h-10 w-10 rounded-full transition-colors', open && 'bg-muted text-foreground')}
        >
          <Bell ref={iconRef} className="h-5 w-5" strokeWidth={1.8} />
          {unreadCount > 0 && (
            <span
              ref={badgeRef}
              aria-hidden
              className="absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold tabular-nums text-destructive-foreground ring-2 ring-background"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={10}
        className="notif-panel w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-2xl border-0 p-0 shadow-xl"
      >
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <div>
            <h4 className="text-base font-semibold leading-none">Notifications</h4>
            <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
              {unreadCount > 0 ? `${unreadCount} unread` : 'You\u2019re all caught up'}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost" size="icon" className="h-9 w-9 rounded-full"
              aria-label={soundOn ? 'Mute notification sound' : 'Enable notification sound'}
              aria-pressed={soundOn}
              onClick={() => { setChatSoundEnabled(!soundOn); setSoundOn(!soundOn); }}
            >
              {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4 text-muted-foreground" />}
            </Button>
            <Button
              variant="ghost" size="sm" className="h-9 rounded-full text-xs"
              disabled={unreadCount === 0 || markAllReadMutation.isPending}
              onClick={() => markAllReadMutation.mutate()}
            >
              <CheckCheck className="mr-1 h-3.5 w-3.5" /> Mark all read
            </Button>
          </div>
        </div>

        <div ref={tabsRef} role="tablist" aria-label="Filter notifications" className="relative mx-4 mb-2 flex rounded-full bg-muted p-1">
          <span ref={pillRef} aria-hidden style={{ transform: `translateX(${filter === 'unread' ? '100%' : '0%'})` }} className="absolute left-1 top-1 bottom-1 w-[calc(50%-4px)] rounded-full bg-background shadow-sm" />
          {(['all', 'unread'] as Filter[]).map((f) => (
            <button
              key={f} data-tab={f} role="tab" aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                'relative z-10 flex-1 rounded-full py-1.5 text-xs font-semibold capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                filter === f ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f}{f === 'unread' && unreadCount > 0 ? ` · ${unreadCount}` : ''}
            </button>
          ))}
        </div>

        <ScrollArea className="h-[min(380px,60dvh)]">
          <div ref={listRef} className="px-2 pb-2">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-3 p-3">
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-2/3" /><Skeleton className="h-3 w-full" /></div>
                </div>
              ))
            ) : isError ? (
              <div className="p-8 text-center">
                <p className="text-sm text-muted-foreground">Couldn’t load notifications.</p>
                <Button variant="outline" size="sm" className="mt-3 rounded-full" onClick={() => refetch()}>Try again</Button>
              </div>
            ) : visible.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  {filter === 'unread' ? <CheckCheck className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
                </div>
                <p className="text-sm font-medium text-foreground">{filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}</p>
                <p className="mt-1 text-xs">New alerts will appear here.</p>
              </div>
            ) : (
              <ul className="space-y-0.5">
                {visible.map((n: any) => {
                  const Icon = typeIcons[n.type as keyof typeof typeIcons] || Info;
                  const tone = typeTone[n.type as keyof typeof typeTone] || 'bg-muted text-muted-foreground';
                  return (
                    <li key={n.id} data-row>
                      <button
                        onClick={() => openItem(n)}
                        className={cn(
                          'group flex w-full gap-3 rounded-xl p-3 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          !n.is_read && 'bg-primary/5',
                        )}
                      >
                        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-transform group-hover:scale-105', tone)}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-start justify-between gap-2">
                            <span className={cn('text-sm leading-snug', n.is_read ? 'font-medium text-muted-foreground' : 'font-semibold')}>{n.title}</span>
                            {!n.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                          </span>
                          <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{n.message}</span>
                          <span className="mt-1 block text-[11px] tabular-nums text-muted-foreground">
                            {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
