import { useMemo, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Megaphone, AlertCircle, Sparkles, Clock3, ShieldAlert, ChevronRight, Paperclip } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useMemberData } from '@/hooks/useMemberData';
import { format, formatDistanceToNow } from 'date-fns';
import { AnnouncementAttachment } from '@/components/announcements/AnnouncementAttachment';

type Filter = 'all' | 'important' | 'expiring';

export default function MemberAnnouncements() {
  const { member, isLoading: memberLoading } = useMemberData();
  const branchName = member?.branch?.name || 'your branch';
  const [filter, setFilter] = useState<Filter>('all');
  const [active, setActive] = useState<any | null>(null);

  const { data: announcements = [], isLoading: announcementsLoading } = useQuery({
    queryKey: ['member-announcements', member?.branch_id],
    enabled: !!member,
    queryFn: async () => {
      const nowIso = new Date().toISOString();
      // Fetch broadly, then filter in JS — chained PostgREST .or() calls
      // override each other and silently drop matches.
      const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .eq('is_active', true)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching announcements:', error);
        return [];
      }
      return (data || []).filter((a: any) => {
        const branchOk = !a.branch_id || a.branch_id === member!.branch_id;
        const audienceOk = !a.target_audience || ['all', 'members'].includes(a.target_audience);
        const publishOk = !a.publish_at || a.publish_at <= nowIso;
        const expireOk = !a.expire_at || a.expire_at > nowIso;
        return branchOk && audienceOk && publishOk && expireOk;
      });
    },
  });

  const isExpiringSoon = (a: any) => {
    if (!a.expire_at) return false;
    const expiry = new Date(a.expire_at).getTime();
    return expiry > Date.now() && expiry - Date.now() < 7 * 24 * 60 * 60 * 1000;
  };

  const importantCount = announcements.filter((a: any) => Number(a.priority) > 0).length;
  const expiringSoonCount = announcements.filter(isExpiringSoon).length;

  const filtered = useMemo(() => {
    if (filter === 'important') return announcements.filter((a: any) => Number(a.priority) > 0);
    if (filter === 'expiring') return announcements.filter(isExpiringSoon);
    return announcements;
  }, [announcements, filter]);

  const featured = filtered[0];
  const rest = filtered.slice(1);
  const isLoading = memberLoading || announcementsLoading;

  const metaBadges = (a: any) => (
    <div className="flex flex-wrap items-center gap-1.5">
      {Number(a.priority) > 0 && (
        <Badge className="gap-1 rounded-full border-transparent bg-warning/15 text-warning hover:bg-warning/15">
          <ShieldAlert className="h-3 w-3" aria-hidden="true" />
          Important
        </Badge>
      )}
      {a.expire_at && (
        <Badge variant="outline" className="gap-1 rounded-full text-[11px]">
          <Clock3 className="h-3 w-3" aria-hidden="true" />
          Expires {formatDistanceToNow(new Date(a.expire_at), { addSuffix: true })}
        </Badge>
      )}
      {a.attachment_url && (
        <Badge variant="outline" className="gap-1 rounded-full text-[11px]">
          <Paperclip className="h-3 w-3" aria-hidden="true" />
          Attachment
        </Badge>
      )}
    </div>
  );

  if (!memberLoading && !member) {
    return (
      <AppLayout>
        <div className="flex min-h-[50vh] items-center justify-center px-4">
          <Card className="w-full max-w-lg rounded-2xl border-border/60 shadow-lg">
            <CardContent className="space-y-4 p-8 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-warning/10">
                <AlertCircle className="h-7 w-7 text-warning" aria-hidden="true" />
              </div>
              <h1 className="text-xl font-bold">No member profile found</h1>
              <p className="text-sm text-muted-foreground">
                Your account is not linked to a member profile yet. Please contact the front desk.
              </p>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-5 pb-6 px-4 sm:px-0">
        {/* Hero */}
        <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary to-accent p-6 text-primary-foreground shadow-lg shadow-primary/20 sm:p-7">
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary-foreground/10 blur-2xl" aria-hidden="true" />
          <div className="relative space-y-4">
            <span className="inline-flex items-center gap-2 rounded-full bg-primary-foreground/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider backdrop-blur">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Live bulletin
            </span>
            <div className="space-y-1.5">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Announcements</h1>
              <p className="text-sm text-primary-foreground/80">
                Updates, notices and news for {branchName}.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:max-w-md">
              {[
                { label: 'Live', value: announcements.length },
                { label: 'Important', value: importantCount },
                { label: 'Expiring', value: expiringSoonCount },
              ].map((s) => (
                <div key={s.label} className="rounded-xl bg-primary-foreground/10 px-3 py-2 backdrop-blur-sm">
                  <p className="text-[10px] uppercase tracking-wider text-primary-foreground/70">{s.label}</p>
                  <p className="text-xl font-bold tabular-nums">{s.value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Filters */}
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList className="rounded-xl">
            <TabsTrigger value="all" className="rounded-lg text-xs">All</TabsTrigger>
            <TabsTrigger value="important" className="rounded-lg text-xs">Important</TabsTrigger>
            <TabsTrigger value="expiring" className="rounded-lg text-xs">Expiring soon</TabsTrigger>
          </TabsList>
        </Tabs>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="rounded-2xl border-border/60">
                <CardContent className="flex gap-4 p-5">
                  <Skeleton className="h-12 w-12 rounded-2xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Card className="rounded-2xl border-border/60 shadow-lg shadow-primary/5">
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
                <Megaphone className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
              </span>
              <h2 className="text-lg font-semibold">
                {filter === 'all' ? 'Nothing posted yet' : 'No announcements in this filter'}
              </h2>
              <p className="max-w-sm text-sm text-muted-foreground">
                When the team shares a notice it will appear here instantly — class changes, branch news and member updates.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {/* Featured */}
            <Card className="overflow-hidden rounded-2xl border-border/60 shadow-lg shadow-primary/5">
              <div className="h-1 bg-gradient-to-r from-primary via-accent to-warning" aria-hidden="true" />
              <CardContent className="space-y-4 p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Latest notice</p>
                    <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{featured.title}</h2>
                    <p className="text-sm text-muted-foreground">
                      {format(new Date(featured.created_at), 'EEEE, dd MMM yyyy • HH:mm')}
                    </p>
                  </div>
                  {metaBadges(featured)}
                </div>
                <p className="whitespace-pre-wrap text-sm leading-7 text-foreground/85">{featured.content}</p>
                <AnnouncementAttachment
                  url={(featured as any).attachment_url}
                  kind={(featured as any).attachment_kind}
                  filename={(featured as any).attachment_filename}
                />
              </CardContent>
            </Card>

            {/* Feed */}
            {rest.length > 0 && (
              <ul className="space-y-3">
                {rest.map((a: any) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setActive(a)}
                      className="w-full cursor-pointer rounded-2xl border border-border/60 bg-card p-4 text-left shadow-sm transition-all duration-200 hover:shadow-lg hover:shadow-primary/10 focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <div className="flex items-start gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                          <Megaphone className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <p className="truncate text-sm font-semibold">{a.title}</p>
                          <p className="line-clamp-2 text-sm text-muted-foreground">{a.content}</p>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                            </span>
                            {metaBadges(a)}
                          </div>
                        </div>
                        <ChevronRight className="mt-3 h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Detail drawer */}
      <Sheet open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
          <SheetHeader className="border-b border-border/60 px-6 py-4 text-left">
            <SheetTitle>{active?.title || 'Announcement'}</SheetTitle>
            <SheetDescription>
              {active ? format(new Date(active.created_at), 'EEEE, dd MMM yyyy • HH:mm') : ''}
            </SheetDescription>
          </SheetHeader>
          {active && (
            <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
              {metaBadges(active)}
              <p className="whitespace-pre-wrap text-sm leading-7 text-foreground/85">{active.content}</p>
              <AnnouncementAttachment
                url={active.attachment_url}
                kind={active.attachment_kind}
                filename={active.attachment_filename}
              />
              {active.expire_at && (
                <p className="text-xs text-muted-foreground">
                  Valid until {format(new Date(active.expire_at), 'dd MMM yyyy')}
                </p>
              )}
            </div>
          )}
          <div className="border-t border-border/60 px-6 py-4">
            <Button variant="outline" className="w-full rounded-xl" onClick={() => setActive(null)}>
              Close
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </AppLayout>
  );
}
