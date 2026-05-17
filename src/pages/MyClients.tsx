import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useTrainerData } from '@/hooks/useMemberData';
import { Users, Phone, Calendar, Dumbbell, AlertCircle, Loader2, TrendingUp, Ruler, Eye, User } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { RecordMeasurementDrawer } from '@/components/members/RecordMeasurementDrawer';
import { MeasurementProgressView } from '@/components/members/MeasurementProgressView';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { logPtSession } from '@/services/ptService';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2 } from 'lucide-react';

export default function MyClients() {
  const { trainer, generalClients, ptClients, isLoading: trainerLoading } = useTrainerData();
  const [measurementDrawer, setMeasurementDrawer] = useState<{ open: boolean; memberId: string; memberName: string }>({ open: false, memberId: '', memberName: '' });
  const [progressDrawer, setProgressDrawer] = useState<{ open: boolean; memberId: string; memberName: string }>({ open: false, memberId: '', memberName: '' });
  const queryClient = useQueryClient();

  const markAttended = useMutation({
    mutationFn: async (vars: { packageId: string; trainerId: string }) =>
      logPtSession({ memberPackageId: vars.packageId, trainerId: vars.trainerId }),
    onSuccess: (res: any) => {
      const left = res?.sessions_remaining;
      toast.success(
        res?.package_type === 'session_based'
          ? `Logged · ${left ?? 0} sessions left`
          : 'Session logged for monthly plan',
        { description: res?.gym_check_in_created ? 'Gym check-in created' : 'Already checked in today' }
      );
      queryClient.invalidateQueries({ queryKey: ['trainer-pt-clients'] });
      queryClient.invalidateQueries({ queryKey: ['client-session-stats'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Could not log session'),
  });

  // Get session history for PT clients
  const { data: sessionStats = {} } = useQuery({
    queryKey: ['client-session-stats', trainer?.id],
    enabled: !!trainer && ptClients.length > 0,
    queryFn: async (): Promise<Record<string, { completed: number; total: number }>> => {
      const packageIds = ptClients.map((c: { id: string }) => c.id);
      const { data, error } = await supabase
        .from('pt_sessions')
        .select('member_pt_package_id, status')
        .eq('trainer_id', trainer!.id)
        .in('member_pt_package_id', packageIds);
      if (error) throw error;

      const packageToMember: Record<string, string> = {};
      ptClients.forEach((c: { id: string; member_id: string }) => { packageToMember[c.id] = c.member_id; });

      const stats: Record<string, { completed: number; total: number }> = {};
      (data || []).forEach((session) => {
        const memberId = packageToMember[session.member_pt_package_id];
        if (!memberId) return;
        if (!stats[memberId]) stats[memberId] = { completed: 0, total: 0 };
        stats[memberId].total++;
        if (session.status === 'completed') stats[memberId].completed++;
      });
      return stats;
    },
  });

  if (trainerLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  if (!trainer) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
          <AlertCircle className="h-12 w-12 text-warning" />
          <h2 className="text-xl font-semibold">No Trainer Profile Found</h2>
        </div>
      </AppLayout>
    );
  }

  const totalClients = generalClients.length + ptClients.length;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Clients</h1>
          <p className="text-muted-foreground">Manage your general training and personal training clients</p>
        </div>

        {/* Summary Stats */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-border/50">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-full bg-accent/10">
                  <Users className="h-6 w-6 text-accent" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Clients</p>
                  <p className="text-2xl font-bold">{totalClients}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-full bg-primary/10">
                  <User className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">General Training</p>
                  <p className="text-2xl font-bold">{generalClients.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-full bg-warning/10">
                  <Dumbbell className="h-6 w-6 text-warning" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Personal Training</p>
                  <p className="text-2xl font-bold">{ptClients.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="general">
          <TabsList>
            <TabsTrigger value="general" className="gap-2">
              <User className="h-4 w-4" />
              General Clients ({generalClients.length})
            </TabsTrigger>
            <TabsTrigger value="pt" className="gap-2">
              <Dumbbell className="h-4 w-4" />
              PT Clients ({ptClients.length})
            </TabsTrigger>
          </TabsList>

          {/* General Training Clients */}
          <TabsContent value="general" className="mt-4">
            {generalClients.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No general training clients assigned</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {generalClients.map((client: any) => {
                  const clientName = client.profile?.full_name || client.member_code || 'Unknown';
                  return (
                    <Card key={client.id} className="border-border/50">
                      <CardContent className="pt-6">
                        <div className="flex items-start gap-4">
                          <Avatar className="h-14 w-14">
                            <AvatarImage src={client.profile?.avatar_url} />
                            <AvatarFallback>{clientName.charAt(0)}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1">
                            <div className="flex items-start justify-between">
                              <div>
                                <h3 className="font-semibold">{clientName}</h3>
                                <p className="text-sm text-muted-foreground">{client.member_code}</p>
                              </div>
                              <Badge variant="default">General</Badge>
                            </div>
                            {client.fitness_goals && (
                              <p className="text-sm text-muted-foreground mt-2">Goal: {client.fitness_goals}</p>
                            )}
                            {client.profile?.phone && (
                              <div className="flex items-center gap-2 mt-3 text-sm text-muted-foreground">
                                <Phone className="h-4 w-4" />
                                <span>{client.profile.phone}</span>
                              </div>
                            )}
                            <div className="flex flex-wrap gap-2 mt-4">
                              <Button variant="outline" size="sm" asChild>
                                <Link to="/trainer-plan-builder">
                                  <Dumbbell className="h-4 w-4 mr-1" />
                                  Create Plan
                                </Link>
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setMeasurementDrawer({ open: true, memberId: client.id, memberName: clientName })}
                              >
                                <Ruler className="h-4 w-4 mr-1" />
                                Record Progress
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setProgressDrawer({ open: true, memberId: client.id, memberName: clientName })}
                              >
                                <Eye className="h-4 w-4 mr-1" />
                                View Progress
                              </Button>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* PT Clients */}
          <TabsContent value="pt" className="mt-4">
            {ptClients.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Dumbbell className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No active PT clients</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {ptClients.map((client: any) => {
                  const daysLeft = Math.ceil((new Date(client.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                  const stats = sessionStats[client.member_id] || { completed: 0, total: 0 };
                  const clientName = client.member?.profile?.full_name || client.member?.member_code || 'Unknown';

                  return (
                    <Card key={client.id} className="border-border/50">
                      <CardContent className="pt-6">
                        <div className="flex items-start gap-4">
                          <Avatar className="h-14 w-14">
                            <AvatarImage src={client.member?.profile?.avatar_url} />
                            <AvatarFallback>{clientName.charAt(0)}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1">
                            <div className="flex items-start justify-between">
                              <div>
                                <h3 className="font-semibold">{clientName}</h3>
                                <p className="text-sm text-muted-foreground">{client.member?.member_code}</p>
                              </div>
                              <Badge variant={daysLeft <= 7 ? 'destructive' : 'secondary'}>
                                {daysLeft > 0 ? `${daysLeft} days left` : 'Expired'}
                              </Badge>
                            </div>

                            <div className="grid grid-cols-2 gap-4 mt-4">
                              <div>
                                <p className="text-sm text-muted-foreground">Package</p>
                                <p className="font-medium">{client.package?.name}</p>
                              </div>
                              <div>
                                <p className="text-sm text-muted-foreground">Sessions</p>
                                <p className="font-medium">{client.sessions_remaining} of {client.sessions_total}</p>
                              </div>
                              <div>
                                <p className="text-sm text-muted-foreground">Completed</p>
                                <p className="font-medium">{stats.completed} sessions</p>
                              </div>
                              <div>
                                <p className="text-sm text-muted-foreground">Expires</p>
                                <p className="font-medium">{format(new Date(client.expiry_date), 'dd MMM yyyy')}</p>
                              </div>
                            </div>

                            {client.member?.profile?.phone && (
                              <div className="flex items-center gap-2 mt-4 text-sm text-muted-foreground">
                                <Phone className="h-4 w-4" />
                                <span>{client.member.profile.phone}</span>
                              </div>
                            )}

                            <div className="flex flex-wrap gap-2 mt-4">
                              <Button
                                size="sm"
                                disabled={markAttended.isPending}
                                onClick={() => markAttended.mutate({ packageId: client.id, trainerId: trainer!.id })}
                              >
                                <CheckCircle2 className="h-4 w-4 mr-1" />
                                Mark Attended
                              </Button>
                              <Button variant="outline" size="sm" asChild>
                                <Link to={`/pt-sessions?member=${client.member_id}`}>
                                  <Calendar className="h-4 w-4 mr-1" />
                                  Sessions
                                </Link>
                              </Button>
                              <Button variant="outline" size="sm" asChild>
                                <Link to="/trainer-plan-builder">
                                  <Dumbbell className="h-4 w-4 mr-1" />
                                  Create Plan
                                </Link>
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setMeasurementDrawer({ open: true, memberId: client.member_id, memberName: clientName })}
                              >
                                <Ruler className="h-4 w-4 mr-1" />
                                Record Progress
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setProgressDrawer({ open: true, memberId: client.member_id, memberName: clientName })}
                              >
                                <Eye className="h-4 w-4 mr-1" />
                                View Progress
                              </Button>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Record Measurement Drawer */}
      <RecordMeasurementDrawer
        open={measurementDrawer.open}
        onOpenChange={(open) => setMeasurementDrawer(prev => ({ ...prev, open }))}
        memberId={measurementDrawer.memberId}
        memberName={measurementDrawer.memberName}
      />

      {/* View Progress Drawer */}
      <Sheet open={progressDrawer.open} onOpenChange={(open) => setProgressDrawer(prev => ({ ...prev, open }))}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Progress — {progressDrawer.memberName}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-6">
            {progressDrawer.memberId && (
              <MeasurementProgressView memberId={progressDrawer.memberId} />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </AppLayout>
  );
}
