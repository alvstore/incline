import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useMemberData } from '@/hooks/useMemberData';
import { PurchasePTPackageDrawer } from '@/components/pt/PurchasePTPackageDrawer';
import { PtStatusHero } from '@/components/member/PtStatusHero';
import { Dumbbell, Calendar, User, AlertCircle, Loader2, CheckCircle, Clock, ShoppingBag } from 'lucide-react';
import { format } from 'date-fns';

export default function MyPTSessions() {
  const { member, ptPackages, isLoading: memberLoading } = useMemberData();
  const [purchaseOpen, setPurchaseOpen] = useState(false);

  // Get member's PT package IDs first
  const ptPackageIds = ptPackages.map(p => p.id);

  // Fetch PT sessions
  const { data: sessions = [], isLoading: sessionsLoading } = useQuery({
    queryKey: ['my-pt-sessions', member?.id, ptPackageIds],
    enabled: !!member && ptPackageIds.length > 0,
    queryFn: async (): Promise<any[]> => {
      const { data, error } = await supabase
        .from('pt_sessions')
        .select('id, scheduled_at, duration_minutes, status, notes, trainer_id, member_pt_package_id')
        .in('member_pt_package_id', ptPackageIds)
        .order('scheduled_at', { ascending: false });

      if (error) throw error;
      
      // Fetch trainer info separately to avoid deep type recursion
      const trainerIds = [...new Set((data || []).map(s => s.trainer_id).filter(Boolean))] as string[];
      const trainersMap: Record<string, { profiles?: { full_name: string } }> = {};
      
      if (trainerIds.length > 0) {
        const { data: trainers } = await (supabase as any)
          .from('trainers_directory')
          .select('id, user_id')
          .in('id', trainerIds);
        
        if (trainers) {
          const userIds = trainers.map(t => t.user_id).filter(Boolean) as string[];
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, full_name')
            .in('id', userIds);
          
          trainers.forEach(t => {
            const profile = profiles?.find(p => p.id === t.user_id);
            trainersMap[t.id] = { profiles: profile || undefined };
          });
        }
      }
      
      return (data || []).map(session => ({
        ...session,
        trainer: trainersMap[session.trainer_id || ''] || null
      }));
    },
  });

  if (memberLoading || sessionsLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  if (!member) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
          <AlertCircle className="h-12 w-12 text-warning" />
          <h2 className="text-xl font-semibold">No Member Profile Found</h2>
        </div>
      </AppLayout>
    );
  }

  const activePackage = ptPackages.find(p => p.status === 'active');
  const upcomingSessions = sessions.filter(s => s.status === 'scheduled' && new Date(s.scheduled_at) >= new Date());
  const completedSessions = sessions.filter(s => s.status === 'completed');

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default" className="bg-success"><CheckCircle className="h-3 w-3 mr-1" />Completed</Badge>;
      case 'scheduled':
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Scheduled</Badge>;
      case 'cancelled':
        return <Badge variant="destructive">Cancelled</Badge>;
      case 'no_show':
        return <Badge variant="destructive">No Show</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">My PT Sessions</h1>
            <p className="text-muted-foreground">Manage your personal training sessions</p>
          </div>
          <Button onClick={() => setPurchaseOpen(true)}>
            <ShoppingBag className="h-4 w-4 mr-2" /> Buy PT Package
          </Button>
        </div>

        {/* Active Package Hero */}
        {activePackage ? (
          <PtStatusHero
            packageType={((activePackage as any).package_type ?? (activePackage.package as any)?.package_type ?? 'session_based') as 'session_based' | 'monthly'}
            packageName={(activePackage.package as any)?.name ?? 'PT Package'}
            trainerName={(activePackage.trainer as any)?.profiles?.full_name ?? null}
            sessionsRemaining={activePackage.sessions_remaining}
            sessionsTotal={activePackage.sessions_total}
            startDate={(activePackage as any).start_date}
            expiryDate={activePackage.expiry_date}
          />
        ) : (
          <Card className="border-border/50 bg-gradient-to-br from-accent/5 to-transparent">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Dumbbell className="h-5 w-5" /> Active PT Package
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-6">
                <Dumbbell className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground mb-2">No active PT package</p>
                <p className="text-sm text-muted-foreground mb-4">Purchase a package to start training</p>
                <Button onClick={() => setPurchaseOpen(true)}>
                  <ShoppingBag className="h-4 w-4 mr-2" /> Buy PT Package
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Sessions Tabs */}
        <Tabs defaultValue="upcoming">
          <TabsList>
            <TabsTrigger value="upcoming">Upcoming ({upcomingSessions.length})</TabsTrigger>
            <TabsTrigger value="completed">Completed ({completedSessions.length})</TabsTrigger>
            <TabsTrigger value="all">All Sessions</TabsTrigger>
          </TabsList>

          <TabsContent value="upcoming" className="space-y-4">
            {upcomingSessions.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No upcoming sessions scheduled</p>
                </CardContent>
              </Card>
            ) : (
              upcomingSessions.map((session: any) => (
                <Card key={session.id} className="border-border/50">
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-accent" />
                          <span className="font-semibold">
                            {format(new Date(session.scheduled_at), 'EEEE, dd MMMM yyyy')}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-4 w-4" />
                            {format(new Date(session.scheduled_at), 'HH:mm')} ({session.duration_minutes} min)
                          </span>
                          <span className="flex items-center gap-1">
                            <User className="h-4 w-4" />
                            {session.trainer?.profiles?.full_name}
                          </span>
                        </div>
                        {session.notes && (
                          <p className="text-sm text-muted-foreground mt-2">{session.notes}</p>
                        )}
                      </div>
                      {getStatusBadge(session.status)}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="completed" className="space-y-4">
            {completedSessions.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <CheckCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No completed sessions yet</p>
                </CardContent>
              </Card>
            ) : (
              completedSessions.map((session: any) => (
                <Card key={session.id} className="border-border/50">
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-success" />
                          <span className="font-semibold">
                            {format(new Date(session.scheduled_at), 'EEEE, dd MMMM yyyy')}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span>{session.trainer?.profiles?.full_name}</span>
                          <span>{session.duration_minutes} min</span>
                        </div>
                        {session.notes && (
                          <p className="text-sm text-muted-foreground mt-2">{session.notes}</p>
                        )}
                      </div>
                      {getStatusBadge(session.status)}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="all" className="space-y-4">
            {sessions.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Dumbbell className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No sessions found</p>
                </CardContent>
              </Card>
            ) : (
              sessions.map((session: any) => (
                <Card key={session.id} className="border-border/50">
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4" />
                          <span className="font-semibold">
                            {format(new Date(session.scheduled_at), 'dd MMM yyyy • HH:mm')}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {session.trainer?.profiles?.full_name} • {session.duration_minutes} min
                        </p>
                      </div>
                      {getStatusBadge(session.status)}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>

      <PurchasePTPackageDrawer
        open={purchaseOpen}
        onOpenChange={setPurchaseOpen}
        memberId={member.id}
        branchId={member.branch_id}
      />
    </AppLayout>
  );
}
