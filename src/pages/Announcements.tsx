import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Megaphone, Trash2, Radio, Activity, AlertCircle, Sparkles, Rocket, Instagram } from 'lucide-react';
import { IgAutomationsPanel } from '@/components/ig-automations/IgAutomationsPanel';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { communicationService } from '@/services/communicationService';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { BroadcastDrawer } from '@/components/announcements/BroadcastDrawer';
import { AnnouncementAttachment } from '@/components/announcements/AnnouncementAttachment';
import { useBranchContext } from '@/contexts/BranchContext';
import { LiveFeed } from '@/components/communications/LiveFeed';
import { RetryQueuePanel } from '@/components/communications/RetryQueuePanel';
import { CampaignsPanel } from '@/components/campaigns/CampaignsPanel';
import { Link, useSearchParams } from 'react-router-dom';

export default function AnnouncementsPage() {
  const queryClient = useQueryClient();
  const { effectiveBranchId: defaultBranchId = '' } = useBranchContext();
  const [showBroadcastDrawer, setShowBroadcastDrawer] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'live';
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    const t = searchParams.get('tab');
    if (t && t !== activeTab) setActiveTab(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleTabChange = (v: string) => {
    setActiveTab(v);
    setSearchParams({ tab: v }, { replace: true });
  };

  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ['announcements'],
    queryFn: () => communicationService.fetchAnnouncements(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => communicationService.deleteAnnouncement(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
      toast.success('Announcement deleted');
    },
  });

  return (
    <AppLayout>
      <div className="space-y-6 p-4 sm:p-6">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="p-3 rounded-2xl bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 text-white shadow-lg shadow-indigo-500/30">
              <Radio className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                Communication Hub
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                One source of truth for every WhatsApp, SMS, Email and in-app message · live delivery tracking · retry queue
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" className="rounded-xl gap-2">
              <Link to="/settings?tab=templates">
                <Sparkles className="h-4 w-4" />Templates
              </Link>
            </Button>
            <Button onClick={() => setShowBroadcastDrawer(true)} className="gap-2 rounded-xl shadow-lg shadow-primary/20">
              <Plus className="h-4 w-4" />New Announcement
            </Button>
          </div>
        </div>

        {/* Main Tabs */}
        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
          <TabsList className="bg-muted/50 rounded-xl p-1 h-auto flex-wrap">
            <TabsTrigger value="live" className="rounded-lg gap-2 data-[state=active]:shadow-md">
              <Activity className="h-3.5 w-3.5" />Live Feed
            </TabsTrigger>
            <TabsTrigger value="announcements" className="rounded-lg gap-2 data-[state=active]:shadow-md">
              <Megaphone className="h-3.5 w-3.5" />Announcements
              <Badge variant="secondary" className="rounded-full text-[10px] h-4 px-1.5">{announcements.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="campaigns" className="rounded-lg gap-2 data-[state=active]:shadow-md">
              <Rocket className="h-3.5 w-3.5" />Campaigns
            </TabsTrigger>
            <TabsTrigger value="instagram" className="rounded-lg gap-2 data-[state=active]:shadow-md">
              <Instagram className="h-3.5 w-3.5 text-pink-500" />IG Comment-to-DM
            </TabsTrigger>
            <TabsTrigger value="retry" className="rounded-lg gap-2 data-[state=active]:shadow-md">
              <AlertCircle className="h-3.5 w-3.5" />Retry Queue
            </TabsTrigger>
          </TabsList>

          <TabsContent value="live" className="mt-0 animate-fade-in">
            <LiveFeed branchId={defaultBranchId || undefined} />
          </TabsContent>

          <TabsContent value="announcements" className="mt-0 animate-fade-in">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : announcements.length === 0 ? (
              <Card className="rounded-2xl shadow-lg border-border/50">
                <CardContent className="py-16 text-center">
                  <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center mb-4">
                    <Megaphone className="h-8 w-8 text-primary/50" />
                  </div>
                  <h3 className="font-semibold text-lg mb-1">No Announcements</h3>
                  <p className="text-sm text-muted-foreground mb-4">Create your first announcement to notify members</p>
                  <Button onClick={() => setShowBroadcastDrawer(true)} className="gap-2 rounded-xl">
                    <Plus className="h-4 w-4" />New Announcement
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3">
                {announcements.map((announcement: any, i: number) => (
                  <Card
                    key={announcement.id}
                    style={{ animationDelay: `${i * 30}ms` }}
                    className="animate-fade-in rounded-2xl border-border/50 shadow-md hover:shadow-xl hover:-translate-y-0.5 transition-all"
                  >
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-4 flex-1">
                          <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-violet-500/15 to-indigo-500/10 flex items-center justify-center flex-shrink-0">
                            <Megaphone className="h-5 w-5 text-violet-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-bold text-foreground">{announcement.title}</h3>
                            <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap line-clamp-3">
                              {announcement.content}
                            </p>
                            {(announcement as any).attachment_url && (
                              <div className="mt-2 max-w-xs">
                                <AnnouncementAttachment
                                  url={(announcement as any).attachment_url}
                                  kind={(announcement as any).attachment_kind}
                                  filename={(announcement as any).attachment_filename}
                                  compact
                                />
                              </div>
                            )}
                            <div className="flex items-center gap-2 mt-3 flex-wrap">
                              <Badge variant="outline" className="rounded-full text-xs">
                                {announcement.target_audience || 'All'}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {formatDistanceToNow(new Date(announcement.created_at), { addSuffix: true })}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                          <Badge className={`rounded-full ${announcement.is_active ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30' : 'bg-muted text-muted-foreground'}`}>
                            {announcement.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                          <Button size="icon" variant="ghost" className="rounded-xl" onClick={() => deleteMutation.mutate(announcement.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="campaigns" className="mt-0 animate-fade-in">
            <CampaignsPanel />
          </TabsContent>

          <TabsContent value="retry" className="mt-0 animate-fade-in">
            <RetryQueuePanel />
          </TabsContent>
        </Tabs>
      </div>

      <BroadcastDrawer
        open={showBroadcastDrawer}
        onOpenChange={setShowBroadcastDrawer}
        branchId={defaultBranchId}
        initialType="inapp"
        initialMessage=""
      />
    </AppLayout>
  );
}
