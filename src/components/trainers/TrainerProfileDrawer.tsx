import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Mail, Phone, Award, Users, Calendar, DollarSign, 
  Clock, Star, TrendingUp, UserMinus, User
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

interface TrainerProfileDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trainer: any;
  onDeactivate?: (trainerId: string) => void;
}

export function TrainerProfileDrawer({ open, onOpenChange, trainer, onDeactivate }: TrainerProfileDrawerProps) {
  const [activeTab, setActiveTab] = useState('overview');

  // Fetch PT clients
  const { data: ptClients = [] } = useQuery({
    queryKey: ['trainer-pt-clients', trainer?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_pt_packages')
        .select(`*, member:member_id (id, member_code, profiles:user_id (full_name, avatar_url)), package:package_id (name, total_sessions)`)
        .eq('trainer_id', trainer.id)
        .eq('status', 'active');
      if (error) throw error;
      return data || [];
    },
    enabled: !!trainer?.id && open,
  });

  // Fetch General Clients (members assigned to this trainer)
  const { data: generalClients = [] } = useQuery({
    queryKey: ['trainer-general-clients', trainer?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('members')
        .select(`id, member_code, status, profiles:user_id (full_name, avatar_url, phone)`)
        .eq('assigned_trainer_id', trainer.id)
        .eq('status', 'active');
      if (error) throw error;
      return data || [];
    },
    enabled: !!trainer?.id && open,
  });

  // Fetch recent PT sessions
  const { data: recentSessions = [] } = useQuery({
    queryKey: ['trainer-sessions', trainer?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pt_sessions')
        .select(`*, member_pt_packages!inner(member_id, members!inner(member_code, profiles:user_id(full_name)))`)
        .eq('trainer_id', trainer.id)
        .order('scheduled_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
    enabled: !!trainer?.id && open,
  });

  // Fetch trainer revenue
  const { data: revenue = { total: 0, thisMonth: 0 } } = useQuery({
    queryKey: ['trainer-revenue', trainer?.id],
    queryFn: async () => {
      const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
      const { data: commissions, error } = await supabase.from('trainer_commissions').select('amount, created_at').eq('trainer_id', trainer.id);
      if (error) throw error;
      const total = (commissions || []).reduce((sum, c) => sum + (c.amount || 0), 0);
      const thisMonth = (commissions || []).filter(c => new Date(c.created_at) >= startOfMonth).reduce((sum, c) => sum + (c.amount || 0), 0);
      return { total, thisMonth };
    },
    enabled: !!trainer?.id && open,
  });

  if (!trainer) return null;

  const activePTClients = ptClients.length;
  const maxClients = trainer.max_clients || 10;
  const utilization = Math.min((activePTClients / maxClients) * 100, 100);
  const completedSessions = recentSessions.filter(s => s.status === 'completed').length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl p-0 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-6 space-y-6">
            <SheetHeader className="space-y-4">
              <div className="flex items-start gap-4">
                <Avatar className="h-20 w-20 border-4 border-accent/20">
                  <AvatarImage src={trainer.profile_avatar || undefined} />
                  <AvatarFallback className="text-2xl bg-accent text-accent-foreground">
                    {(trainer.profile_name || 'T').slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <SheetTitle className="text-2xl">{trainer.profile_name || 'Unknown Trainer'}</SheetTitle>
                    <Badge variant={trainer.is_active ? 'default' : 'secondary'}>{trainer.is_active ? 'Active' : 'Inactive'}</Badge>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{trainer.profile_email}</span>
                    {trainer.profile_phone && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{trainer.profile_phone}</span>}
                  </div>
                  {trainer.specializations?.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {trainer.specializations.map((spec: string, idx: number) => (
                        <Badge key={idx} variant="secondary" className="text-xs">{spec}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </SheetHeader>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card className="border-border/50 rounded-xl"><CardContent className="p-3 text-center"><User className="h-5 w-5 mx-auto text-muted-foreground mb-1" /><p className="text-2xl font-bold">{generalClients.length}</p><p className="text-xs text-muted-foreground">General Clients</p></CardContent></Card>
              <Card className="border-border/50 rounded-xl"><CardContent className="p-3 text-center"><Star className="h-5 w-5 mx-auto text-warning mb-1" /><p className="text-2xl font-bold">{activePTClients}</p><p className="text-xs text-muted-foreground">PT Clients</p></CardContent></Card>
              <Card className="border-border/50 rounded-xl"><CardContent className="p-3 text-center"><DollarSign className="h-5 w-5 mx-auto text-success mb-1" /><p className="text-2xl font-bold">₹{revenue.thisMonth.toLocaleString()}</p><p className="text-xs text-muted-foreground">Revenue (Month)</p></CardContent></Card>
              <Card className="border-border/50 rounded-xl"><CardContent className="p-3 text-center"><TrendingUp className="h-5 w-5 mx-auto text-info mb-1" /><p className="text-2xl font-bold">{utilization.toFixed(0)}%</p><p className="text-xs text-muted-foreground">PT Utilization</p></CardContent></Card>
            </div>

            {/* PT Capacity Bar */}
            <Card className="border-border/50 rounded-xl">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">PT Client Capacity</span>
                  <span className="text-sm text-muted-foreground">{activePTClients}/{maxClients}</span>
                </div>
                <Progress value={utilization} className="h-3" />
                {utilization >= 80 && <p className="text-xs text-warning mt-2">Near full capacity</p>}
              </CardContent>
            </Card>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-4 rounded-xl">
                <TabsTrigger value="overview" className="rounded-lg">Overview</TabsTrigger>
                <TabsTrigger value="general" className="rounded-lg">General ({generalClients.length})</TabsTrigger>
                <TabsTrigger value="clients" className="rounded-lg">PT ({activePTClients})</TabsTrigger>
                <TabsTrigger value="sessions" className="rounded-lg">Sessions</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4 mt-4">
                {trainer.bio && (
                  <Card className="border-border/50 rounded-xl"><CardHeader className="pb-2"><CardTitle className="text-sm">About</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">{trainer.bio}</p></CardContent></Card>
                )}
                {trainer.certifications?.length > 0 && (
                  <Card className="border-border/50 rounded-xl"><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Award className="h-4 w-4" />Certifications</CardTitle></CardHeader><CardContent><div className="flex flex-wrap gap-2">{trainer.certifications.map((cert: string, idx: number) => <Badge key={idx} variant="outline">{cert}</Badge>)}</div></CardContent></Card>
                )}
                <Card className="border-border/50 rounded-xl"><CardHeader className="pb-2"><CardTitle className="text-sm">Details</CardTitle></CardHeader><CardContent className="space-y-2">
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Hourly Rate</span><span className="font-medium">₹{trainer.hourly_rate || 0}/hr</span></div>
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Total Revenue</span><span className="font-medium">₹{revenue.total.toLocaleString()}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Joined</span><span className="font-medium">{format(new Date(trainer.created_at), 'MMM d, yyyy')}</span></div>
                </CardContent></Card>
              </TabsContent>

              {/* General Clients Tab */}
              <TabsContent value="general" className="mt-4">
                <Card className="border-border/50 rounded-xl">
                  <CardContent className="p-0">
                    {generalClients.length === 0 ? (
                      <p className="text-center text-muted-foreground py-8">No general clients assigned</p>
                    ) : (
                      <Table>
                        <TableHeader><TableRow><TableHead>Member</TableHead><TableHead>Code</TableHead><TableHead>Phone</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {generalClients.map((client: any) => (
                            <TableRow key={client.id}>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Avatar className="h-8 w-8"><AvatarImage src={client.profiles?.avatar_url} /><AvatarFallback className="text-xs">{(client.profiles?.full_name || 'M').slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                                  <span className="font-medium text-sm">{client.profiles?.full_name || 'Unknown'}</span>
                                </div>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">{client.member_code}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">{client.profiles?.phone || '-'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* PT Clients Tab */}
              <TabsContent value="clients" className="mt-4">
                <Card className="border-border/50 rounded-xl">
                  <CardContent className="p-0">
                    {ptClients.length === 0 ? (
                      <p className="text-center text-muted-foreground py-8">No active PT clients</p>
                    ) : (
                      <Table>
                        <TableHeader><TableRow><TableHead>Member</TableHead><TableHead>Package</TableHead><TableHead>Sessions</TableHead><TableHead>Expiry</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {ptClients.map((client: any) => (
                            <TableRow key={client.id}>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Avatar className="h-8 w-8"><AvatarImage src={client.member?.profiles?.avatar_url} /><AvatarFallback className="text-xs">{(client.member?.profiles?.full_name || 'M').slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                                  <div><p className="font-medium text-sm">{client.member?.profiles?.full_name || 'Unknown'}</p><p className="text-xs text-muted-foreground">{client.member?.member_code}</p></div>
                                </div>
                              </TableCell>
                              <TableCell className="text-sm">{client.package?.name || 'PT Package'}</TableCell>
                              <TableCell><Badge variant="outline" className="text-xs">{client.sessions_remaining}/{client.sessions_total}</Badge></TableCell>
                              <TableCell className="text-sm text-muted-foreground">{format(new Date(client.expiry_date), 'MMM d')}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Sessions Tab */}
              <TabsContent value="sessions" className="mt-4">
                <Card className="border-border/50 rounded-xl">
                  <CardContent className="p-0">
                    {recentSessions.length === 0 ? (
                      <p className="text-center text-muted-foreground py-8">No sessions found</p>
                    ) : (
                      <Table>
                        <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Member</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {recentSessions.map((session: any) => (
                            <TableRow key={session.id}>
                              <TableCell className="text-sm">{format(new Date(session.scheduled_at), 'MMM d, h:mm a')}</TableCell>
                              <TableCell className="text-sm">{session.member_pt_packages?.members?.profiles?.full_name || 'Unknown'}</TableCell>
                              <TableCell><Badge variant={session.status === 'completed' ? 'default' : 'secondary'} className="text-xs">{session.status}</Badge></TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {trainer.is_active && onDeactivate && (
              <div className="pt-4 border-t">
                <Button variant="destructive" className="w-full rounded-xl" onClick={() => { onDeactivate(trainer.id); onOpenChange(false); }}>
                  <UserMinus className="h-4 w-4 mr-2" /> Deactivate Trainer
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
