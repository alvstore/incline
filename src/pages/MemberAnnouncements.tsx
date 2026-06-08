import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Megaphone, AlertCircle, Loader2, Sparkles, Clock3, ShieldAlert, ArrowUpRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useMemberData } from '@/hooks/useMemberData';
import { format, formatDistanceToNow } from 'date-fns';
import { AnnouncementAttachment } from '@/components/announcements/AnnouncementAttachment';

export default function MemberAnnouncements() {
  const { member, isLoading: memberLoading } = useMemberData();
  const branchName = member?.branch?.name || 'your branch';

  // Fetch active announcements for members
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

  const featuredAnnouncement = announcements[0];
  const remainingAnnouncements = announcements.slice(1);
  const importantCount = announcements.filter((announcement: any) => Number(announcement.priority) > 0).length;
  const expiringSoonCount = announcements.filter((announcement: any) => {
    if (!announcement.expire_at) return false;
    const expiry = new Date(announcement.expire_at).getTime();
    return expiry > Date.now() && expiry - Date.now() < 7 * 24 * 60 * 60 * 1000;
  }).length;

  const isLoading = memberLoading || announcementsLoading;

  const renderAnnouncementBadges = (announcement: any) => (
    <div className="flex flex-wrap items-center gap-2">
      {Number(announcement.priority) > 0 && (
        <Badge className="rounded-full border-transparent bg-warning/15 text-warning dark:text-warning hover:bg-warning/15 gap-1.5">
          <ShieldAlert className="h-3 w-3" />
          Important
        </Badge>
      )}
      <Badge variant="outline" className="rounded-full bg-background/60 text-xs capitalize">
        {(announcement.target_audience || 'all').replace('_', ' ')}
      </Badge>
      {announcement.expire_at && (
        <Badge variant="outline" className="rounded-full bg-background/60 text-xs gap-1">
          <Clock3 className="h-3 w-3" />
          Expires {formatDistanceToNow(new Date(announcement.expire_at), { addSuffix: true })}
        </Badge>
      )}
    </div>
  );

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[50vh] px-4">
          <div className="flex items-center gap-3 rounded-full border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
            Loading announcements
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!member) {
    return (
      <AppLayout>
        <div className="flex min-h-[50vh] items-center justify-center px-4">
          <Card className="w-full max-w-lg border-border/60 bg-card/90 shadow-xl">
            <CardContent className="space-y-5 p-8 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-warning/10">
                <AlertCircle className="h-8 w-8 text-warning" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-tight">No member profile found</h2>
                <p className="text-sm text-muted-foreground">
                  Your account is not linked to a member profile yet. Please contact the front desk so they can connect your profile.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6 pb-6">
        <section className="relative overflow-hidden rounded-[2rem] border border-border/60 bg-gradient-to-br from-muted via-muted to-muted text-primary-foreground shadow-2xl shadow/20">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(249,115,22,0.22),_transparent_34%),radial-gradient(circle_at_bottom_left,_rgba(255,255,255,0.08),_transparent_28%)]" />
          <div className="relative grid gap-8 p-6 md:p-8 lg:grid-cols-[1.35fr_0.85fr] lg:p-10">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary-foreground/15 bg-card/10 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.22em] text-primary-foreground/80 backdrop-blur">
                <Sparkles className="h-3.5 w-3.5 text-warning" />
                Live bulletin
              </div>
              <div className="space-y-3">
                <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance md:text-4xl lg:text-5xl">
                  Announcements for {branchName}
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-primary-foreground/72 md:text-base">
                  Read the latest updates, urgent notices, and branch-wide messages in one clean feed.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge className="rounded-full border-primary-foreground/15 bg-card/10 px-3 py-1 text-primary-foreground hover:bg-card/15">
                  {announcements.length} live updates
                </Badge>
                <Badge className="rounded-full border-primary-foreground/15 bg-card/10 px-3 py-1 text-primary-foreground hover:bg-card/15">
                  {importantCount} important
                </Badge>
                <Badge className="rounded-full border-primary-foreground/15 bg-card/10 px-3 py-1 text-primary-foreground hover:bg-card/15">
                  {expiringSoonCount} expiring soon
                </Badge>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <div className="rounded-2xl border border-primary-foreground/10 bg-card/10 p-4 backdrop-blur-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-primary-foreground/55">Visible now</p>
                <div className="mt-2 text-3xl font-semibold tabular-nums">{announcements.length}</div>
                <p className="mt-1 text-sm text-primary-foreground/65">messages for members</p>
              </div>
              <div className="rounded-2xl border border-primary-foreground/10 bg-card/10 p-4 backdrop-blur-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-primary-foreground/55">Priority</p>
                <div className="mt-2 text-3xl font-semibold tabular-nums">{importantCount}</div>
                <p className="mt-1 text-sm text-primary-foreground/65">urgent or important notices</p>
              </div>
              <div className="rounded-2xl border border-primary-foreground/10 bg-card/10 p-4 backdrop-blur-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-primary-foreground/55">Branch</p>
                <div className="mt-2 text-lg font-semibold leading-tight">{branchName}</div>
                <p className="mt-1 text-sm text-primary-foreground/65">personalized for your membership</p>
              </div>
            </div>
          </div>
        </section>

        {announcements.length === 0 ? (
          <Card className="overflow-hidden border-border/60 bg-card/90 shadow-xl shadow/5">
            <CardContent className="grid gap-6 p-8 md:grid-cols-[0.75fr_1.25fr] md:p-10">
              <div className="flex items-center justify-center rounded-[1.75rem] border border-dashed border-border bg-muted/30 p-10">
                <div className="flex h-20 w-20 items-center justify-center rounded-[1.75rem] bg-gradient-to-br from-muted to-muted text-primary-foreground shadow-lg">
                  <Megaphone className="h-9 w-9" />
                </div>
              </div>
              <div className="space-y-4 self-center">
                <div className="inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
                  <Sparkles className="h-3.5 w-3.5" />
                  Nothing new yet
                </div>
                <h3 className="text-2xl font-semibold tracking-tight">Your gym has not posted an update yet.</h3>
                <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                  When the team shares a notice, it will appear here immediately. Check back soon for class reminders, schedule changes, and branch news.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Badge variant="outline" className="rounded-full">Branch updates</Badge>
                  <Badge variant="outline" className="rounded-full">Class changes</Badge>
                  <Badge variant="outline" className="rounded-full">Member notices</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {featuredAnnouncement && (
              <Card className="overflow-hidden border-border/60 bg-card shadow-xl shadow/5">
                <div className="h-1 bg-gradient-to-r from-muted via-accent to-warning" />
                <CardHeader className="space-y-4 p-6 md:p-7">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 text-accent">
                          <Megaphone className="h-4 w-4" />
                        </span>
                        Featured notice
                      </div>
                      <CardTitle className="text-2xl tracking-tight md:text-3xl">{featuredAnnouncement.title}</CardTitle>
                      <p className="max-w-3xl text-sm leading-6 text-muted-foreground md:text-base">
                        {format(new Date(featuredAnnouncement.created_at), 'EEEE, dd MMM yyyy • HH:mm')}
                      </p>
                    </div>
                    {Number(featuredAnnouncement.priority) > 0 ? (
                      <Badge className="rounded-full bg-warning/15 text-warning hover:bg-warning/15 dark:text-warning">
                        Important
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="rounded-full bg-muted/30">
                        Latest
                      </Badge>
                    )}
                  </div>
                  {renderAnnouncementBadges(featuredAnnouncement)}
                </CardHeader>
                <CardContent className="grid gap-6 border-t border-border/60 p-6 md:grid-cols-[1.35fr_0.65fr] md:p-7">
                  <div className="space-y-4">
                    <p className="whitespace-pre-wrap text-sm leading-7 text-foreground/85 md:text-[15px]">
                      {featuredAnnouncement.content}
                    </p>
                    <AnnouncementAttachment
                      url={(featuredAnnouncement as any).attachment_url}
                      kind={(featuredAnnouncement as any).attachment_kind}
                      filename={(featuredAnnouncement as any).attachment_filename}
                    />
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <ArrowUpRight className="h-4 w-4" />
                      Added {formatDistanceToNow(new Date(featuredAnnouncement.created_at), { addSuffix: true })}
                    </div>
                  </div>
                  <div className="grid gap-3 rounded-[1.5rem] border border-border/60 bg-muted/20 p-4">
                    <div className="rounded-2xl bg-background/80 p-4 shadow-sm">
                      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Audience</p>
                      <p className="mt-2 text-sm font-medium capitalize">{(featuredAnnouncement.target_audience || 'all').replace('_', ' ')}</p>
                    </div>
                    <div className="rounded-2xl bg-background/80 p-4 shadow-sm">
                      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Posted</p>
                      <p className="mt-2 text-sm font-medium">{format(new Date(featuredAnnouncement.created_at), 'dd MMM yyyy')}</p>
                    </div>
                    {featuredAnnouncement.expire_at && (
                      <div className="rounded-2xl bg-background/80 p-4 shadow-sm">
                        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Valid until</p>
                        <p className="mt-2 text-sm font-medium">{format(new Date(featuredAnnouncement.expire_at), 'dd MMM yyyy')}</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {remainingAnnouncements.length > 0 && (
              <div className="grid gap-4">
                {remainingAnnouncements.map((announcement: any, index: number) => (
                  <Card
                    key={announcement.id}
                    className="overflow-hidden border-border/60 bg-card/95 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
                    style={{ animationDelay: `${index * 45}ms` }}
                  >
                    <CardContent className="p-5 md:p-6">
                      <div className="flex items-start gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-muted to-muted text-primary-foreground shadow-sm">
                          <Megaphone className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1 space-y-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-1">
                              <h3 className="text-lg font-semibold tracking-tight">{announcement.title}</h3>
                              <p className="text-sm text-muted-foreground">
                                {format(new Date(announcement.created_at), 'EEEE, dd MMM yyyy • HH:mm')}
                              </p>
                            </div>
                            {Number(announcement.priority) > 0 ? (
                              <Badge className="rounded-full bg-warning/15 text-warning hover:bg-warning/15 dark:text-warning">
                                Important
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="rounded-full">
                                Update
                              </Badge>
                            )}
                          </div>
                          {renderAnnouncementBadges(announcement)}
                          <p className="whitespace-pre-wrap text-sm leading-7 text-foreground/85">
                            {announcement.content}
                          </p>
                          <AnnouncementAttachment
                            url={(announcement as any).attachment_url}
                            kind={(announcement as any).attachment_kind}
                            filename={(announcement as any).attachment_filename}
                            compact
                          />
                          {announcement.expire_at && (
                            <p className="text-xs text-muted-foreground">
                              Valid until {format(new Date(announcement.expire_at), 'dd MMM yyyy')}
                            </p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
