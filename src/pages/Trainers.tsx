import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { Plus, Mail, Phone, Award, Users, DollarSign, Edit, User, Dumbbell, TrendingUp, Star } from "lucide-react";
import { useBranchContext } from '@/contexts/BranchContext';
import { useTrainers, useDeactivateTrainer } from '@/hooks/useTrainers';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Progress } from '@/components/ui/progress';
import { AddTrainerDrawer } from '@/components/trainers/AddTrainerDrawer';
import { TrainerProfileDrawer } from '@/components/trainers/TrainerProfileDrawer';
import { EditTrainerDrawer } from '@/components/trainers/EditTrainerDrawer';

export default function TrainersPage() {
  const { effectiveBranchId, branchFilter } = useBranchContext();
  // When branchFilter is empty (All Branches), pass '' to fetch all trainers
  const branchId = branchFilter || '';
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [selectedTrainer, setSelectedTrainer] = useState<any>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingTrainer, setEditingTrainer] = useState<any>(null);
  const { data: trainers, isLoading } = useTrainers(branchId, !showInactive);
  const deactivateTrainer = useDeactivateTrainer();

  const { data: ptClientCounts = {} } = useQuery({
    queryKey: ['pt-client-counts', branchId],
    queryFn: async () => {
      let query = supabase.from('member_pt_packages').select('trainer_id').eq('status', 'active');
      if (branchId) query = query.eq('branch_id', branchId);
      const { data, error } = await query;
      if (error) throw error;
      const counts: Record<string, number> = {};
      data?.forEach(pkg => { if (pkg.trainer_id) counts[pkg.trainer_id] = (counts[pkg.trainer_id] || 0) + 1; });
      return counts;
    },
    enabled: true,
  });

  const { data: generalClientCounts = {} } = useQuery({
    queryKey: ['general-client-counts', branchId],
    queryFn: async () => {
      let query = supabase.from('members').select('assigned_trainer_id').eq('status', 'active').not('assigned_trainer_id', 'is', null);
      if (branchId) query = query.eq('branch_id', branchId);
      const { data, error } = await query;
      if (error) throw error;
      const counts: Record<string, number> = {};
      data?.forEach(m => { if (m.assigned_trainer_id) counts[m.assigned_trainer_id] = (counts[m.assigned_trainer_id] || 0) + 1; });
      return counts;
    },
    enabled: true,
  });

  const { data: monthlyRevenue = 0 } = useQuery({
    queryKey: ['trainers-monthly-revenue', branchId],
    queryFn: async () => {
      const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
      const { data, error } = await supabase.from('trainer_commissions').select('amount').gte('created_at', startOfMonth.toISOString());
      if (error) throw error;
      return (data || []).reduce((sum, c) => sum + (c.amount || 0), 0);
    },
    enabled: true,
  });

  // Cmd+K deep links
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('new') === '1') {
      setIsCreateOpen(true);
      url.searchParams.delete('new');
      window.history.replaceState({}, '', url.toString());
    }
    const trainerId = url.searchParams.get('trainer');
    if (!trainerId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('trainers')
        .select('*')
        .eq('id', trainerId)
        .maybeSingle();
      if (cancelled || !data) return;
      const { data: p } = await supabase
        .from('profiles')
        .select('full_name, email, phone, avatar_url')
        .eq('id', (data as any).user_id)
        .maybeSingle();
      const prof: any = p || {};
      setSelectedTrainer({
        ...data,
        profile_name: prof.full_name,
        profile_email: prof.email,
        profile_phone: prof.phone,
        profile_avatar: prof.avatar_url,
      });
      setProfileOpen(true);
      const u2 = new URL(window.location.href);
      u2.searchParams.delete('trainer');
      window.history.replaceState({}, '', u2.toString());
    })();
    return () => { cancelled = true; };
  }, []);

  const openTrainerProfile = (trainer: any) => { setSelectedTrainer(trainer); setProfileOpen(true); };
  const openEditTrainer = (trainer: any, e: React.MouseEvent) => { e.stopPropagation(); setEditingTrainer(trainer); setEditOpen(true); };
  const handleDeactivate = async (trainerId: string) => {
    try { await deactivateTrainer.mutateAsync(trainerId); toast.success("Trainer deactivated"); } catch { toast.error("Failed to deactivate trainer"); }
  };

  const totalPTClients = Object.values(ptClientCounts).reduce((sum: number, count: number) => sum + count, 0);
  const totalGeneralClients = Object.values(generalClientCounts).reduce((sum: number, count: number) => sum + count, 0);
  const activeTrainers = trainers?.filter(t => t.is_active).length || 0;

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary to-primary/90 text-white"><Dumbbell className="h-6 w-6" /></div>
              Trainers
            </h1>
            <p className="text-muted-foreground mt-1">
              {branchId ? 'Manage trainers at this branch' : 'Viewing trainers across all branches'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => setShowInactive(!showInactive)} className="rounded-xl">{showInactive ? "Hide Inactive" : "Show Inactive"}</Button>
            <Button onClick={() => setIsCreateOpen(true)} className="gap-2 rounded-xl shadow-lg shadow-primary/20"><Plus className="h-4 w-4" />Add Trainer</Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-5">
          <Card className="bg-gradient-to-br from-primary to-primary/90 text-white border-0 shadow-lg shadow-md rounded-2xl overflow-hidden relative">
            <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -translate-y-6 translate-x-6" />
            <CardContent className="pt-6 pb-5 relative z-10"><Dumbbell className="h-5 w-5 opacity-80 mb-2" /><div className="text-3xl font-bold">{activeTrainers}</div><p className="text-sm opacity-80 mt-0.5">Active Trainers</p></CardContent>
          </Card>
          <Card className="bg-card border border-border/50 shadow-lg shadow-md rounded-2xl"><CardContent className="pt-6 pb-5"><div className="flex items-center gap-2 mb-2"><div className="p-1.5 rounded-lg bg-primary/10"><User className="h-4 w-4 text-primary" /></div></div><div className="text-2xl font-bold text-foreground">{totalGeneralClients}</div><p className="text-sm text-muted-foreground mt-0.5">General Clients</p></CardContent></Card>
          <Card className="bg-card border border-border/50 shadow-lg shadow-md rounded-2xl"><CardContent className="pt-6 pb-5"><div className="flex items-center gap-2 mb-2"><div className="p-1.5 rounded-lg bg-warning/10 dark:bg-warning/10"><Star className="h-4 w-4 text-warning" /></div></div><div className="text-2xl font-bold text-foreground">{totalPTClients}</div><p className="text-sm text-muted-foreground mt-0.5">PT Clients</p></CardContent></Card>
          <Card className="bg-card border border-border/50 shadow-lg shadow-md rounded-2xl"><CardContent className="pt-6 pb-5"><div className="flex items-center gap-2 mb-2"><div className="p-1.5 rounded-lg bg-success/10 dark:bg-success/10"><DollarSign className="h-4 w-4 text-success" /></div></div><div className="text-2xl font-bold text-foreground">₹{monthlyRevenue.toLocaleString()}</div><p className="text-sm text-muted-foreground mt-0.5">Monthly Revenue</p></CardContent></Card>
          <Card className="bg-card border border-border/50 shadow-lg shadow-md rounded-2xl"><CardContent className="pt-6 pb-5"><div className="flex items-center gap-2 mb-2"><div className="p-1.5 rounded-lg bg-info/10 dark:bg-info/100/10"><TrendingUp className="h-4 w-4 text-info" /></div></div><div className="text-2xl font-bold text-foreground">{activeTrainers > 0 ? Math.round(((totalPTClients + totalGeneralClients) / activeTrainers)) : 0}</div><p className="text-sm text-muted-foreground mt-0.5">Avg Clients/Trainer</p></CardContent></Card>
        </div>

        {/* Trainer Cards */}
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading trainers...</div>
        ) : trainers?.length === 0 ? (
          <Card className="rounded-2xl shadow-lg">
            <CardContent className="py-16 text-center">
              <div className="mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center mb-6"><Dumbbell className="h-10 w-10 text-primary" /></div>
              <h3 className="text-xl font-semibold mb-2">No Trainers Yet</h3>
              <p className="text-muted-foreground mb-6">Add your first trainer to get started</p>
              <Button onClick={() => setIsCreateOpen(true)} className="gap-2 rounded-xl"><Plus className="h-4 w-4" /> Add Trainer</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {trainers?.map((trainer) => {
              const ptClients = ptClientCounts[trainer.id] || 0;
              const genClients = generalClientCounts[trainer.id] || 0;
              const maxClients = (trainer as any).max_clients || 10;
              const ptUtil = Math.min((ptClients / maxClients) * 100, 100);
              return (
                <Card key={trainer.id} className={`group cursor-pointer transition-all duration-300 hover:shadow-xl hover:-translate-y-1 rounded-2xl border-border/50 shadow-lg overflow-hidden ${!trainer.is_active ? "opacity-50" : ""}`} onClick={() => openTrainerProfile(trainer)}>
                  <div className="h-1.5 bg-gradient-to-r from-primary to-primary/90" />
                  <CardContent className="p-5 space-y-4">
                    <div className="flex items-center gap-4">
                      <Avatar className="h-14 w-14 ring-2 ring-primary/10 ring-offset-2"><AvatarImage src={trainer.profile_avatar || undefined} /><AvatarFallback className="bg-gradient-to-br from-primary/20 to-primary/10 text-primary font-bold">{(trainer.profile_name || "T").slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-base font-bold text-foreground truncate">{trainer.profile_name || "Unknown"}</h3>
                        <p className="text-sm text-muted-foreground truncate flex items-center gap-1"><Mail className="h-3 w-3 flex-shrink-0" />{trainer.profile_email}</p>
                      </div>
                      <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 transition-opacity rounded-xl" onClick={(e) => openEditTrainer(trainer, e)}><Edit className="h-4 w-4" /></Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 rounded-xl bg-muted/50 border border-border/30"><div className="flex items-center gap-1.5 mb-1"><User className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-xs text-muted-foreground">General</span></div><p className="text-xl font-bold text-foreground">{genClients}</p></div>
                      <div className="p-3 rounded-xl bg-primary/5 border border-primary/10"><div className="flex items-center gap-1.5 mb-1"><Star className="h-3.5 w-3.5 text-primary" /><span className="text-xs text-primary">PT Clients</span></div><p className="text-xl font-bold text-foreground">{ptClients}<span className="text-sm font-normal text-muted-foreground">/{maxClients}</span></p></div>
                    </div>
                    <div className="space-y-1.5"><div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">PT Capacity</span><span className={`font-semibold ${ptUtil >= 80 ? 'text-destructive' : ptUtil >= 50 ? 'text-warning' : 'text-success'}`}>{ptUtil.toFixed(0)}%</span></div><Progress value={ptUtil} className="h-2" /></div>
                    {trainer.profile_phone && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Phone className="h-3.5 w-3.5" /><span>{trainer.profile_phone}</span></div>}
                    {trainer.specializations?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">{trainer.specializations.slice(0, 3).map((spec: string, idx: number) => <Badge key={idx} variant="secondary" className="text-xs rounded-full px-2.5">{spec}</Badge>)}{trainer.specializations.length > 3 && <Badge variant="outline" className="text-xs rounded-full">+{trainer.specializations.length - 3}</Badge>}</div>
                    )}
                    {trainer.certifications?.length > 0 && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Award className="h-3.5 w-3.5 text-warning" /><span className="truncate">{trainer.certifications.join(", ")}</span></div>}
                    {trainer.hourly_rate && <div className="pt-2 border-t border-border/30 flex items-center justify-between"><span className="text-sm text-muted-foreground">Hourly Rate</span><span className="text-sm font-bold text-foreground">₹{trainer.hourly_rate}</span></div>}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <AddTrainerDrawer open={isCreateOpen} onOpenChange={setIsCreateOpen} branchId={effectiveBranchId || ''} />
        <TrainerProfileDrawer open={profileOpen} onOpenChange={setProfileOpen} trainer={selectedTrainer} onDeactivate={handleDeactivate} />
        <EditTrainerDrawer open={editOpen} onOpenChange={setEditOpen} trainer={editingTrainer} />
      </div>
    </AppLayout>
  );
}
