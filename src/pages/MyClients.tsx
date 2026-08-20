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
import { MarkPtStatusMenu } from '@/components/pt/MarkPtStatusMenu';

export default function MyClients() {
  const { trainer, generalClients, ptClients, isLoading: trainerLoading } = useTrainerData();
  const [measurementDrawer, setMeasurementDrawer] = useState<{ open: boolean; memberId: string; memberName: string }>({ open: false, memberId: '', memberName: '' });
  const [progressDrawer, setProgressDrawer] = useState<{ open: boolean; memberId: string; memberName: string }>({ open: false, memberId: '', memberName: '' });

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

          {/* PT Clients — TanStack-style progress table */}
          <TabsContent value="pt" className="mt-4">
            {ptClients.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Dumbbell className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No active PT clients</p>
                </CardContent>
              </Card>
            ) : (
              <Card className="rounded-2xl border-border/50 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/60 backdrop-blur text-xs uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="text-left font-semibold px-4 py-3">Member</th>
                        <th className="text-left font-semibold px-4 py-3">Plan</th>
                        <th className="text-left font-semibold px-4 py-3 min-w-[220px]">Progress</th>
                        <th className="text-right font-semibold px-4 py-3">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {ptClients.map((client: any) => {
                        const clientName = client.member?.profile?.full_name || client.member?.member_code || 'Unknown';
                        const pkgType = (client.package_type ?? client.package?.package_type ?? 'session_based') as 'session_based' | 'monthly';
                        const stats = sessionStats[client.member_id] || { completed: 0, total: 0 };
                        const remaining = typeof client.sessions_remaining === 'number' ? client.sessions_remaining : null;
                        const total = client.sessions_total ?? null;
                        const used = remaining !== null && total !== null ? Math.max(0, total - remaining) : stats.completed;
                        const pct = total ? Math.min(100, Math.round((used / total) * 100)) : 0;
                        const daysLeft = client.expiry_date
                          ? Math.ceil((new Date(client.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                          : null;

                        return (
                          <tr key={client.id} className="hover:bg-muted/40 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <Avatar className="h-9 w-9 shrink-0">
                                  <AvatarImage src={client.member?.profile?.avatar_url} />
                                  <AvatarFallback>{clientName.charAt(0)}</AvatarFallback>
                                </Avatar>
                                <div className="min-w-0">
                                  <p className="font-medium truncate">{clientName}</p>
                                  <p className="text-xs text-muted-foreground truncate">{client.member?.member_code}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-col">
                                <span className="font-medium truncate max-w-[180px]">{client.package?.name}</span>
                                <Badge variant="outline" className="text-[10px] mt-1 w-fit">
                                  {pkgType === 'monthly' ? 'Monthly' : 'Sessions'}
                                </Badge>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              {pkgType === 'session_based' && total ? (
                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="font-medium">{used} / {total} sessions</span>
                                    <span className="text-muted-foreground">{remaining ?? 0} left</span>
                                  </div>
                                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                                    <div
                                      className="h-full bg-primary transition-all duration-300"
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <Calendar className="h-4 w-4 text-muted-foreground" />
                                  <span className="text-xs">
                                    Expires {client.expiry_date ? format(new Date(client.expiry_date), 'dd MMM yyyy') : '—'}
                                  </span>
                                  {daysLeft !== null && (
                                    <Badge variant={daysLeft <= 7 ? 'destructive' : 'secondary'} className="text-[10px]">
                                      {daysLeft > 0 ? `${daysLeft}d left` : 'Expired'}
                                    </Badge>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setMeasurementDrawer({ open: true, memberId: client.member_id, memberName: clientName })}
                                >
                                  <Ruler className="h-4 w-4 mr-1" />
                                  Record
                                </Button>
                                <MarkPtStatusMenu
                                  memberPackageId={client.id}
                                  trainerId={trainer!.id}
                                  memberName={clientName}
                                />
                                <Button variant="ghost" size="sm" asChild title="View in Coaching Studio">
                                  <Link to={`/pt-sessions?member=${client.member_id}`}>
                                    <Eye className="h-4 w-4" />
                                  </Link>
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
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
